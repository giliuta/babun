// tariff-checkout — ОПЛАТА ЗА КАЛЕНДАРИ НА СТРАНИЦЕ STRIPE (владелец 12.10:
// «цена за календарь», €9.99 в месяц / €7.99 при оплате за год; люди
// бесплатно). Оплата — не через Apple, а в браузере.
//
// Подписка одна на аккаунт: одна цена «календарь», количество — живые
// календари аккаунта. Добавили или убрали календарь — количество меняется со
// следующего платежа (`proration_behavior: none`): действие "sync" после
// создания/архива и сверка вебхуком перед счётом (`invoice.upcoming`).
// Старые клиенты шлют `tier` solo/pro/max — любой означает «календари».
//
// Что умеет (поле `action`):
//   • "checkout" (по умолчанию) — подписка на выбранный тариф. Подписки ещё
//     нет — открывает Stripe Checkout и отдаёт адрес. Подписка уже есть —
//     меняет в ней тариф (пересчёт за остаток периода делает Stripe) и
//     отвечает `{ changed: true }`. Идёт свой пробный период — списание
//     начнётся в его последний день, а не сегодня: 14 дней — без оплаты.
//   • "sync" — количество календарей в живой подписке = живым календарям.
//   • "portal" — страница Stripe «Управление подпиской»: карта, счета,
//     отмена. Её нужно один раз включить в Stripe (Settings → Billing →
//     Customer portal); пока не включена — отвечаем `portal_not_configured`.
//
// Тариф на нашей стороне меняет НЕ эта функция, а вебхук `stripe-webhook`
// по событиям подписки (`customer.subscription.*`): цена несёт метку
// (`metadata.tier` = max, `lookup_key` babun_calendar_<period>), количество —
// `paid_calendars`. Цены заводятся здесь сами при первой оплате — в Stripe
// руками ничего создавать не нужно. Людей не считаем: партнёры бесплатно.
//
// Кто зовёт: владелец аккаунта (JWT + `x-babun-tenant`); аккаунт и роль
// отвечает сама база (`current_tenant_id`, `current_user_role`). Партнёр с
// правом «Тариф: Оплачивает» (`cabinet.tariff`, владелец 04.10) только
// оформляет и оплачивает тариф, пока подписки нет: сменить тариф в живой
// подписке и открыть «Управление подпиской» — списания с карты владельца —
// может лишь сам владелец. Имя аккаунта стоит на странице оплаты.
// Секреты: STRIPE_SECRET_KEY (заводит владелец) и служебный ключ проекта.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";
import { keyFromEnv, serviceClient } from "../_shared/service-client.ts";
import { json as jsonResponse } from "../_shared/http.ts";
import {
  checkoutIdempotencyKey,
  liveSubscriptionOf,
  openTariffSessions,
  type CheckoutSessionLite,
  type SubscriptionLite,
} from "../_shared/tariff-duplicates.ts";

type Period = "month" | "year";

/** Цена ОДНОГО календаря в центах EUR — та же, что на странице «Тариф»
 *  (`tiers.ts`). Год — цена месяца при оплате за год × 12. */
const CALENDAR_PRICE: Record<Period, number> = { month: 999, year: 799 * 12 };
/** Метка цены для вебхука: оплата календарей — «полный доступ» в базе. */
const PAID_TIER = "max";

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

const json = (status: number, body: unknown): Response => jsonResponse(status, body, cors);


const publishableKey = () =>
  keyFromEnv("SUPABASE_PUBLISHABLE_KEYS", "sb_publishable_") ?? (Deno.env.get("SUPABASE_ANON_KEY") || undefined);


function safeReturn(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_RETURN;
  try {
    const url = new URL(value);
    return RETURN_ORIGINS.includes(url.origin) ? `${url.origin}${url.pathname}` : DEFAULT_RETURN;
  } catch {
    return DEFAULT_RETURN;
  }
}

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
  idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const url = method === "GET" && body ? `https://api.stripe.com/v1/${path}?${body}` : `https://api.stripe.com/v1/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
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

/** Цена календаря — по `lookup_key`; нет — заводим товар и цену один раз. */
async function priceFor(key: string, period: Period): Promise<string> {
  const lookup = `babun_calendar_${period}`;
  const found = await stripe(key, "GET", "prices", { "lookup_keys[]": lookup, active: "true", limit: "1" });
  const existing = (found.data as { id: string }[] | undefined)?.[0]?.id;
  if (existing) return existing;
  const productId = "babun_calendar";
  try {
    await stripe(key, "GET", `products/${productId}`);
  } catch (e) {
    if (!(e instanceof StripeError) || e.status !== 404) throw e;
    await stripe(key, "POST", "products", {
      id: productId,
      name: "Babun · календарь",
      "metadata[tier]": PAID_TIER,
      "metadata[unit]": "calendar",
    });
  }
  const price = await stripe(key, "POST", "prices", {
    product: productId,
    currency: "eur",
    unit_amount: String(CALENDAR_PRICE[period]),
    "recurring[interval]": period,
    lookup_key: lookup,
    transfer_lookup_key: "true",
    nickname: `Календарь · ${period === "month" ? "месяц" : "год"}`,
    "metadata[tier]": PAID_TIER,
    "metadata[unit]": "calendar",
    "metadata[period]": period,
  });
  return price.id as string;
}

/** Живые календари аккаунта — столько и в подписке (не меньше одного).
 *  Ошибка чтения — исключение, а не «один календарь»: молчаливая единица
 *  выставила бы счёт за один календарь при пяти живых. */
// deno-lint-ignore no-explicit-any
async function liveCalendars(service: any, tenantId: string): Promise<number> {
  const { count, error } = await service
    .from("teams")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  if (error || typeof count !== "number") {
    throw new Error(`live calendars unreadable: ${error?.code ?? "no count"}`);
  }
  return Math.max(1, count);
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
  const [{ data: tenantId }, { data: role }, { data: userData }, { data: canPay }] = await Promise.all([
    asUser.rpc("current_tenant_id"),
    asUser.rpc("current_user_role"),
    asUser.auth.getUser(auth.slice("Bearer ".length)),
    asUser.rpc("access_company", { p_block: "cabinet.tariff", p_min: "write" }),
  ]);
  const owner = role === "owner";
  if (typeof tenantId !== "string" || (!owner && canPay !== true)) return json(403, { error: "owner_only" });

  const service = serviceClient();
  if (!service) return json(503, { error: "service_role_unavailable" });

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // пустое тело — ниже отказ по тарифу
  }
  const action = body.action === "portal" ? "portal" : body.action === "sync" ? "sync" : "checkout";
  const back = safeReturn(body.return_url);

  const { data: tenant, error: tenantError } = await service
    .from("tenants")
    .select("id, name, stripe_customer_id, stripe_subscription_id, subscription_status, plan_override, trial_tier, trial_ends_at")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantError || !tenant) return json(404, { error: "tenant_not_found" });

  try {
    if (action === "portal") {
      if (!owner) return json(403, { error: "owner_only" });
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

    const live = ["active", "trialing", "past_due"].includes(String(tenant.subscription_status ?? ""));
    const liveNow = await liveCalendars(service, tenantId);
    // Предложение «Новый календарь» платит и за тот, что заводят: живые + 1,
    // не больше (12.10). Сверка «sync» ставит ровно живые.
    const asked = Number(body.calendars);
    const quantity =
      action === "checkout" && Number.isFinite(asked) && asked > liveNow ? Math.min(asked, liveNow + 1) : liveNow;

    // СВЕРКА КОЛИЧЕСТВА: календарь добавили или убрали — подписка следом,
    // со следующего платежа (владелец 12.10), без доплаты сегодня.
    if (action === "sync") {
      if (tenant.plan_override || !live || !tenant.stripe_subscription_id) return json(200, { synced: false });
      const sub = await stripe(stripeKey, "GET", `subscriptions/${tenant.stripe_subscription_id}`);
      const item = (sub.items as { data?: { id: string; quantity?: number; price?: { lookup_key?: string | null } }[] } | undefined)?.data?.[0];
      if (!item) return json(409, { error: "subscription_without_items" });
      // Количество — только у цены «за календарь». Старая подписка Соло · Про ·
      // Макс стоит фиксированно: её количество, поднятое до числа календарей,
      // умножило бы плоскую цену (тот же сторож, что у вебхука).
      if (!/^babun_calendar_/.test(item.price?.lookup_key ?? "")) return json(200, { synced: false });
      if (item.quantity === quantity) return json(200, { synced: true, quantity });
      await stripe(stripeKey, "POST", `subscriptions/${tenant.stripe_subscription_id}`, {
        "items[0][id]": item.id,
        "items[0][quantity]": String(quantity),
        proration_behavior: "none",
      });
      return json(200, { synced: true, quantity });
    }

    // Период называет страница «Тариф» (месяц или год). Без него — у живой
    // подписки её же период: «Новый календарь» не знает, как платят, и без
    // этого перевёл бы годовую подписку на помесячную цену.
    const chosen: Period | null = body.period === "year" ? "year" : body.period === "month" ? "month" : null;
    if (tenant.plan_override) return json(409, { error: "forever" });

    // ПОДПИСКА УЖЕ ЕСТЬ — ПЕРЕВОДИМ ЕЁ НА ЦЕНУ ЗА КАЛЕНДАРЬ И ЧИСЛО
    // КАЛЕНДАРЕЙ, А НЕ ЗАВОДИМ ВТОРУЮ (старые подписки Соло · Про · Макс).
    if (live && tenant.stripe_subscription_id) {
      // Смена в живой подписке меняет списания с карты владельца.
      if (!owner) return json(409, { error: "owner_only_change" });
      const sub = await stripe(stripeKey, "GET", `subscriptions/${tenant.stripe_subscription_id}`);
      const item = (sub.items as {
        data?: { id: string; quantity?: number; price?: { id?: string; recurring?: { interval?: string } | null } }[];
      } | undefined)?.data?.[0];
      if (!item) return json(409, { error: "subscription_without_items" });
      const period: Period = chosen ?? (item.price?.recurring?.interval === "year" ? "year" : "month");
      const priceId = await priceFor(stripeKey, period);
      if (item.price?.id === priceId && item.quantity === quantity) return json(200, { changed: false });
      await stripe(stripeKey, "POST", `subscriptions/${tenant.stripe_subscription_id}`, {
        "items[0][id]": item.id,
        "items[0][price]": priceId,
        "items[0][quantity]": String(quantity),
        proration_behavior: "none",
      });
      return json(200, { changed: true });
    }

    const priceId = await priceFor(stripeKey, chosen ?? "month");

    // Клиент Stripe аккаунта: свой, иначе тот, что завёлся для SMS, иначе новый.
    let customer = tenant.stripe_customer_id as string | null;
    const superseded: string[] = [];
    if (!customer) {
      const { data: smsCustomer } = await service.rpc("sms_autotopup_customer", { p_tenant: tenantId });
      if (typeof smsCustomer === "string" && smsCustomer) customer = smsCustomer;
    }
    if (customer) {
      // ВТОРОЙ ПОДПИСКИ НЕ БЫВАЕТ. «Подписки нет» здесь — слово аккаунта, а
      // его пишет вебхук: между оплатой и событием Stripe проходят секунды, и
      // второе «Оплатить» в это окно оформило бы вторую подписку. Правда — в
      // Stripe: живая подписка уже есть — оплата прошла, тариф вот-вот
      // придёт (ответ тот же, что у смены тарифа: приложение перечитает
      // аккаунт). Подписок у клиента единицы — хватает одной страницы.
      const subs = await stripe(stripeKey, "GET", "subscriptions", { customer, status: "all", limit: "20" });
      if (liveSubscriptionOf((subs.data as SubscriptionLite[] | undefined) ?? [])) {
        return json(200, { changed: true });
      }
      // Старая открытая страница оплаты, оплаченная после новой, тоже завела
      // бы вторую подписку — гасим её до того, как открыть новую.
      const open = await stripe(stripeKey, "GET", "checkout/sessions", { customer, status: "open", limit: "20" });
      for (const id of openTariffSessions((open.data as CheckoutSessionLite[] | undefined) ?? [])) {
        superseded.push(id);
        try {
          await stripe(stripeKey, "POST", `checkout/sessions/${id}/expire`);
        } catch (e) {
          // Страница уже закрылась сама (оплачена или истекла) — не повод
          // отказывать: оплаченную поймает проверка выше при следующем
          // нажатии, а вторую подписку снимет вебхук.
          console.warn("tariff-checkout: expire", id, e instanceof Error ? e.message : String(e));
        }
      }
    }
    if (!customer) {
      // Почта клиента Stripe — владельца: партнёр платит, но аккаунт не его.
      const email = owner ? userData?.user?.email : undefined;
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
      "line_items[0][quantity]": String(quantity),
      client_reference_id: tenantId,
      "metadata[kind]": "tariff",
      "metadata[tenant_id]": tenantId,
      "metadata[tier]": PAID_TIER,
      "subscription_data[metadata][tenant_id]": tenantId,
      "subscription_data[metadata][tier]": PAID_TIER,
      success_url: `${back}?tariff=paid`,
      cancel_url: `${back}?tariff=cancelled`,
      // За какой аккаунт платят — прямо на странице оплаты (04.10).
      "custom_text[submit][message]": `Календари аккаунта «${String(tenant.name ?? "").trim() || "Babun"}»`,
    };
    // Идёт свой пробный — списание с его последнего дня (Stripe требует
    // запас не меньше двух суток; ближе к концу — платим сразу).
    const trialEnd = tenant.trial_ends_at ? Date.parse(String(tenant.trial_ends_at)) : NaN;
    if (tenant.trial_tier && Number.isFinite(trialEnd) && trialEnd - Date.now() > 49 * 3600 * 1000) {
      form["subscription_data[trial_end]"] = String(Math.floor(trialEnd / 1000));
    }
    // Два нажатия одновременно (две вкладки, владелец и партнёр) проходят
    // проверки выше вместе — ключ идемпотентности отдаёт им одну страницу.
    const idempotencyKey = checkoutIdempotencyKey({
      tenantId,
      priceId,
      quantity,
      trialEnd: form["subscription_data[trial_end]"] ? Number(form["subscription_data[trial_end]"]) : null,
      returnUrl: back,
      superseded,
      nowMs: Date.now(),
    });
    const session = await stripe(stripeKey, "POST", "checkout/sessions", form, idempotencyKey);
    if (!session.url) return json(502, { error: "stripe_failed" });
    return json(200, { url: session.url });
  } catch (e) {
    console.error("tariff-checkout:", action, e instanceof Error ? e.message : String(e));
    return json(502, { error: "stripe_failed" });
  }
});
