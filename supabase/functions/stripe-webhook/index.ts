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
// Required secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, plus the
// service key. STRIPE_PRICE_PRO / STRIPE_PRICE_BUSINESS — only for the old
// Pro/Business prices, if any subscription still runs on them.
//
// ТАРИФЫ «СОЛО · ПРО · МАКС» (01.10). Подписку оформляет `tariff-checkout`;
// тариф подписки — метка её цены (`metadata.tier`, `lookup_key`
// babun_<tier>_<period>), аккаунт — метка самой подписки
// (`metadata.tenant_id`). В Stripe у этого вебхука должны быть включены
// события `customer.subscription.created/updated/deleted`,
// `invoice.payment_succeeded/failed` и `checkout.session.completed`.
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

type Tier = "free" | "solo" | "pro" | "max";
type SubStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete";

interface ReconcileFields {
  plan?: Tier;
  stripe_customer_id?: string;
  subscription_status?: SubStatus | null;
  stripe_subscription_id?: string | null;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
}

function priceToTier(price: Stripe.Price | undefined): Tier {
  if (!price) return "free";
  // Цены тарифов заводит `tariff-checkout` — с меткой тарифа.
  const meta = price.metadata?.tier;
  if (meta === "solo" || meta === "pro" || meta === "max") return meta;
  const lookup = /^babun_(solo|pro|max)_/.exec(price.lookup_key ?? "");
  if (lookup) return lookup[1] as Tier;
  // Старые цены Pro/Business (до 01.10): Business теперь — Макс.
  if (price.id === Deno.env.get("STRIPE_PRICE_PRO")) return "pro";
  if (price.id === Deno.env.get("STRIPE_PRICE_BUSINESS")) return "max";
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
    // «Не оплачено» после всех повторов списания — БЕЗ доступа (аудит
    // 03.10): как `past_due` оно держало платный тариф, пока Stripe двигает
    // конец периода, то есть бессрочно.
    case "unpaid":
      return "incomplete";
    case "paused":
      return "incomplete";
    default:
      return "incomplete";
  }
}

const unixToIso = (unix: number): string => new Date(unix * 1000).toISOString();

/** Поля аккаунта из подписки, как она есть в Stripe СЕЙЧАС. */
function fieldsOfSubscription(sub: Stripe.Subscription): ReconcileFields {
  const item = sub.items?.data?.[0];
  const status = mapSubscriptionStatus(sub.status);
  const ended = sub.status === "canceled" || sub.status === "incomplete_expired";
  const update: ReconcileFields = {
    plan: ended ? "free" : priceToTier(item?.price),
    subscription_status: status,
    stripe_subscription_id: ended ? null : sub.id,
  };
  const withPeriod = sub as unknown as {
    current_period_end?: number | null;
    trial_end?: number | null;
  };
  const periodEnd =
    withPeriod.current_period_end ??
    (item as unknown as { current_period_end?: number | null } | undefined)?.current_period_end;
  if (typeof periodEnd === "number") update.current_period_end = unixToIso(periodEnd);
  update.trial_ends_at =
    !ended && typeof withPeriod.trial_end === "number" ? unixToIso(withPeriod.trial_end) : null;
  return update;
}

const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/** ПРАВДА О ПОДПИСКЕ — ИЗ STRIPE, А НЕ ИЗ СОБЫТИЯ (аудит 03.10).
 *
 *  Stripe не обещает порядок событий, а повтор после 5xx приходит позже
 *  новых. Раньше событие применялось как есть: старое `updated(active)`
 *  после `deleted` возвращало тариф по отменённой подписке, `deleted` ЛЮБОЙ
 *  подписки клиента обнулял тариф при живой другой. Теперь на каждое
 *  событие подписки или её счёта подписка перечитывается, и применяется
 *  только если это текущая подписка аккаунта (или её нет), либо текущая уже
 *  не живая, а эта — живая и новее. */
async function subscriptionTruth(
  event: Stripe.Event,
  stripe: Stripe,
  // deno-lint-ignore no-explicit-any
  sbs: any,
  tenantId: string,
): Promise<ReconcileFields | null> {
  const obj = event.data.object as unknown as Record<string, unknown>;
  const subId = event.type.startsWith("customer.subscription.")
    ? (typeof obj.id === "string" ? obj.id : null)
    : idOf(obj.subscription) ??
      idOf((obj.parent as { subscription_details?: { subscription?: unknown } } | undefined)?.subscription_details?.subscription);
  if (!subId) return null;

  const { data: tenant } = await sbs
    .from("tenants")
    .select("stripe_subscription_id")
    .eq("id", tenantId)
    .maybeSingle();
  const current = (tenant?.stripe_subscription_id as string | null | undefined) ?? null;

  const fresh = await stripe.subscriptions.retrieve(subId);
  const freshLive = LIVE_STATUSES.has(fresh.status);
  if (!current || current === subId) return fieldsOfSubscription(fresh);

  // Событие про ДРУГУЮ подписку, не текущую у аккаунта.
  if (!freshLive) return null; // чужая мёртвая подписка тариф не трогает
  let currentSub: Stripe.Subscription | null = null;
  try {
    currentSub = await stripe.subscriptions.retrieve(current);
  } catch {
    currentSub = null; // текущей в Stripe нет — переходим на живую
  }
  if (currentSub && LIVE_STATUSES.has(currentSub.status) && currentSub.created >= fresh.created) {
    return null; // текущая живая и не старше — остаётся
  }
  return fieldsOfSubscription(fresh);
}

function computeUpdate(event: Stripe.Event): ReconcileFields | null {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const item = sub.items?.data?.[0];
      const update: ReconcileFields = {
        plan: priceToTier(item?.price),
        subscription_status: mapSubscriptionStatus(sub.status),
        stripe_subscription_id: sub.id,
      };
      const withPeriod = sub as unknown as {
        current_period_end?: number | null;
        trial_end?: number | null;
      };
      // Новые версии API держат конец периода у позиции подписки.
      const periodEnd =
        withPeriod.current_period_end ??
        (item as unknown as { current_period_end?: number | null } | undefined)?.current_period_end;
      if (typeof periodEnd === "number") {
        update.current_period_end = unixToIso(periodEnd);
      }
      update.trial_ends_at =
        typeof withPeriod.trial_end === "number"
          ? unixToIso(withPeriod.trial_end)
          : null;
      return update;
    }
    // Оплата тарифа на странице Stripe: запомнить клиента Stripe аккаунта —
    // по нему находятся события подписки без меток.
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customer = idOf(session.customer);
      if (session.mode !== "subscription" || session.metadata?.kind !== "tariff" || !customer) return null;
      return { stripe_customer_id: customer };
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
  // Подписка тарифа несёт аккаунт в метке (`tariff-checkout`).
  const metaTenant = (data.metadata as Record<string, unknown> | undefined)?.tenant_id;
  if (typeof metaTenant === "string" && metaTenant) return metaTenant;

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

// ПОПОЛНЕНИЕ БАЛАНСА SMS (STORY-089). Зачисление — одна функция базы
// `sms_credit_topup`: запись оплаты и прибавка к балансу в одной транзакции,
// повтор той же оплаты ничего не делает (UNIQUE по payment_intent).
//
// Сумма — то, что Stripe СПИСАЛ (`amount_total`), а не метаданные сессии:
// метаданные пишет наш же код, но деньги — правда платёжной системы.
// Только `payment_status = paid`: отложенные способы оплаты приходят позже
// отдельным событием.
//
// ПОРЯДОК: зачисление идёт ДО журнала `billing_events` и на сбое отвечает
// 500. Раньше журнал писался первым, а сбой зачисления отвечал 200 — повтор
// Stripe упирался в «уже обработано», и оплаченные деньги не доходили до
// баланса никогда.
//
// ВОЛНА 13 (владелец 30.09: «защитить, чтобы никто не мог взломать»). Деньги
// SMS двигают и другие события — каждое через функцию базы, каждое
// повторяемо без вреда (журнал `sms_ledger` не пустит одну операцию дважды):
//   • `payment_intent.succeeded` — автопополнение с сохранённой карты (и
//     тот же платёж оплаты на сайте: второе зачисление — повтор, ноль);
//   • `checkout.session.completed` с просьбой об автопополнении — карта
//     сохраняется, автопополнение включается;
//   • `charge.refunded` — возврат оплаты снимает деньги с баланса
//     (нарастающим итогом: снимается только новое);
//   • `charge.dispute.created` — спор (и запрос банка) выключает
//     автопополнение и забывает карту; `charge.dispute.funds_withdrawn` —
//     банк забрал деньги, снимаем; `.funds_reinstated` — вернул, возвращаем.
// Только евро и только сумма пакета — иначе тревога и ничего не двигаем
// (волна 13.1, находки проверки безопасности).
// Платёж не SMS (подписка) функции базы узнают и пропускают.

type Meta = Record<string, string | undefined>;

const idOf = (value: unknown): string | null =>
  typeof value === "string" ? value : (value as { id?: string } | null)?.id ?? null;

const BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  discover: "Discover",
  diners: "Diners",
  jcb: "JCB",
  unionpay: "UnionPay",
  maestro: "Maestro",
};

/** «Visa •••• 4242» — всё, что приложение знает о карте. */
function cardLabel(pm: Stripe.PaymentMethod | null): string {
  if (pm?.type === "card" && pm.card) {
    return `${BRANDS[pm.card.brand] ?? pm.card.brand} •••• ${pm.card.last4}`;
  }
  return pm?.type === "link" ? "Link" : "Карта";
}

// deno-lint-ignore no-explicit-any
async function rpc(sbs: any, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await sbs.rpc(name, args);
  if (error) throw error;
  return data;
}

/** Деньги SMS — только евро (пакеты в евро; пересчёт Stripe в местную
 *  валюту дал бы в «центах» чужие числа). Не евро — тревога, не зачисляем. */
// deno-lint-ignore no-explicit-any
async function euroOnly(sbs: any, tenantId: string | null, currency: string | null | undefined, what: string): Promise<boolean> {
  if ((currency ?? "").toLowerCase() === "eur") return true;
  await rpc(sbs, "sms_alert", {
    p_tenant: tenantId,
    p_kind: "currency",
    p_message: `${what}: валюта ${currency ?? "?"} вместо EUR — деньги не тронуты`,
  });
  return false;
}

// deno-lint-ignore no-explicit-any
async function credit(sbs: any, tenantId: string, amountCents: number, sessionId: string | null, intentId: string, pack: string | null) {
  await rpc(sbs, "sms_credit_topup", {
    p_tenant: tenantId,
    p_amount_cents: amountCents,
    p_session: sessionId,
    p_payment_intent: intentId,
    p_pack: pack,
  });
}

// deno-lint-ignore no-explicit-any
async function smsMoney(event: Stripe.Event, sbs: any, stripe: Stripe): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      const meta = (session.metadata ?? {}) as Meta;
      if (meta.kind !== "sms_topup" || session.payment_status !== "paid") return;
      const tenantId = meta.tenant_id;
      const amountCents = session.amount_total ?? 0;
      const intentId = idOf(session.payment_intent);
      if (!tenantId || amountCents <= 0 || !intentId) {
        console.warn("sms topup: incomplete session", session.id);
        return;
      }
      if (!(await euroOnly(sbs, tenantId, session.currency, `Оплата ${intentId}`))) return;
      // Сумма — ровно та, что выбрана на сайте (пакет): иначе тревога.
      if (meta.amount_cents && Number(meta.amount_cents) !== amountCents) {
        await rpc(sbs, "sms_alert", {
          p_tenant: tenantId,
          p_kind: "topup_amount",
          p_message: `Оплата ${intentId}: ${amountCents} ц. вместо ${meta.amount_cents} — не зачислена`,
        });
        return;
      }
      await credit(sbs, tenantId, amountCents, session.id, intentId, meta.pack_id ?? null);
      if (meta.autotopup === "1") {
        const customer = idOf(session.customer);
        const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ["payment_method"] });
        const pm = typeof intent.payment_method === "object" ? intent.payment_method : null;
        const pmId = idOf(intent.payment_method);
        if (!customer || !pmId) {
          console.warn("sms autotopup: card not saved", session.id);
          return;
        }
        // Одна оплата — одно сохранение карты: повтор сигнала (или «Resend»
        // в Stripe) не вернёт карту, которую владелец убрал.
        await rpc(sbs, "sms_autotopup_card", {
          p_tenant: tenantId,
          p_session: session.id,
          p_customer: customer,
          p_payment_method: pmId,
          p_label: cardLabel(pm),
          p_threshold: Number(meta.threshold_cents ?? 500),
          p_amount: amountCents,
        });
      }
      return;
    }
    case "payment_intent.succeeded": {
      const intent = event.data.object as Stripe.PaymentIntent;
      const meta = (intent.metadata ?? {}) as Meta;
      if (meta.kind !== "sms_topup" || !meta.tenant_id) return;
      const amountCents = intent.amount_received ?? 0;
      if (amountCents <= 0) return;
      if (!(await euroOnly(sbs, meta.tenant_id, intent.currency, `Оплата ${intent.id}`))) return;
      if (meta.amount_cents && Number(meta.amount_cents) !== amountCents) {
        await rpc(sbs, "sms_alert", {
          p_tenant: meta.tenant_id,
          p_kind: "topup_amount",
          p_message: `Оплата ${intent.id}: ${amountCents} ц. вместо ${meta.amount_cents} — не зачислена`,
        });
        return;
      }
      await credit(sbs, meta.tenant_id, amountCents, null, intent.id, meta.pack_id ?? null);
      // Автопополнение, которое банк подтвердил не сразу («processing»): итог
      // попытки ставит этот сигнал.
      if (meta.auto === "1" && meta.attempt) {
        await rpc(sbs, "sms_autotopup_result", {
          p_tenant: meta.tenant_id,
          p_key: meta.attempt,
          p_ok: true,
          p_error: null,
        });
      }
      return;
    }
    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent;
      const meta = (intent.metadata ?? {}) as Meta;
      if (meta.kind !== "sms_topup" || meta.auto !== "1" || !meta.tenant_id || !meta.attempt) return;
      await rpc(sbs, "sms_autotopup_result", {
        p_tenant: meta.tenant_id,
        p_key: meta.attempt,
        p_ok: false,
        p_error: intent.last_payment_error?.message ?? "Банк отклонил списание",
      });
      return;
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const intentId = idOf(charge.payment_intent);
      if (!intentId) return;
      if (!(await euroOnly(sbs, null, charge.currency, `Возврат по ${intentId}`))) return;
      await rpc(sbs, "sms_stripe_refund", {
        p_payment_intent: intentId,
        p_refunded_total: charge.amount_refunded ?? 0,
      });
      return;
    }
    // Спор — по деньгам банка: открыт (в том числе запрос без списания) —
    // только выключить автопополнение и забыть карту; деньги снимаются,
    // когда банк их забрал, и возвращаются, когда вернул.
    case "charge.dispute.created":
    case "charge.dispute.funds_withdrawn":
    case "charge.dispute.funds_reinstated": {
      const dispute = event.data.object as Stripe.Dispute;
      let intentId = idOf(dispute.payment_intent);
      if (!intentId) {
        const chargeId = idOf(dispute.charge);
        if (chargeId) intentId = idOf((await stripe.charges.retrieve(chargeId)).payment_intent);
      }
      if (!intentId) return;
      const phase = event.type === "charge.dispute.created"
        ? "opened"
        : event.type === "charge.dispute.funds_withdrawn"
        ? "withdrawn"
        : "reinstated";
      if (phase !== "opened" && !(await euroOnly(sbs, null, dispute.currency, `Спор по ${intentId}`))) return;
      await rpc(sbs, "sms_stripe_dispute", {
        p_payment_intent: intentId,
        p_dispute: dispute.id,
        p_amount: dispute.amount ?? 0,
        p_phase: phase,
      });
      return;
    }
    default:
      return;
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

  // ТЕСТОВОЕ СОБЫТИЕ НА БОЕВОМ КЛЮЧЕ — МИМО (аудит 03.10): карта 4242 не
  // должна давать тариф и баланс SMS, а Twilio — слать настоящие SMS.
  if (secretKey.startsWith("sk_live_") && event.livemode !== true) {
    console.warn("stripe webhook: test-mode event on live key ignored", event.id);
    return json(200, { ok: true, ignored: "test_mode" });
  }

  const service = serviceClient();
  if (!service) return json(503, { error: "service_role_unavailable" });
  // deno-lint-ignore no-explicit-any
  const sbs = service as any;

  // Деньги SMS — ДО журнала: они сами идемпотентны, а сбой должен
  // вернуть Stripe 5xx, чтобы он прислал событие ещё раз.
  try {
    await smsMoney(event, sbs, stripe);
  } catch (err) {
    console.error("stripe webhook: sms money failed", event.type, err);
    return json(500, { error: "sms money failed" });
  }

  // Audit — the UNIQUE on stripe_event_id is the idempotency
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
      const bySubscription =
        event.type.startsWith("customer.subscription.") && event.type !== "customer.subscription.trial_will_end"
        || event.type === "invoice.payment_succeeded"
        || event.type === "invoice.payment_failed";
      const update = bySubscription
        ? await subscriptionTruth(event, stripe, sbs, tenantIdHint)
        : computeUpdate(event);
      if (update) {
        const { error: updateErr } = await sbs.from("tenants").update(update).eq("id", tenantIdHint);
        if (updateErr) throw new Error(updateErr.message ?? "tenants update failed");
      }
    }
  } catch (err) {
    // СБОЙ ЗАПИСИ ТАРИФА — НЕ «УСПЕХ» (аудит 03.10): раньше ошибка update не
    // проверялась, и ответ 200 при уже записанном журнале означал, что
    // повтора не будет никогда. Журнал снимается, Stripe получает 500 и
    // пришлёт событие ещё раз.
    console.error("stripe webhook: reconcile failed", err);
    await sbs.from("billing_events").delete().eq("stripe_event_id", event.id);
    return json(500, { error: "reconcile failed" });
  }

  return json(200, { ok: true });
});
