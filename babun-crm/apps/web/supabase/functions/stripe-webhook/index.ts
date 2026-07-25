// Stripe webhook receiver — Edge Function port of
// apps/web/src/app/api/stripe/webhook/route.ts (STORY-052 G3 + STORY-069).
//
// POST /functions/v1/stripe-webhook
//
// ⚠️ EXTERNAL CALLER, AND IT IS THE BILLING SOURCE OF TRUTH.
// This handler is the ONLY writer of tenants.plan / .subscription_status /
// .stripe_subscription_id / .trial_ends_at / .current_period_end. If it
// stops receiving events, subscriptions silently drift out of sync — no
// error appears anywhere in the product.
//
// CUTOVER IS NOT CODE-ONLY. Artem must, in the Stripe Dashboard:
//   1. Add this URL as a webhook endpoint (same event types as today).
//   2. Copy the NEW signing secret into the Edge Function secret
//      STRIPE_WEBHOOK_SECRET — each endpoint gets its OWN secret, so the
//      existing value will NOT verify here.
//   3. Only after this endpoint shows successful deliveries, disable the
//      old babun.app endpoint.
// Running both in parallel is SAFE: idempotency is enforced by the UNIQUE
// on billing_events.stripe_event_id, so whichever handler sees an event
// first wins and the other one no-ops on 23505.
//
// Required secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
// STRIPE_PRICE_PRO, STRIPE_PRICE_BUSINESS, plus the service key.
//
// PORTING NOTES vs the Next route:
//   * `constructEvent` → `constructEventAsync`. Deno has no Node crypto
//     sync HMAC; the sync variant throws at runtime under Web Crypto.
//     This is THE classic Stripe-on-edge trap.
//   * Stripe client gets `createFetchHttpClient()` — the default Node
//     http client does not exist in Deno.
//   * Audit-then-reconcile order, the 23505 short-circuit, tenant
//     resolution and every status mapping are unchanged.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  const legacyServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let serviceKey: string | undefined;
  if (secretKeysJson) {
    try {
      const candidates = Object.values(
        JSON.parse(secretKeysJson) as Record<string, unknown>,
      ).filter((v): v is string => typeof v === "string" && v.length > 20);
      serviceKey =
        candidates.find((v) => v.startsWith("sb_secret_")) ?? candidates[0];
    } catch {
      // fall through
    }
  }
  if (!serviceKey) serviceKey = legacyServiceKey || undefined;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type Tier = "free" | "pro" | "business";
type SubStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete";

interface ReconcileFields {
  plan?: Tier;
  subscription_status?: SubStatus | null;
  stripe_subscription_id?: string | null;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
}

function priceIdToTier(priceId: string | undefined): Tier {
  if (!priceId) return "free";
  if (priceId === Deno.env.get("STRIPE_PRICE_PRO")) return "pro";
  if (priceId === Deno.env.get("STRIPE_PRICE_BUSINESS")) return "business";
  // Unknown price — fall back to free so a typo'd secret never grants a
  // paid tier.
  return "free";
}

function mapSubscriptionStatus(s: string): SubStatus {
  switch (s) {
    case "active":
    case "trialing":
    case "past_due":
    case "canceled":
      return s;
    case "incomplete":
    case "incomplete_expired":
      return "incomplete";
    case "unpaid":
      return "past_due";
    case "paused":
      return "incomplete";
    default:
      return "incomplete";
  }
}

const unixToIso = (unix: number): string => new Date(unix * 1000).toISOString();

function computeUpdate(event: Stripe.Event): ReconcileFields | null {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const update: ReconcileFields = {
        plan: priceIdToTier(sub.items?.data?.[0]?.price?.id),
        subscription_status: mapSubscriptionStatus(sub.status),
        stripe_subscription_id: sub.id,
      };
      const withPeriod = sub as unknown as {
        current_period_end?: number | null;
        trial_end?: number | null;
      };
      if (typeof withPeriod.current_period_end === "number") {
        update.current_period_end = unixToIso(withPeriod.current_period_end);
      }
      update.trial_ends_at =
        typeof withPeriod.trial_end === "number"
          ? unixToIso(withPeriod.trial_end)
          : null;
      return update;
    }
    case "customer.subscription.deleted":
      return {
        plan: "free",
        subscription_status: "canceled",
        stripe_subscription_id: null,
        trial_ends_at: null,
      };
    case "invoice.payment_succeeded":
      return { subscription_status: "active" };
    case "invoice.payment_failed":
      return { subscription_status: "past_due" };
    case "customer.subscription.trial_will_end":
      // Notification-only (3 days out). No tenant mutation.
      return null;
    default:
      return null;
  }
}

// deno-lint-ignore no-explicit-any
async function resolveTenantId(event: Stripe.Event, sbs: any): Promise<string | null> {
  const data = event.data.object as unknown as Record<string, unknown>;
  const clientRef = data.client_reference_id;
  if (typeof clientRef === "string" && clientRef) return clientRef;

  const customer = data.customer;
  if (typeof customer === "string" && customer) {
    const { data: row } = await sbs
      .from("tenants")
      .select("id")
      .eq("stripe_customer_id", customer)
      .maybeSingle();
    if (row?.id) return row.id as string;
  }
  // Orphan event — still audited with tenant_id NULL for forensics.
  return null;
}

// STORY-069 — SMS topup credit. Idempotent via the UNIQUE on
// sms_topups.stripe_payment_intent_id; the balance bump itself goes
// through the bump_sms_balance RPC (atomic INSERT..ON CONFLICT), which
// STORY-079 introduced after a read-then-update lost credits under
// concurrent webhooks.
// deno-lint-ignore no-explicit-any
async function maybeCreditSmsTopup(event: Stripe.Event, sbs: any): Promise<void> {
  if (event.type !== "checkout.session.completed") return;
  const session = event.data.object as Stripe.Checkout.Session;
  const meta = (session.metadata ?? {}) as Record<string, string | undefined>;
  if (meta.kind !== "sms_topup") return;

  const tenantId = meta.tenant_id;
  const packId = meta.pack_id;
  const amountCents = Number(meta.amount_cents);
  const credits = Number(meta.credits);
  if (
    !tenantId ||
    !packId ||
    !Number.isFinite(amountCents) ||
    !Number.isFinite(credits)
  ) {
    console.warn("sms topup: missing metadata", meta);
    return;
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;
  if (!paymentIntentId) {
    console.warn("sms topup: no payment_intent on session", session.id);
    return;
  }

  const { error: insertErr } = await sbs.from("sms_topups").insert({
    tenant_id: tenantId,
    amount_cents: amountCents,
    credits_added: credits,
    pack_label: packId,
    stripe_session_id: session.id,
    stripe_payment_intent_id: paymentIntentId,
    status: "completed",
    completed_at: new Date().toISOString(),
  });
  if (insertErr) {
    if ((insertErr as { code?: string }).code === "23505") return; // already credited
    throw insertErr;
  }

  const { data: rpcData, error: rpcErr } = await sbs.rpc("bump_sms_balance", {
    p_tenant_id: tenantId,
    p_amount_cents: amountCents,
  });
  if (rpcErr) throw rpcErr;
  if (rpcData && typeof rpcData === "object" && "error" in rpcData) {
    throw new Error(
      `bump_sms_balance: ${(rpcData as { error: string }).error}`,
    );
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  // 503 (not 4xx) on a config gap: Stripe retries 5xx, so once the secret
  // is set the backlog catches up on its own.
  if (!secretKey) return json(503, { error: "stripe_not_configured" });
  if (!webhookSecret) return json(503, { error: "webhook_secret_missing" });

  const stripe = new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
  });

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return json(400, { error: "invalid body" });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return json(400, { error: "missing signature" });

  let event: Stripe.Event;
  try {
    // ASYNC variant — mandatory under Web Crypto (see header note).
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
    );
  } catch (err) {
    // Signature mismatch / expired timestamp / malformed payload. 400 so
    // Stripe does not retry a request that can never succeed.
    console.warn(
      "stripe webhook: signature verify failed —",
      err instanceof Error ? err.message : String(err),
    );
    return json(400, { error: "bad signature" });
  }

  const service = serviceClient();
  if (!service) return json(503, { error: "service_role_unavailable" });
  // deno-lint-ignore no-explicit-any
  const sbs = service as any;

  // Audit FIRST — the UNIQUE on stripe_event_id is the idempotency
  // primitive, and a recorded event survives a failed reconcile.
  const tenantIdHint = await resolveTenantId(event, sbs);
  const { error: auditErr } = await sbs.from("billing_events").insert({
    tenant_id: tenantIdHint,
    stripe_event_id: event.id,
    event_type: event.type,
    payload: event,
  });
  if (auditErr) {
    if ((auditErr as { code?: string }).code === "23505") {
      // Already processed — a Stripe retry, or the still-live Next route
      // handled it first during the parallel-run window. ACK.
      return json(200, { ok: true, ignored: "duplicate" });
    }
    console.error("stripe webhook: audit insert failed", auditErr);
    return json(500, { error: "audit insert failed" });
  }

  try {
    if (tenantIdHint) {
      const update = computeUpdate(event);
      if (update) {
        await sbs.from("tenants").update(update).eq("id", tenantIdHint);
      }
    }
  } catch (err) {
    console.error("stripe webhook: reconcile failed", err);
    // Audit row is in place; ACK so Stripe stops retrying and we replay
    // from billing_events instead.
    return json(200, { ok: true, reconcile_warning: true });
  }

  try {
    await maybeCreditSmsTopup(event, sbs);
  } catch (err) {
    console.error("stripe webhook: sms topup credit failed", err);
    return json(200, { ok: true, topup_warning: true });
  }

  return json(200, { ok: true });
});
