// invite-email — ПИСЬМО-ПРИГЛАШЕНИЕ С АДРЕСА BABUN.
//
// Зовёт приложение сразу после `create_invitation` (и по «Отправить ещё раз»):
//   POST { invitation_id }  +  Authorization: Bearer <токен владельца>
//                           +  x-babun-tenant: <активная компания>
//
// Сервисного ключа здесь нет намеренно. Данные письма берёт
// `claim_invitation_email` КЛЮЧОМ ЗВОНЯЩЕГО: сервер сам проверяет, что это
// владелец активной компании и что приглашение открыто, ставит штамп отправки и
// держит лимиты. Функция только рисует письмо (`render.ts`) и отдаёт его Resend.
//
// Секреты Edge Functions:
//   RESEND_API_KEY      — ключ Resend (тот же, что паролем SMTP у Supabase Auth)
//   INVITE_EMAIL_FROM   — необязательно, по умолчанию «Babun <noreply@babun.app>»
//   INVITE_LINK_ORIGIN  — необязательно, по умолчанию https://babun.app
//
// Ответ: 200 { sent: true, to } либо { sent: false, reason } с кодом:
//   not_signed_in 401 · no_company 400 · bad_request 400 · email_not_configured 503
//   not_owner 403 · not_found 404 · closed 409 · calendar_archived 409
//   too_soon 429 · tenant_limit 429 · send_failed 502 · server_error 500

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

import { renderInvitationEmail, type InvitationEmailPayload } from "./render.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-client-info, apikey, x-babun-tenant",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HINT_STATUS: Record<string, number> = {
  not_owner: 403,
  not_found: 404,
  closed: 409,
  calendar_archived: 409,
  too_soon: 429,
  tenant_limit: 429,
};

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function publicKey(): string | undefined {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  const json = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (!json) return undefined;
  try {
    const values = Object.values(JSON.parse(json) as Record<string, unknown>).filter(
      (value): value is string => typeof value === "string" && value.length > 20,
    );
    return values.find((value) => value.startsWith("sb_publishable_")) ?? values[0];
  } catch {
    return undefined;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { sent: false, reason: "bad_request" });

  const authorization = req.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(authorization)) {
    return reply(401, { sent: false, reason: "not_signed_in" });
  }
  const tenant = req.headers.get("x-babun-tenant") ?? "";
  if (!UUID_RE.test(tenant)) return reply(400, { sent: false, reason: "no_company" });

  let invitationId = "";
  try {
    const body = (await req.json()) as { invitation_id?: unknown };
    invitationId = typeof body.invitation_id === "string" ? body.invitation_id : "";
  } catch {
    invitationId = "";
  }
  if (!UUID_RE.test(invitationId)) return reply(400, { sent: false, reason: "bad_request" });

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = publicKey();
  // До штампа: без ключа письмо не уйдёт, и лимит «не чаще минуты» не должен
  // сгорать впустую.
  if (!resendKey) return reply(503, { sent: false, reason: "email_not_configured" });
  if (!url || !anonKey) return reply(500, { sent: false, reason: "server_error" });

  const caller = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization, "x-babun-tenant": tenant } },
  });

  const { data, error } = await caller.rpc("claim_invitation_email", {
    p_invitation_id: invitationId,
  });
  if (error) {
    const hint = typeof error.hint === "string" && error.hint.startsWith("invite_email:")
      ? error.hint.slice("invite_email:".length)
      : "";
    if (hint && HINT_STATUS[hint]) return reply(HINT_STATUS[hint], { sent: false, reason: hint });
    console.error("invite-email claim failed", { code: error.code });
    return reply(500, { sent: false, reason: "server_error" });
  }

  const payload = data as (InvitationEmailPayload & { claimed_at?: string }) | null;
  if (!payload || typeof payload.email !== "string" || typeof payload.token !== "string") {
    return reply(500, { sent: false, reason: "server_error" });
  }

  let mail;
  try {
    mail = renderInvitationEmail(payload, Deno.env.get("INVITE_LINK_ORIGIN") ?? "https://babun.app");
  } catch (renderError) {
    console.error("invite-email render failed", { message: String(renderError) });
    return reply(500, { sent: false, reason: "server_error" });
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
      // Повтор одного и того же штампа не шлёт второе письмо.
      "Idempotency-Key": `invite-email/${invitationId}/${payload.claimed_at ?? ""}`,
    },
    body: JSON.stringify({
      from: Deno.env.get("INVITE_EMAIL_FROM") ?? "Babun <noreply@babun.app>",
      to: [payload.email],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
  });

  if (!response.ok) {
    console.error("invite-email resend failed", { status: response.status });
    return reply(502, { sent: false, reason: "send_failed" });
  }
  return reply(200, { sent: true, to: payload.email });
});
