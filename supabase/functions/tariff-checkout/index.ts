// tariff-checkout — ОПЛАТА ТАРИФА «СОЛО · ПРО · МАКС» НА СТРАНИЦЕ STRIPE
// (владелец 01.10; оплата — не через Apple, а в браузере).
//
// Что умеет (поле `action`):
//   • "checkout" (по умолчанию) — подписка на выбранный тариф. Подписки ещё
//     нет — открывает Stripe Checkout и отдаёт адрес. Подписка уже есть —
//     меняет в ней тариф (пересчёт за остаток периода делает Stripe) и
//     отвечает `{ changed: true }`. Идёт свой пробный период — списание
//     начнётся в его последний день, а не сегодня: 14 дней — без оплаты.
//   • "portal" — страница Stripe «Управление подпиской»: карта, счета,
//     отмена. Её нужно один раз включить в Stripe (Settings → Billing →
//     Customer portal); пока не включена — отвечаем `portal_not_configured`.
//
// Тариф на нашей стороне меняет НЕ эта функция, а вебхук `stripe-webhook`
// по событиям подписки (`customer.subscription.*`): цена несёт метку тарифа
// (`metadata.tier`, `lookup_key` babun_<tier>_<period>). Цены заводятся здесь
// сами при первой оплате — в Stripe руками ничего создавать не нужно.
//
// Понижение тарифа: партнёров больше, чем даёт новый тариф, — отказ
// «сначала уберите лишних» (владелец 01.10). Команд больше — можно: лишние
// встают «только смотреть», рабочие владелец выбирает в «Тариф».
//
// Кто зовёт: владелец аккаунта (JWT + `x-babun-tenant`); аккаунт и роль
// отвечает сама база (`current_tenant_id`, `current_user_role`).
// Секреты: STRIPE_SECRET_KEY (заводит владелец) и служебный ключ проекта.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

type Tier = "solo" | "pro" | "max";
type Period = "month" | "year";

/** Цены в центах EUR — те же, что на странице «Тариф» (`tiers.ts`). Год —
 *  цена месяца при оплате за год × 12. */
const PRICES: Record<Tier, Record<Period, number>> = {
  solo: { month: 699, year: 499 * 12 },
  pro: { month: 2999, year: 2199 * 12 },
  max: { month: 5999, year: 4499 * 12 },
};
const NAMES: Record<Tier, string> = { solo: "Соло", pro: "Про", max: "Макс" };
/** Партнёров в тарифе — те же числа, что `tenant_tier_limit` в базе. */
const PARTNERS: Record<Tier, number> = { solo: 0, pro: 5, max: 50 };

const RETURN_ORIGINS = [
  "https://babun.app",
  "https://www.babun.app",
  "http://localhost:8081",
  "http://localhost:8082",
];
const DEFAULT_RETURN = "https://babun.app/pay/done";

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

function keysFrom(envName: string, prefix: string): string | undefined {
  const raw = Deno.env.get(envName);
  if (!raw) return undefined;
  try {
    const keys = Object.values(JSON.parse(raw) as Record<string, unknown>).filter(
      (v): v is string => typeof v === "string" && v.length > 20,
    );
    return keys.find((v) => v.startsWith(prefix)) ?? keys[0];
  } catch {
    return undefined;
  }
}

const publishableKey = () =>
  keysFrom("SUPABASE_PUBLISHABLE_KEYS", "sb_publishable_") ?? (Deno.env.get("SUPABASE_ANON_KEY") || undefined);

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = keysFrom("SUPABASE_SECRET_KEYS", "sb_secret_") ?? (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || undefined);
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
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

const isTier = (v: unknown): v is Tier => v === "solo" || v === "pro" || v === "max";

class StripeError extends Error {
  constructor(public status: number, public code: string | undefined, message: string) {
    super(message);
  }
}

/** Запрос к Stripe API формой — без SDK, как `sms-checkout`. */
async function stripe(
  key: string,
  method: "GET" | "POST",
  path: string,
  params?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const url = method === "GET" && body ? `https://api.stripe.com/v1/${path}?${body}` : `https://api.stripe.com/v1/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? body : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (data.error ?? {}) as { code?: string; message?: string };
    throw new StripeError(res.status, err.code, err.message ?? `stripe ${res.status}`);
  }
  return data;
}

/** Цена тарифа — по `lookup_key`; нет — заводим товар и цену один раз. */
async function priceFor(key: string, tier: Tier, period: Period): Promise<string> {
  const lookup = `babun_${tier}_${period}`;
  const found = await stripe(key, "GET", "prices", { "lookup_keys[]": lookup, active: "true", limit: "1" });
  const existing = (found.data as { id: string }[] | undefined)?.[0]?.id;
  if (existing) return existing;
  const productId = `babun_${tier}`;
  try {
    await stripe(key, "GET", `products/${productId}`);
  } catch (e) {
    if (!(e instanceof StripeError) || e.status !== 404) throw e;
    await stripe(key, "POST", "products", {
      id: productId,
      name: `Babun ${NAMES[tier]}`,
      "metadata[tier]": tier,
    });
  }
  const price = await stripe(key, "POST", "prices", {
    product: productId,
    currency: "eur",
    unit_amount: String(PRICES[tier][period]),
    "recurring[interval]": period,
    lookup_key: lookup,
    transfer_lookup_key: "true",
    nickname: `${NAMES[tier]} · ${period === "month" ? "месяц" : "год"}`,
    "metadata[tier]": tier,
    "metadata[period]": period,
  });
  return price.id as string;
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

  const headers: Record<string, string> = { Authorization: auth };
  const tenantHeader = request.headers.get("x-babun-tenant");
  if (tenantHeader) headers["x-babun-tenant"] = tenantHeader;
  const asUser = createClient(url, anon, {
    global: { headers },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [{ data: tenantId }, { data: role }, { data: userData }] = await Promise.all([
    asUser.rpc("current_tenant_id"),
    asUser.rpc("current_user_role"),
    asUser.auth.getUser(auth.slice("Bearer ".length)),
  ]);
  if (typeof tenantId !== "string" || role !== "owner") return json(403, { error: "owner_only" });

  const service = serviceClient();
  if (!service) return json(503, { error: "service_role_unavailable" });

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // пустое тело — ниже отказ по тарифу
  }
  const action = body.action === "portal" ? "portal" : "checkout";
  const back = safeReturn(body.return_url);

  const { data: tenant, error: tenantError } = await service
    .from("tenants")
    .select("id, name, stripe_customer_id, stripe_subscription_id, subscription_status, plan_override, trial_tier, trial_ends_at")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantError || !tenant) return json(404, { error: "tenant_not_found" });

  try {
    if (action === "portal") {
      if (!tenant.stripe_customer_id) return json(409, { error: "no_subscription" });
      try {
        const portal = await stripe(stripeKey, "POST", "billing_portal/sessions", {
          customer: tenant.stripe_customer_id,
          return_url: `${back}?tariff=portal`,
        });
        return json(200, { url: portal.url });
      } catch (e) {
        if (e instanceof StripeError && /configuration/i.test(e.message)) {
          return json(409, { error: "portal_not_configured" });
        }
        throw e;
      }
    }

    const tier = body.tier;
    if (!isTier(tier)) return json(400, { error: "bad_tier" });
    const period: Period = body.period === "year" ? "year" : "month";
    if (tenant.plan_override) return json(409, { error: "forever" });

    const priceId = await priceFor(stripeKey, tier, period);
    const live = ["active", "trialing", "past_due"].includes(String(tenant.subscription_status ?? ""));

    // ПОДПИСКА УЖЕ ЕСТЬ — МЕНЯЕМ В НЕЙ ТАРИФ, А НЕ ЗАВОДИМ ВТОРУЮ.
    if (live && tenant.stripe_subscription_id) {
      const { data: people } = await service.rpc("tariff_partner_count", { p_tenant: tenantId });
      if (typeof people === "number" && people > PARTNERS[tier]) {
        return json(409, { error: "too_many_partners", limit: PARTNERS[tier] });
      }
      const sub = await stripe(stripeKey, "GET", `subscriptions/${tenant.stripe_subscription_id}`);
      const item = (sub.items as { data?: { id: string; price?: { id?: string } }[] } | undefined)?.data?.[0];
      if (!item) return json(409, { error: "subscription_without_items" });
      if (item.price?.id === priceId) return json(200, { changed: false });
      await stripe(stripeKey, "POST", `subscriptions/${tenant.stripe_subscription_id}`, {
        "items[0][id]": item.id,
        "items[0][price]": priceId,
        proration_behavior: "create_prorations",
        "metadata[tenant_id]": tenantId,
        "metadata[tier]": tier,
      });
      return json(200, { changed: true });
    }

    // Клиент Stripe аккаунта: свой, иначе тот, что завёлся для SMS, иначе новый.
    let customer = tenant.stripe_customer_id as string | null;
    if (!customer) {
      const { data: smsCustomer } = await service.rpc("sms_autotopup_customer", { p_tenant: tenantId });
      if (typeof smsCustomer === "string" && smsCustomer) customer = smsCustomer;
    }
    if (!customer) {
      const email = userData?.user?.email;
      const created = await stripe(stripeKey, "POST", "customers", {
        name: String(tenant.name ?? ""),
        ...(email ? { email } : {}),
        "metadata[tenant_id]": tenantId,
      });
      customer = created.id as string;
    }
    if (customer !== tenant.stripe_customer_id) {
      await service.from("tenants").update({ stripe_customer_id: customer }).eq("id", tenantId);
    }

    const form: Record<string, string> = {
      mode: "subscription",
      customer,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      client_reference_id: tenantId,
      "metadata[kind]": "tariff",
      "metadata[tenant_id]": tenantId,
      "metadata[tier]": tier,
      "subscription_data[metadata][tenant_id]": tenantId,
      "subscription_data[metadata][tier]": tier,
      success_url: `${back}?tariff=paid`,
      cancel_url: `${back}?tariff=cancelled`,
    };
    // Идёт свой пробный — списание с его последнего дня (Stripe требует
    // запас не меньше двух суток; ближе к концу — платим сразу).
    const trialEnd = tenant.trial_ends_at ? Date.parse(String(tenant.trial_ends_at)) : NaN;
    if (tenant.trial_tier && Number.isFinite(trialEnd) && trialEnd - Date.now() > 49 * 3600 * 1000) {
      form["subscription_data[trial_end]"] = String(Math.floor(trialEnd / 1000));
    }
    const session = await stripe(stripeKey, "POST", "checkout/sessions", form);
    if (!session.url) return json(502, { error: "stripe_failed" });
    return json(200, { url: session.url });
  } catch (e) {
    console.error("tariff-checkout:", action, e instanceof Error ? e.message : String(e));
    return json(502, { error: "stripe_failed" });
  }
});
