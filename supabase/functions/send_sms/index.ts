// send_sms — КУРЬЕР ОЧЕРЕДИ SMS (STORY-089, волна 2).
//
// Решает всё база (миграция 20260924220000_sms_service): кому, когда, по
// какому шаблону, можно ли и хватает ли денег. Эта функция только:
//   1. забирает пачку очереди (`sms_claim`, SKIP LOCKED — два запуска не
//      возьмут одно сообщение);
//   2. собирает текст из шаблона и полей записи теми же правилами, что
//      приложение (`render.ts`); ручное сообщение приходит готовым текстом;
//   3. считает части SMS (`encoding.ts`) и списывает (`sms_charge`): сначала
//      бесплатные части, потом баланс; не хватило — сообщение 'blocked';
//   4. отдаёт Twilio и пишет итог (`sms_mark`); отказ Twilio возвращает
//      списанное.
//
// Кто её зовёт: база (`sms_wake` после постановки в очередь и тик
// расписания раз в 5 минут) с заголовком `x-cron-secret` из
// `edge_cron_secrets`. Никто другой — JWT здесь не принимается.
//
// Секреты (заводит владелец): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN; по
// желанию TWILIO_STATUS_CALLBACK_URL (иначе — наша функция twilio-status).
// Без ключей Twilio функция ничего не списывает и не трогает очередь:
// сообщения ждут, пока ключи не появятся.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";
import { analyzeSmsEncoding } from "./encoding.ts";
import { renderSms, type SmsRenderVars } from "./render.ts";

const PLATFORM_SENDER = "Babun";
const BATCH = 20;
const MAX_BATCHES = 10;

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
      serviceKey = candidates.find((v) => v.startsWith("sb_secret_")) ?? candidates[0];
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

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

// deno-lint-ignore no-explicit-any
async function authorized(sb: any, request: Request): Promise<boolean> {
  const supplied = request.headers.get("x-cron-secret") ?? "";
  if (!supplied) return false;
  const { data, error } = await sb
    .from("edge_cron_secrets")
    .select("secret")
    .eq("name", "send_sms")
    .single();
  return !error && typeof data?.secret === "string" && constantTimeEqual(supplied, data.secret);
}

interface Twilio {
  accountSid: string;
  authToken: string;
  statusCallbackUrl: string;
}

function twilioFromEnv(): Twilio | null {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!accountSid || !authToken) return null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  return {
    accountSid,
    authToken,
    statusCallbackUrl:
      Deno.env.get("TWILIO_STATUS_CALLBACK_URL") ?? `${supabaseUrl}/functions/v1/twilio-status`,
  };
}

type SendResult =
  | { ok: true; sid: string }
  | { ok: false; code: string; message: string };

async function twilioSend(tw: Twilio, from: string, to: string, body: string): Promise<SendResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(tw.accountSid)}/Messages.json`;
  const form = new URLSearchParams({ To: to, From: from, Body: body, StatusCallback: tw.statusCallbackUrl });
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${tw.accountSid}:${tw.authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
  } catch (err) {
    return { ok: false, code: "network", message: err instanceof Error ? err.message : String(err) };
  }
  let payload: Record<string, unknown> = {};
  try {
    payload = await res.json();
  } catch {
    // пустое тело — ниже решает код ответа
  }
  if (!res.ok) {
    return {
      ok: false,
      code: payload.code != null ? String(payload.code) : `http_${res.status}`,
      message: typeof payload.message === "string" ? payload.message : `Twilio HTTP ${res.status}`,
    };
  }
  return { ok: true, sid: String(payload.sid ?? "") };
}

/** Номер для Twilio: E.164 с плюсом. Номер без кода страны Twilio не
 *  примет — такой сообщение уйдёт в отказ с понятной причиной. */
function e164(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, "");
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  if (/^00\d{8,15}$/.test(digits)) return `+${digits.slice(2)}`;
  return null;
}

interface Claimed {
  id: string;
  to_phone: string;
  body: string | null;
  trigger_type: string;
  template_body: string | null;
  sender: string | null;
  vars: SmsRenderVars;
}

// deno-lint-ignore no-explicit-any
async function mark(sb: any, id: string, status: "sent" | "failed", sid: string | null, code: string | null, message: string | null) {
  const { error } = await sb.rpc("sms_mark", {
    p_id: id,
    p_status: status,
    p_sid: sid,
    p_error_code: code,
    p_error_message: message,
  });
  if (error) console.error("sms_mark failed", id, error.message);
}

// deno-lint-ignore no-explicit-any
async function deliver(sb: any, tw: Twilio, row: Claimed): Promise<"sent" | "failed" | "blocked"> {
  const text = row.body?.trim() || renderSms(row.template_body, row.vars ?? {});
  if (!text) {
    await mark(sb, row.id, "failed", null, "template", "Шаблон удалён или не заполнился полями записи");
    return "failed";
  }
  const to = e164(row.to_phone);
  if (!to) {
    await mark(sb, row.id, "failed", null, "phone", "Номер без кода страны");
    return "failed";
  }
  const segments = analyzeSmsEncoding(text).segments;
  const { data: charge, error: chargeError } = await sb.rpc("sms_charge", {
    p_id: row.id,
    p_body: text,
    p_segments: segments,
  });
  if (chargeError) {
    await mark(sb, row.id, "failed", null, "charge", chargeError.message);
    return "failed";
  }
  if (charge === "no_funds") return "blocked";
  if (charge !== "free" && charge !== "paid") return "failed";

  const result = await twilioSend(tw, row.sender || PLATFORM_SENDER, to, text);
  if (result.ok) {
    await mark(sb, row.id, "sent", result.sid, null, null);
    return "sent";
  }
  await mark(sb, row.id, "failed", null, result.code, result.message);
  return "failed";
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  const sb = serviceClient();
  if (!sb) return json(503, { error: "service_role_unavailable" });
  if (!(await authorized(sb, request))) return json(401, { error: "unauthorized" });

  // Без ключей Twilio очередь не трогаем: ничего не списано, сообщения
  // ждут, пока владелец заведёт сервис.
  const tw = twilioFromEnv();
  if (!tw) return json(200, { ok: true, skipped: "twilio_not_configured" });

  const counts = { sent: 0, failed: 0, blocked: 0 };
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data, error } = await sb.rpc("sms_claim", { p_limit: BATCH });
    if (error) {
      console.error("sms_claim failed", error.message);
      return json(500, { error: "claim_failed", ...counts });
    }
    const rows = (data ?? []) as Claimed[];
    if (rows.length === 0) break;
    for (const row of rows) {
      try {
        counts[await deliver(sb, tw, row)] += 1;
      } catch (err) {
        counts.failed += 1;
        await mark(sb, row.id, "failed", null, "exception", err instanceof Error ? err.message : String(err));
      }
    }
  }
  return json(200, { ok: true, ...counts });
});
