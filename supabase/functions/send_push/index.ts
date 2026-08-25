// STORY-053b — send_push Edge Function (G3 LIVE).
//
// Triggered by pg_net.http_post from Postgres triggers (G3) or by
// authenticated callers for testing. Reads push_subscriptions for the
// target user_ids, signs each notification with the VAPID private key
// from Edge Function Secrets, and sends via the standard Web Push
// protocol.
//
// Two request shapes are accepted:
//
//   1. Trigger-shape (preferred): { user_ids, event_type, data }
//      The function looks up the matching TEMPLATES entry and renders
//      title/body/url server-side. Lets us change copy with a 1-minute
//      function redeploy without touching SQL.
//
//   2. Direct-shape (debug / manual smoke): { user_ids, title, body, url? }
//      Caller pre-renders the strings. Useful for one-off tests.
//
// Edge Function Secrets (Dashboard → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY    — base64-url, also exposed in Vercel env as
//                          NEXT_PUBLIC_VAPID_PUBLIC_KEY for browsers
//   VAPID_PRIVATE_KEY   — base64-url, server-only
//   VAPID_SUBJECT       — "mailto:support@babun.app"
//
// The function has gateway JWT verification disabled for pg_net, so every
// dispatch must carry the database-held x-dispatch-secret header.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
// @ts-expect-error — esm.sh shim resolves at runtime in Deno
import webpush from "https://esm.sh/web-push@3.6.7?bundle";

// ─── Notification copy templates ──────────────────────────────────
//
// Server-side rendering keeps the trigger payload schema stable and
// lets us iterate on UX-critical text (lockscreen-visible) without a
// DB migration. Length budget: title ≤ 50 chars, body ≤ 110 chars
// (iOS lockscreen truncates around there).
//
// `master.new_appointment` is forward-compat scaffolding — the trigger
// is deferred until STORY-039b migrates appointments.master_id from
// text to uuid. Keeping the template means STORY-039b only needs to
// add the trigger SQL.

type TemplateRender = { title: string; body: string; url: string };

// Templates can be sync (data-only) or async (need a DB lookup, e.g.
// resolving auth.users.email from a user_id). Both paths produce the
// same TemplateRender shape.
type TemplateFn = (
  data: Record<string, unknown>,
  ctx: TemplateCtx,
) => Promise<TemplateRender> | TemplateRender;

interface TemplateCtx {
  /** Resolve auth.users.email by id; returns null on miss / error. */
  lookupEmail: (userId: string) => Promise<string | null>;
}

const TEMPLATES: Record<string, TemplateFn> = {
  "master.new_appointment": (data) => {
    const date = formatDateRu(data.date);
    const time = typeof data.time_start === "string" ? data.time_start : "";
    const tail = time ? `${date}, ${time}` : date;
    const apptId =
      typeof data.appointment_id === "string" ? data.appointment_id : "";
    return {
      title: "Новая запись",
      body: tail || "Открой календарь, чтобы посмотреть детали.",
      url: apptId ? `/dashboard/appointments/${apptId}` : "/dashboard",
    };
  },
  "owner.new_member": async (data, ctx) => {
    const role = typeof data.role === "string" ? data.role : "";
    const roleRu = roleNameRu(role);
    const userId = typeof data.user_id === "string" ? data.user_id : "";
    const email = userId ? await ctx.lookupEmail(userId) : null;

    // Identical pattern to inviter.invite_accepted for consistency.
    let body: string;
    if (email && roleRu) {
      body = `${email} принял приглашение как ${roleRu}`;
    } else if (roleRu) {
      body = `Принято приглашение в роли «${roleRu}»`;
    } else {
      body = "В команду присоединился новый участник";
    }
    return {
      title: "Новый член команды",
      body,
      url: "/dashboard/settings/team",
    };
  },
  "inviter.invite_accepted": (data) => {
    // The trigger already includes invitations.email in the payload, so
    // no DB lookup needed here — synchronous template.
    const role = typeof data.role === "string" ? data.role : "";
    const roleRu = roleNameRu(role);
    const email = typeof data.email === "string" ? data.email : "";
    const who = email || "Приглашённый";

    let body: string;
    if (roleRu) {
      body = `${who} принял приглашение как ${roleRu}`;
    } else {
      body = `${who} принял приглашение`;
    }
    return {
      title: "Приглашение принято",
      body,
      url: "/dashboard/settings/team",
    };
  },
};

function roleNameRu(role: string): string {
  switch (role) {
    case "owner":
      return "Владелец";
    case "dispatcher":
      return "Диспетчер";
    case "master":
      return "Мастер";
    default:
      return "";
  }
}

function formatDateRu(input: unknown): string {
  if (typeof input !== "string") return "";
  // Trigger sends ISO date "YYYY-MM-DD".
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
  if (!m) return input.slice(0, 10);
  const months = [
    "янв",
    "фев",
    "мар",
    "апр",
    "мая",
    "июн",
    "июл",
    "авг",
    "сен",
    "окт",
    "ноя",
    "дек",
  ];
  const [, , mo, d] = m;
  const month = months[parseInt(mo, 10) - 1] ?? mo;
  return `${parseInt(d, 10)} ${month}`;
}

// ─── Request types ────────────────────────────────────────────────

interface BaseRequest {
  user_ids: string[];
  url?: string;
  data?: Record<string, unknown>;
}

interface TriggerShape extends BaseRequest {
  event_type: string;
}
interface DirectShape extends BaseRequest {
  title: string;
  body: string;
}
type SendPushRequest = TriggerShape | DirectShape;

interface ErrorEntry {
  subscription_id: string;
  endpoint_host: string; // host only, not full endpoint (avoid logging URLs with tokens)
  status_code: number | null;
  reason: string;
}

interface SendPushResponse {
  sent: number;
  skipped: number;
  deleted: number;
  errors: ErrorEntry[];
  total: number;
  mode: "live";
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function authorizeDispatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  request: Request,
): Promise<boolean> {
  const supplied = request.headers.get("x-dispatch-secret") ?? "";
  if (!supplied) return false;
  const { data, error } = await supabase
    .from("edge_cron_secrets")
    .select("secret")
    .eq("name", "send_push")
    .single();
  return (
    !error &&
    typeof data?.secret === "string" &&
    constantTimeEqual(supplied, data.secret)
  );
}

function validate(body: unknown): SendPushRequest | string {
  if (typeof body !== "object" || body === null) return "invalid body";
  const b = body as Record<string, unknown>;
  if (
    !Array.isArray(b.user_ids) ||
    b.user_ids.some((x) => typeof x !== "string")
  ) {
    return "user_ids must be string[]";
  }
  if (b.user_ids.length > 500) return "too many recipients";
  if (
    b.url !== undefined &&
    (typeof b.url !== "string" || !b.url.startsWith("/"))
  ) {
    return "url must be a relative path starting with /";
  }

  // Prefer trigger-shape if event_type is set, else fall back to direct.
  if (typeof b.event_type === "string") {
    if (!TEMPLATES[b.event_type]) {
      return `unknown event_type: ${b.event_type}`;
    }
    return body as TriggerShape;
  }
  // Direct shape.
  if (
    typeof b.title !== "string" ||
    b.title.length < 1 ||
    b.title.length > 80
  ) {
    return "title must be 1..80 chars";
  }
  if (typeof b.body !== "string" || b.body.length < 1 || b.body.length > 200) {
    return "body must be 1..200 chars";
  }
  return body as DirectShape;
}

async function renderPayload(
  req: SendPushRequest,
  ctx: TemplateCtx,
): Promise<TemplateRender> {
  if ("event_type" in req) {
    const data = req.data ?? {};
    const tpl = await TEMPLATES[req.event_type](data, ctx);
    // Caller may override URL; otherwise template-provided URL stands.
    return { title: tpl.title, body: tpl.body, url: req.url ?? tpl.url };
  }
  return {
    title: req.title,
    body: req.body,
    url: req.url ?? "/dashboard",
  };
}

// Extract just the host from a Web Push endpoint, for safe logging.
function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unknown";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")
    return jsonResponse(405, { error: "method not allowed" });

  let parsed: SendPushRequest | string;
  try {
    parsed = validate(await req.json());
  } catch {
    return jsonResponse(400, { error: "invalid json" });
  }
  if (typeof parsed === "string") return jsonResponse(400, { error: parsed });
  const reqShape = parsed;

  // Service-role client. Supabase migrated from
  // SUPABASE_SERVICE_ROLE_KEY (legacy) to SUPABASE_SECRET_KEYS (JSON
  // dict of JWT-Signing-Keys). Prefer the dict, fall back to legacy.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  const legacyServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let serviceKey: string | undefined;
  if (secretKeysJson) {
    try {
      const candidates = Object.values(
        JSON.parse(secretKeysJson) as Record<string, unknown>,
      ).filter(
        (value): value is string =>
          typeof value === "string" && value.length > 20,
      );
      serviceKey =
        candidates.find((value) => value.startsWith("sb_secret_")) ??
        candidates[0];
    } catch {
      // fall through
    }
  }
  if (!serviceKey) serviceKey = legacyServiceKey || undefined;
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(500, {
      error:
        "missing SUPABASE_URL or service key (SUPABASE_SECRET_KEYS / SUPABASE_SERVICE_ROLE_KEY)",
    });
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (!(await authorizeDispatch(supabase, req))) {
    return jsonResponse(401, { error: "dispatch_authorization_required" });
  }

  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return jsonResponse(500, {
      error:
        "missing VAPID secrets — set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT in Edge Function Secrets",
    });
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  if (reqShape.user_ids.length === 0) {
    return jsonResponse(200, {
      sent: 0,
      skipped: 0,
      deleted: 0,
      errors: [],
      total: 0,
      mode: "live",
    } satisfies SendPushResponse);
  }

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, keys, user_id")
    .in("user_id", reqShape.user_ids);

  if (error) {
    return jsonResponse(500, {
      error: `fetch subscriptions: ${error.message}`,
    });
  }
  const subscriptions = subs ?? [];

  // Build template ctx with a memoised email lookup. owner.new_member
  // template needs auth.users.email by user_id; we read via the
  // service-role client (RLS bypass via the policy added in
  // 20260501_002 + service_role's auth.users access).
  const emailCache = new Map<string, string | null>();
  const ctx: TemplateCtx = {
    lookupEmail: async (userId: string) => {
      if (emailCache.has(userId)) return emailCache.get(userId) ?? null;
      try {
        // auth.admin.getUserById is the supported, RLS-safe path for
        // resolving an auth.users row by id from the server side.
        const { data, error } = await supabase.auth.admin.getUserById(userId);
        if (error || !data?.user?.email) {
          emailCache.set(userId, null);
          return null;
        }
        emailCache.set(userId, data.user.email);
        return data.user.email;
      } catch {
        emailCache.set(userId, null);
        return null;
      }
    },
  };

  // Render notification copy once per request (templates depend only on
  // event_type + data, not on the recipient).
  const rendered = await renderPayload(reqShape, ctx);
  const payload = JSON.stringify({
    title: rendered.title,
    body: rendered.body,
    url: rendered.url,
    data: reqShape.data ?? {},
  });

  let sent = 0;
  let skipped = 0;
  let deleted = 0;
  const errors: ErrorEntry[] = [];

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint as string,
          keys: sub.keys as { p256dh: string; auth: string },
        },
        payload,
        { TTL: 60 * 60 * 24 }, // 1-day TTL on the push service
      );
      sent += 1;
    } catch (err: unknown) {
      // web-push throws WebPushError-like objects with a `statusCode`.
      const e = err as { statusCode?: number; body?: string; message?: string };
      const status = typeof e.statusCode === "number" ? e.statusCode : null;

      // Only DELETE on confirmed-gone (410) or not-found (404). Any
      // other failure (rate limit 429, server 5xx, network glitch) =>
      // log + count as error, keep the subscription. Conservative on
      // purpose — false-positive deletes break user trust.
      if (status === 410 || status === 404) {
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("id", sub.id as string);
        deleted += 1;
      } else {
        skipped += 1;
        errors.push({
          subscription_id: sub.id as string,
          endpoint_host: endpointHost(sub.endpoint as string),
          status_code: status,
          reason: e.message ?? e.body ?? "unknown",
        });
      }
    }
  }

  return jsonResponse(200, {
    sent,
    skipped,
    deleted,
    errors,
    total: subscriptions.length,
    mode: "live",
  } satisfies SendPushResponse);
});
