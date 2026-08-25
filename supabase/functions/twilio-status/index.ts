// Twilio message-status callback — Edge Function port of
// apps/web/src/app/api/twilio/status/route.ts (STORY-047 G6, hardened
// by STORY-078/079).
//
// POST /functions/v1/twilio-status   (application/x-www-form-urlencoded)
//
// ⚠️ EXTERNAL CALLER + SIGNATURE IS URL-BOUND.
// Twilio computes its HMAC over the exact URL it called. Moving hosts
// therefore changes the signed string: messages already in flight that
// were created with the old StatusCallback keep calling babun.app, and
// their signatures will NOT verify here. So:
//   1. Artem repoints the StatusCallback URL (Messaging Service /
//      per-message param) to this function.
//   2. The old babun.app route STAYS LIVE until every in-flight message
//      has reached a terminal state (Twilio retries up to ~24h).
// Running both in parallel is safe — the UPDATE is idempotent.
//
// Required secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, service key.
//
// PORTING NOTES vs the Next route:
//   * node:crypto createHmac/timingSafeEqual → Web Crypto
//     (HMAC-SHA1 is still supported for *verification*) plus a manual
//     constant-time compare. Same bytes, async instead of sync.
//   * Auth ORDER is preserved exactly, including the STORY-078 fix:
//     verify against platform creds BEFORE the row lookup, and never
//     return "ignored" for an unknown SID without a valid signature —
//     that response difference was an enumeration oracle.
//   * Missing platform creds still ACK with 200 (STORY-079): a 5xx makes
//     Twilio retry up to 11 times over 24h per message, which turns a
//     misconfigured deploy into a self-DoS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

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

const STATUS_MAP: Record<string, string> = {
  queued: "queued",
  sent: "sent",
  delivered: "delivered",
  failed: "failed",
  undelivered: "undelivered",
  accepted: "queued",
  sending: "queued",
};
const TERMINAL = new Set(["delivered", "failed", "undelivered"]);

/** Twilio canonical string: the called URL + each form key/value pair
 *  appended in key-sorted order, HMAC-SHA1, base64. */
async function twilioSignature(
  authToken: string,
  fullUrl: string,
  params: URLSearchParams,
): Promise<string> {
  const keys: string[] = [];
  params.forEach((_v, k) => keys.push(k));
  keys.sort();
  let data = fullUrl;
  for (const k of keys) data += k + (params.get(k) ?? "");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/** Length-checked constant-time compare (no early exit on mismatch). */
function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The URL Twilio signed. Prefer forwarded headers (proxy hop can
 *  rewrite the scheme), else the request URL as received. */
function computeFullUrl(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}${url.pathname}${url.search}`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return json(400, { error: "invalid body" });
  }
  const params = new URLSearchParams(rawBody);

  const messageSid = params.get("MessageSid") ?? "";
  const accountSid = params.get("AccountSid") ?? "";
  const messageStatus = params.get("MessageStatus") ?? "";
  if (!messageSid || !accountSid || !messageStatus) {
    return json(400, { error: "missing MessageSid/AccountSid/MessageStatus" });
  }

  const signature = req.headers.get("x-twilio-signature") ?? "";
  if (!signature) return json(403, { error: "missing signature" });

  const platformAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const platformAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!platformAccountSid || !platformAuthToken) {
    // STORY-079: ACK rather than 5xx — see header note on retry storms.
    console.error("twilio/status: platform creds missing, ack-and-drop");
    return json(200, { ok: true, ignored: "platform_creds_missing" });
  }

  const fullUrl = computeFullUrl(req);
  const platformExpected = await twilioSignature(
    platformAuthToken,
    fullUrl,
    params,
  );
  const platformSigOk =
    constantTimeEq(accountSid, platformAccountSid) &&
    constantTimeEq(platformExpected, signature);

  const service = serviceClient();
  if (!service) return json(503, { error: "service_role_unavailable" });
  // deno-lint-ignore no-explicit-any
  const sb = service as any;

  const { data: row, error: rowErr } = await sb
    .from("sms_messages")
    .select("id, tenant_id, mode")
    .eq("twilio_sid", messageSid)
    .maybeSingle();
  if (rowErr) {
    console.error("twilio/status: row lookup failed", rowErr);
    return json(500, { error: "lookup failed" });
  }

  if (!row) {
    // STORY-078: an unknown SID must still fail closed on a bad
    // signature, otherwise the response distinguishes "valid SID" from
    // "any SID" and leaks an enumeration oracle.
    if (!platformSigOk) return json(403, { error: "bad signature" });
    return json(200, { ok: true, ignored: true });
  }

  if (row.mode === "byok") {
    // Legacy per-tenant credentials — re-verify with the tenant's token.
    const { data: cfg, error: cfgErr } = await sb
      .from("tenant_sms_config")
      .select("twilio_account_sid, twilio_auth_token")
      .eq("tenant_id", row.tenant_id)
      .maybeSingle();
    if (cfgErr || !cfg?.twilio_account_sid || !cfg?.twilio_auth_token) {
      console.error("twilio/status: BYOK creds missing", row.tenant_id, cfgErr);
      return json(403, { error: "byok creds missing" });
    }
    const byokExpected = await twilioSignature(
      cfg.twilio_auth_token,
      fullUrl,
      params,
    );
    const byokSigOk =
      constantTimeEq(accountSid, cfg.twilio_account_sid) &&
      constantTimeEq(byokExpected, signature);
    if (!byokSigOk) return json(403, { error: "bad signature" });
  } else if (!platformSigOk) {
    return json(403, { error: "bad signature" });
  }

  const status = STATUS_MAP[messageStatus.toLowerCase()] ?? "failed";
  const errorCode = params.get("ErrorCode") || null;
  const errorMessage = params.get("ErrorMessage") || null;

  const update: Record<string, unknown> = { status };
  if (errorCode) update.error_code = errorCode;
  if (errorMessage) update.error_message = errorMessage;
  if (TERMINAL.has(status)) update.delivered_at = new Date().toISOString();

  const { error: updErr } = await sb
    .from("sms_messages")
    .update(update)
    .eq("twilio_sid", messageSid);
  if (updErr) {
    console.error("twilio/status: update failed", updErr);
    return json(500, { error: "update failed" });
  }

  return json(200, { ok: true });
});
