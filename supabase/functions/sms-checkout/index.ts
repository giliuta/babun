// sms-checkout — ОПЛАТА ПОПОЛНЕНИЯ БАЛАНСА SMS НА САЙТЕ (STORY-089, волна 3).
//
// Владелец 24.09: «пополняет просто через нашу CRM свой кабинет… чтоб не брал
// Apple… все подписки будем оформлять через сайт». Поэтому этот вход зовёт
// ТОЛЬКО веб-версия (babun.app): в iOS-приложении нет ни кнопки, ни ссылки на
// оплату — правило Apple о цифровых товарах.
//
// Что делает: проверяет, что зовёт владелец активной компании, и открывает
// Stripe Checkout на выбранную сумму. Деньги зачисляет не эта функция, а
// вебхук `stripe-webhook` по факту оплаты (`sms_credit_topup`), — отсюда
// баланс не меняется никак.
//
// Кто зовёт: вошедший человек, JWT + заголовок `x-babun-tenant` (его ставит
// клиент Supabase приложения). Компанию и роль отвечает сама база теми же
// функциями, что и везде (`current_tenant_id`, `current_user_role`) — чужую
// компанию заголовком не подставить.
//
// Секреты (заводит владелец): STRIPE_SECRET_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

/** Суммы пополнения, центы EUR. Любая другая сумма — отказ. */
const PACKS: Record<number, string> = {
  1000: "eur10",
  2500: "eur25",
  5000: "eur50",
  10000: "eur100",
};

/** Куда можно вернуть человека после оплаты. */
const RETURN_ORIGINS = [
  "https://babun.app",
  "https://www.babun.app",
  "http://localhost:8081",
  "http://localhost:8082",
];
const DEFAULT_RETURN = "https://babun.app/clients/sms";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-babun-tenant",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

/** Публичный ключ проекта: новый `SUPABASE_PUBLISHABLE_KEYS` (JSON), а
 *  устаревший `SUPABASE_ANON_KEY` — только запасным. */
function publishableKey(): string | undefined {
  const json = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (json) {
    try {
      const keys = Object.values(JSON.parse(json) as Record<string, unknown>).filter(
        (v): v is string => typeof v === "string" && v.length > 20,
      );
      const key = keys.find((v) => v.startsWith("sb_publishable_")) ?? keys[0];
      if (key) return key;
    } catch {
      // запасной ключ ниже
    }
  }
  return Deno.env.get("SUPABASE_ANON_KEY") || undefined;
}

function safeReturn(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_RETURN;
  try {
    const url = new URL(value);
    return RETURN_ORIGINS.includes(url.origin) ? `${url.origin}${url.pathname}` : DEFAULT_RETURN;
  } catch {
    return DEFAULT_RETURN;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return json(503, { error: "stripe_not_configured" });

  const auth = request.headers.get("authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL");
  const anon = publishableKey();
  if (!auth.startsWith("Bearer ") || !url || !anon) return json(401, { error: "unauthorized" });

  // Клиент ОТ ЛИЦА человека: база сама решит, чья это компания и кто он в ней.
  const headers: Record<string, string> = { Authorization: auth };
  const tenantHeader = request.headers.get("x-babun-tenant");
  if (tenantHeader) headers["x-babun-tenant"] = tenantHeader;
  const asUser = createClient(url, anon, {
    global: { headers },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [{ data: tenantId }, { data: role }] = await Promise.all([
    asUser.rpc("current_tenant_id"),
    asUser.rpc("current_user_role"),
  ]);
  if (typeof tenantId !== "string" || role !== "owner") {
    return json(403, { error: "owner_only" });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // пустое тело — ниже отказ по сумме
  }
  const amount = Number(body.amount_cents);
  const pack = PACKS[amount];
  if (!pack) return json(400, { error: "bad_amount" });
  const back = safeReturn(body.return_url);

  const form = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": String(amount),
    "line_items[0][price_data][product_data][name]": "Баланс SMS · Babun",
    client_reference_id: tenantId,
    "metadata[kind]": "sms_topup",
    "metadata[tenant_id]": tenantId,
    "metadata[pack_id]": pack,
    "metadata[amount_cents]": String(amount),
    "payment_intent_data[metadata][kind]": "sms_topup",
    "payment_intent_data[metadata][tenant_id]": tenantId,
    success_url: `${back}?topup=paid`,
    cancel_url: `${back}?topup=cancelled`,
  });

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const session = (await res.json().catch(() => ({}))) as { url?: string; error?: { message?: string } };
  if (!res.ok || !session.url) {
    console.error("sms-checkout: stripe refused", res.status, session.error?.message);
    return json(502, { error: "stripe_failed" });
  }
  return json(200, { url: session.url });
});
