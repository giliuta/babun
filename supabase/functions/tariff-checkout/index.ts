// tariff-checkout — ОПЛАТА КАЛЕНДАРЯ НА СТРАНИЦЕ STRIPE: €9,99 в месяц или
// €7,99 в месяц при оплате за год; люди бесплатно. Оплата — не через Apple,
// а в браузере.
//
// ПОДПИСКА — У КАЛЕНДАРЯ. Каждый календарь платит своей подпиской (одна
// цена «календарь», количество 1), поэтому один можно оплатить, а другой нет.
// Клиент Stripe один на аккаунт: карта и «Управление подпиской» общие на все
// его календари. Какая подписка у какого календаря — `calendar_subscriptions`
// (пишет вебхук по метке `metadata.team_id`).
//
// Что умеет (поле `action`, календарь — `team_id`):
//   • "checkout" (по умолчанию) — оплата календаря. Подписки у календаря ещё
//     нет — открывает Stripe Checkout и отдаёт адрес. Есть — меняет её период
//     (месяц ↔ год) и отвечает `{ changed: true }`. Идёт пробный аккаунта —
//     списание начнётся в его последний день, а не сегодня.
//   • "sync" — подписки следом за календарями: календарь ушёл в архив или
//     удалён — его подписка отменяется в конце оплаченного срока; вернули из
//     архива до конца срока — отмена снимается (только та, что поставили мы
//     по архиву, а не та, что владелец сделал сам). Без `team_id` — все
//     календари аккаунта.
//   • "portal" — страница Stripe «Управление подпиской»: карта, счета,
//     отмена. Её нужно один раз включить в Stripe (Settings → Billing →
//     Customer portal); пока не включена — отвечаем `portal_not_configured`.
//
// Тариф на нашей стороне меняет НЕ эта функция, а вебхук `stripe-webhook`
// по событиям подписки (`customer.subscription.*`). Цены заводятся здесь
// сами при первой оплате — в Stripe руками ничего создавать не нужно.
//
// Кто зовёт: владелец аккаунта (JWT + `x-babun-tenant`); аккаунт и роль
// отвечает сама база (`current_tenant_id`, `current_user_role`). Партнёр с
// правом «Тариф: Оплачивает» (`cabinet.tariff`) только оформляет оплату
// календаря, у которого подписки нет: сменить период живой подписки и
// открыть «Управление подпиской» — списания с карты владельца — может лишь
// сам владелец. Имя календаря и аккаунта стоит на странице оплаты.
// Секреты: STRIPE_SECRET_KEY (заводит владелец) и служебный ключ проекта.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";
import { keyFromEnv, serviceClient } from "../_shared/service-client.ts";
import { json as jsonResponse } from "../_shared/http.ts";
import {
  checkoutIdempotencyKey,
  liveSubscriptionOf,
  openTariffSessions,
  LIVE_TARIFF_STATUSES,
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
    // пустое тело — ниже отказ по календарю
  }
  const action = body.action === "portal" ? "portal" : body.action === "sync" ? "sync" : "checkout";
  const back = safeReturn(body.return_url);
  const teamId = typeof body.team_id === "string" && body.team_id ? body.team_id : null;

  const { data: tenant, error: tenantError } = await service
    .from("tenants")
    .select("id, name, stripe_customer_id, plan_override, trial_tier, trial_ends_at")
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

    // ПОДПИСКИ СЛЕДОМ ЗА КАЛЕНДАРЯМИ. Архивный или удалённый календарь не
    // должен платить следующий период: его подписка отменяется в конце
    // оплаченного — без возврата и без доплаты. Метка `cancelled_by=archive`
    // отличает нашу отмену от отмены владельцем в «Управлении подпиской»:
    // вернули календарь — снимаем только свою.
    if (action === "sync") {
      let rowsQuery = service
        .from("calendar_subscriptions")
        .select("team_id, stripe_subscription_id, status")
        .eq("tenant_id", tenantId)
        .in("status", [...LIVE_TARIFF_STATUSES]);
      if (teamId) rowsQuery = rowsQuery.eq("team_id", teamId);
      const [{ data: rows, error: rowsError }, { data: teams, error: teamsError }] = await Promise.all([
        rowsQuery,
        service.from("teams").select("id, is_active").eq("tenant_id", tenantId),
      ]);
      if (rowsError || teamsError) throw new Error("sync: calendars unreadable");
      const active = new Set((teams ?? []).filter((t) => t.is_active !== false).map((t) => t.id as string));
      let changed = 0;
      for (const row of rows ?? []) {
        const subId = row.stripe_subscription_id as string;
        const sub = await stripe(stripeKey, "GET", `subscriptions/${subId}`);
        const archived = !active.has(row.team_id as string);
        const ours = (sub.metadata as Record<string, string> | undefined)?.cancelled_by === "archive";
        if (archived && sub.cancel_at_period_end !== true) {
          await stripe(stripeKey, "POST", `subscriptions/${subId}`, {
            cancel_at_period_end: "true",
            "metadata[cancelled_by]": "archive",
          });
          changed += 1;
        } else if (!archived && sub.cancel_at_period_end === true && ours) {
          await stripe(stripeKey, "POST", `subscriptions/${subId}`, {
            cancel_at_period_end: "false",
            "metadata[cancelled_by]": "",
          });
          changed += 1;
        }
      }
      return json(200, { synced: true, changed });
    }

    if (!teamId) return json(400, { error: "team_required" });
    if (tenant.plan_override) return json(409, { error: "forever" });
    const { data: team } = await service
      .from("teams")
      .select("id, name, is_active")
      .eq("tenant_id", tenantId)
      .eq("id", teamId)
      .maybeSingle();
    if (!team || team.is_active === false) return json(404, { error: "calendar_not_found" });

    // Период называет страница тарифа (месяц или год). Без него — у живой
    // подписки её же период: годовая не превращается в помесячную.
    const chosen: Period | null = body.period === "year" ? "year" : body.period === "month" ? "month" : null;

    const { data: row } = await service
      .from("calendar_subscriptions")
      .select("stripe_subscription_id, status")
      .eq("tenant_id", tenantId)
      .eq("team_id", teamId)
      .maybeSingle();

    // ПОДПИСКА У КАЛЕНДАРЯ УЖЕ ЕСТЬ — МЕНЯЕМ ЕЁ ПЕРИОД, А НЕ ЗАВОДИМ ВТОРУЮ.
    if (row && LIVE_TARIFF_STATUSES.has(String(row.status))) {
      // Смена в живой подписке меняет списания с карты владельца.
      if (!owner) return json(409, { error: "owner_only_change" });
      const subId = row.stripe_subscription_id as string;
      const sub = await stripe(stripeKey, "GET", `subscriptions/${subId}`);
      const item = (sub.items as {
        data?: { id: string; quantity?: number; price?: { id?: string; recurring?: { interval?: string } | null } }[];
      } | undefined)?.data?.[0];
      if (!item) return json(409, { error: "subscription_without_items" });
      const period: Period = chosen ?? (item.price?.recurring?.interval === "year" ? "year" : "month");
      const priceId = await priceFor(stripeKey, period);
      if (item.price?.id === priceId && item.quantity === 1) return json(200, { changed: false });
      await stripe(stripeKey, "POST", `subscriptions/${subId}`, {
        "items[0][id]": item.id,
        "items[0][price]": priceId,
        "items[0][quantity]": "1",
        "metadata[team_id]": teamId,
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
      // ВТОРОЙ ПОДПИСКИ У КАЛЕНДАРЯ НЕ БЫВАЕТ. «Подписки нет» здесь — слово
      // базы, а его пишет вебхук: между оплатой и событием Stripe проходят
      // секунды, и второе «Оплатить» в это окно оформило бы вторую подписку.
      // Правда — в Stripe: живая подписка с меткой этого календаря уже есть —
      // оплата прошла, тариф вот-вот придёт.
      const subs = await stripe(stripeKey, "GET", "subscriptions", { customer, status: "all", limit: "100" });
      const ofCalendar = ((subs.data as SubscriptionLite[] | undefined) ?? []).filter(
        (s) => s.metadata?.team_id === teamId,
      );
      if (liveSubscriptionOf(ofCalendar)) return json(200, { changed: true });
      // Старая открытая страница оплаты этого календаря, оплаченная после
      // новой, тоже завела бы вторую подписку — гасим её до того, как открыть
      // новую. Страницы других календарей не трогаем.
      const open = await stripe(stripeKey, "GET", "checkout/sessions", { customer, status: "open", limit: "100" });
      for (const id of openTariffSessions((open.data as CheckoutSessionLite[] | undefined) ?? [], teamId)) {
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

    const calendarName = String(team.name ?? "").trim() || "Календарь";
    const accountName = String(tenant.name ?? "").trim() || "Babun";
    const form: Record<string, string> = {
      mode: "subscription",
      customer,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      client_reference_id: tenantId,
      "metadata[kind]": "tariff",
      "metadata[tenant_id]": tenantId,
      "metadata[team_id]": teamId,
      "metadata[tier]": PAID_TIER,
      "subscription_data[metadata][tenant_id]": tenantId,
      "subscription_data[metadata][team_id]": teamId,
      "subscription_data[metadata][tier]": PAID_TIER,
      "subscription_data[description]": `Календарь «${calendarName}»`,
      success_url: `${back}?tariff=paid`,
      cancel_url: `${back}?tariff=cancelled`,
      // За какой календарь и какой аккаунт платят — прямо на странице оплаты.
      "custom_text[submit][message]": `Календарь «${calendarName}» · ${accountName}`,
    };
    // Идёт пробный аккаунта — списание с его последнего дня (Stripe требует
    // запас не меньше двух суток; ближе к концу — платим сразу).
    const trialEnd = tenant.trial_ends_at ? Date.parse(String(tenant.trial_ends_at)) : NaN;
    if (tenant.trial_tier && Number.isFinite(trialEnd) && trialEnd - Date.now() > 49 * 3600 * 1000) {
      form["subscription_data[trial_end]"] = String(Math.floor(trialEnd / 1000));
    }
    // Два нажатия одновременно (две вкладки, владелец и партнёр) проходят
    // проверки выше вместе — ключ идемпотентности отдаёт им одну страницу.
    const idempotencyKey = checkoutIdempotencyKey({
      tenantId,
      teamId,
      priceId,
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
