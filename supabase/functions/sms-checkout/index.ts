// sms-checkout — ОПЛАТА ПОПОЛНЕНИЯ БАЛАНСА SMS НА САЙТЕ (STORY-089, волна 3).
//
// Владелец 24.09: «пополняет просто через нашу CRM свой кабинет… чтоб не брал
// Apple… все подписки будем оформлять через сайт». Поэтому этот вход зовёт
// ТОЛЬКО веб-версия (babun.app): в iOS-приложении нет ни кнопки, ни ссылки на
// оплату — правило Apple о цифровых товарах.
//
// Что делает: проверяет, что зовёт владелец аккаунта — или партнёр с правом
// «SMS: Пополняет» (`cabinet.sms`, владелец 04.10: «чтоб кто-то тоже мог
// оплачивать, но зафиксировано за нашей командой»), — и открывает Stripe
// Checkout на выбранную сумму. Аккаунт — из заголовка `x-babun-tenant`:
// Кабинет ставит его из блока аккаунта, а не из открытого календаря, и имя
// аккаунта стоит в строке оплаты на странице Stripe. Деньги зачисляет не эта функция, а
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

/** Сумма пополнения — любая целыми евро от €5 до €500 (владелец 30.09:
 *  «вписываю туда сумму и нажимаю оплатить»). Те же пределы держит база
 *  (`sms_topup_min_cents` / `sms_topup_max_cents`, `sms_credit_topup`): сумму
 *  вне их вебхук не зачислит. Метка оплаты — «eur30». */
const MIN_CENTS = 500;
const MAX_CENTS = 50000;

function packOf(amount: number): string | null {
  if (!Number.isInteger(amount) || amount % 100 !== 0) return null;
  if (amount < MIN_CENTS || amount > MAX_CENTS) return null;
  return `eur${amount / 100}`;
}

/** Куда можно вернуть человека после оплаты. */
const RETURN_ORIGINS = [
  "https://babun.app",
  "https://www.babun.app",
  "http://localhost:8081",
  "http://localhost:8082",
];
const DEFAULT_RETURN = "https://babun.app/cabinet/sms";

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

/** Служебный клиент — только чтобы найти Stripe-клиента компании для
 *  автопополнения (функция базы закрыта от вошедших людей). */
function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  let serviceKey: string | undefined;
  if (secretKeysJson) {
    try {
      const keys = Object.values(JSON.parse(secretKeysJson) as Record<string, unknown>).filter(
        (v): v is string => typeof v === "string" && v.length > 20,
      );
      serviceKey = keys.find((v) => v.startsWith("sb_secret_")) ?? keys[0];
    } catch {
      // запасной ключ ниже
    }
  }
  serviceKey ??= Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || undefined;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Пороги автопополнения, центы EUR. */
const THRESHOLDS = [500, 1000, 2500];

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
  const [{ data: tenantId }, { data: role }, { data: canTopUp }, { data: profile }] = await Promise.all([
    asUser.rpc("current_tenant_id"),
    asUser.rpc("current_user_role"),
    asUser.rpc("access_company", { p_block: "cabinet.sms", p_min: "write" }),
    asUser.rpc("current_tenant_profile_safe"),
  ]);
  // Владелец — всегда; партнёр — при «SMS: Пополняет» в ЭТОМ аккаунте.
  if (typeof tenantId !== "string" || (role !== "owner" && canTopUp !== true)) {
    return json(403, { error: "owner_only" });
  }
  const accountName = String((profile as { name?: unknown } | null)?.name ?? "").trim();

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // пустое тело — ниже отказ по сумме
  }
  const amount = Number(body.amount_cents);
  const pack = packOf(amount);
  if (!pack) return json(400, { error: "bad_amount" });
  const back = safeReturn(body.return_url);

  const form = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": String(amount),
    // Чей баланс — прямо в строке оплаты: партнёр не спутает со своим.
    "line_items[0][price_data][product_data][name]": accountName ? `Баланс SMS · ${accountName}` : "Баланс SMS · Babun",
    client_reference_id: tenantId,
    "metadata[kind]": "sms_topup",
    "metadata[tenant_id]": tenantId,
    "metadata[pack_id]": pack,
    "metadata[amount_cents]": String(amount),
    "payment_intent_data[metadata][kind]": "sms_topup",
    "payment_intent_data[metadata][tenant_id]": tenantId,
    "payment_intent_data[metadata][pack_id]": pack,
    "payment_intent_data[metadata][amount_cents]": String(amount),
    // Только евро: пересчёт в местную валюту покупателя дал бы вебхуку
    // сумму в чужих «центах».
    "adaptive_pricing[enabled]": "false",
    success_url: `${back}?topup=paid`,
    cancel_url: `${back}?topup=cancelled`,
  });

  // АВТОПОПОЛНЕНИЕ (волна 13): эта оплата ещё и сохраняет карту — дальше
  // сервер сам пополняет на ту же сумму, когда баланс ниже порога. Карта
  // живёт в Stripe; у нас — только её клиент, способ оплаты и «Visa •••• 4242».
  const auto = body.autotopup && typeof body.autotopup === "object" ? (body.autotopup as Record<string, unknown>) : null;
  if (auto) {
    // Автопополнение сохраняет карту на аккаунт — это делает только владелец.
    if (role !== "owner") return json(403, { error: "owner_only" });
    const threshold = Number(auto.threshold_cents);
    if (!THRESHOLDS.includes(threshold)) return json(400, { error: "bad_threshold" });
    const service = serviceClient();
    if (!service) return json(503, { error: "service_role_unavailable" });
    const { data: customer } = await service.rpc("sms_autotopup_customer", { p_tenant: tenantId });
    if (typeof customer === "string" && customer) form.set("customer", customer);
    else form.set("customer_creation", "always");
    form.set("payment_intent_data[setup_future_usage]", "off_session");
    // Для автопополнения — только карта (с Apple Pay / Google Pay): отложенные
    // способы вроде SEPA подтверждаются днями, и списание пошло бы вслепую.
    form.set("payment_method_types[0]", "card");
    form.set("metadata[autotopup]", "1");
    form.set("metadata[threshold_cents]", String(threshold));
  }

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
