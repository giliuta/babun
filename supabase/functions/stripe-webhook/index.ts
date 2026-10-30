// Stripe webhook receiver — Edge Function port of
// apps/web/src/app/api/stripe/webhook/route.ts (STORY-052 G3 + STORY-069).
//
// POST /functions/v1/stripe-webhook
//
// ⚠️ EXTERNAL CALLER, AND IT IS THE BILLING SOURCE OF TRUTH.
// This handler is the ONLY writer of `calendar_subscriptions` (the
// subscription, status and paid-until of every calendar) and of
// `tenants.stripe_customer_id`. If it stops receiving events, subscriptions
// silently drift out of sync — no error appears anywhere in the product.
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
// ТАРИФ — У КАЛЕНДАРЯ. Подписку оформляет `tariff-checkout`, у каждого
// календаря своя; тариф подписки — метка её цены (`metadata.tier`,
// `lookup_key` babun_calendar_<period>), аккаунт и календарь — метки самой
// подписки (`metadata.tenant_id`, `metadata.team_id`). В Stripe у этого
// вебхука должны быть включены события
// `customer.subscription.created/updated/deleted`,
// `invoice.payment_succeeded/failed`, `invoice.upcoming` и
// `checkout.session.completed`.
//
// PORTING NOTES vs the Next route:
//   * `constructEvent` → `constructEventAsync`. Deno has no Node crypto
//     sync HMAC; the sync variant throws at runtime under Web Crypto.
//     This is THE classic Stripe-on-edge trap.
//   * Stripe client gets `createFetchHttpClient()` — the default Node
//     http client does not exist in Deno.
//   * Audit-then-reconcile order, the 23505 short-circuit, tenant
//     resolution and every status mapping are unchanged.

import { serviceClient } from "../_shared/service-client.ts";
import { json } from "../_shared/http.ts";
import { duplicateVerdict, LIVE_TARIFF_STATUSES } from "../_shared/tariff-duplicates.ts";
// `npm:`, а не `esm.sh`: сборка esm.sh тянула node-совместимость Deno std, и
// она на каждое событие писала в логи «event loop error:
// Deno.core.runMicrotasks() is not supported» — настоящий сбой вебхука в
// таком шуме не отличить. Пакет из npm по условию `deno` отдаёт сборку для
// воркеров: fetch и Web Crypto, без node.
import Stripe from "npm:stripe@17.7.0";



type Tier = "free" | "solo" | "pro" | "max";
type SubStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete";

/** Поля аккаунта, которые пишет вебхук: только клиент Stripe — карта одна
 *  на все календари аккаунта. */
interface AccountFields {
  stripe_customer_id?: string;
}

/** Строка `calendar_subscriptions` — подписка календаря, как она есть в
 *  Stripe СЕЙЧАС. */
interface CalendarRow {
  stripe_subscription_id: string;
  status: SubStatus;
  period: "month" | "year";
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

function priceToTier(price: Stripe.Price | undefined): Tier {
  if (!price) return "free";
  // Цены тарифов заводит `tariff-checkout` — с меткой тарифа.
  const meta = price.metadata?.tier;
  if (meta === "solo" || meta === "pro" || meta === "max") return meta;
  const lookup = /^babun_(solo|pro|max)_/.exec(price.lookup_key ?? "");
  if (lookup) return lookup[1] as Tier;
  // Цена за календарь (12.10) — оплата календарей = полный доступ.
  if (/^babun_calendar_/.test(price.lookup_key ?? "")) return "max";
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

function rowOfSubscription(sub: Stripe.Subscription): CalendarRow {
  const item = sub.items?.data?.[0];
  // Цена не наша (опечатка в секрете, чужой товар) — подписка не даёт
  // доступа, как бы ни называлась её стадия в Stripe.
  const status = priceToTier(item?.price) === "free" ? "incomplete" : mapSubscriptionStatus(sub.status);
  const withPeriod = sub as unknown as { current_period_end?: number | null };
  // Новые версии API держат конец периода у позиции подписки.
  const periodEnd =
    withPeriod.current_period_end ??
    (item as unknown as { current_period_end?: number | null } | undefined)?.current_period_end;
  return {
    stripe_subscription_id: sub.id,
    status,
    period: item?.price?.recurring?.interval === "year" ? "year" : "month",
    current_period_end: typeof periodEnd === "number" ? unixToIso(periodEnd) : null,
    cancel_at_period_end: sub.cancel_at_period_end === true,
  };
}

const LIVE_STATUSES = LIVE_TARIFF_STATUSES;

/** Календарь подписки: метка `team_id`; без неё — строка, где эта подписка
 *  уже записана (подписка, перенесённая с аккаунта, метки не несёт); без
 *  строки — единственный живой календарь аккаунта. Иначе — неизвестно. */
async function calendarOfSubscription(
  // deno-lint-ignore no-explicit-any
  sbs: any,
  tenantId: string,
  sub: Stripe.Subscription,
): Promise<string | null> {
  const tagged = sub.metadata?.team_id;
  if (typeof tagged === "string" && tagged) return tagged;
  const { data: row } = await sbs
    .from("calendar_subscriptions")
    .select("team_id")
    .eq("tenant_id", tenantId)
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();
  if (typeof row?.team_id === "string") return row.team_id;
  const { data: teams, error } = await sbs
    .from("teams")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  if (error) throw new Error(`calendars unreadable: ${error.code ?? "?"}`);
  return teams?.length === 1 ? (teams[0].id as string) : null;
}

/** ПРАВДА О ПОДПИСКЕ — ИЗ STRIPE, А НЕ ИЗ СОБЫТИЯ.
 *
 *  Stripe не обещает порядок событий, а повтор после 5xx приходит позже
 *  новых: старое `updated(active)` после `deleted` вернуло бы тариф по
 *  отменённой подписке. Поэтому на каждое событие подписки или её счёта
 *  подписка перечитывается и пишется в строку СВОЕГО календаря — только если
 *  это его текущая подписка (или её нет), либо текущая уже не живая, а эта —
 *  живая. Подписки разных календарей друг друга не трогают. */
async function reconcileCalendar(
  event: Stripe.Event,
  stripe: Stripe,
  // deno-lint-ignore no-explicit-any
  sbs: any,
  tenantId: string,
): Promise<void> {
  const obj = event.data.object as unknown as Record<string, unknown>;
  const subId = event.type.startsWith("customer.subscription.")
    ? (typeof obj.id === "string" ? obj.id : null)
    : idOf(obj.subscription) ??
      idOf((obj.parent as { subscription_details?: { subscription?: unknown } } | undefined)?.subscription_details?.subscription);
  if (!subId) return;

  const fresh = await stripe.subscriptions.retrieve(subId);
  const teamId = await calendarOfSubscription(sbs, tenantId, fresh);
  if (!teamId) {
    console.error("stripe webhook: subscription without calendar", { tenant: tenantId, subscription: subId });
    return;
  }

  const { data: row, error: rowError } = await sbs
    .from("calendar_subscriptions")
    .select("stripe_subscription_id")
    .eq("tenant_id", tenantId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (rowError) throw new Error(`calendar subscription unreadable: ${rowError.code ?? "?"}`);
  const current = (row?.stripe_subscription_id as string | null | undefined) ?? null;

  if (current && current !== subId) {
    // Событие про ДРУГУЮ подписку этого календаря, не записанную.
    if (!LIVE_STATUSES.has(fresh.status)) return; // чужая мёртвая подписка тариф не трогает
    let currentSub: Stripe.Subscription | null = null;
    try {
      currentSub = await stripe.subscriptions.retrieve(current);
    } catch {
      currentSub = null; // записанной в Stripe нет — переходим на живую
    }
    const verdict = duplicateVerdict({ tenantId, teamId, current: currentSub, fresh });
    switch (verdict.kind) {
      case "ignore":
        return;
      case "cancel":
        // Тариф остаётся на записанной подписке, вторую снимаем.
        await refundAndCancelDuplicate(stripe, verdict.subscriptionId, tenantId, current);
        return;
      case "alarm":
        console.error("stripe webhook: two live subscriptions of one calendar, second without tags", {
          tenant: tenantId,
          calendar: teamId,
          current,
          other: fresh.id,
        });
        if (!verdict.adopt) return;
        break;
      case "adopt":
        break;
    }
  }

  const { error: upsertError } = await sbs
    .from("calendar_subscriptions")
    .upsert(
      { tenant_id: tenantId, team_id: teamId, ...rowOfSubscription(fresh), updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,team_id" },
    );
  if (upsertError) throw new Error(upsertError.message ?? "calendar subscription upsert failed");
}

/** ВТОРАЯ ПОДПИСКА ТОГО ЖЕ КАЛЕНДАРЯ — ДВОЙНАЯ ОПЛАТА: возвращаем её первый
 *  платёж и отменяем её сразу, без пересчёта. Человек нажал «Оплатить»
 *  дважды, а не купил два тарифа: подписка одна на календарь, и
 *  `tariff-checkout` меняет живую, а не заводит вторую.
 *
 *  ПОРЯДОК — СНАЧАЛА ВОЗВРАТ, ПОТОМ ОТМЕНА. Сбой любого шага — исключение,
 *  500 и повтор события от Stripe. Отменённая подписка уже не «живая», и
 *  повтор её не тронул бы — значит, возврат, не сделанный до отмены, не
 *  случился бы никогда. Ключи идемпотентности не дают повтору вернуть деньги
 *  дважды. */
async function refundAndCancelDuplicate(
  stripe: Stripe,
  subscriptionId: string,
  tenantId: string,
  keep: string,
): Promise<void> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice"] });
  const invoice = typeof sub.latest_invoice === "object" ? sub.latest_invoice : null;
  const paid = invoice && invoice.status === "paid" && (invoice.amount_paid ?? 0) > 0;
  if (paid) {
    const ref = invoice as unknown as { payment_intent?: unknown; charge?: unknown };
    const paymentIntent = idOf(ref.payment_intent);
    const charge = idOf(ref.charge);
    if (!paymentIntent && !charge) throw new Error(`duplicate ${subscriptionId}: paid invoice without payment`);
    await stripe.refunds.create(
      {
        ...(paymentIntent ? { payment_intent: paymentIntent } : { charge: charge as string }),
        reason: "duplicate",
        metadata: { tenant_id: tenantId, subscription: subscriptionId, kept: keep },
      },
      { idempotencyKey: `babun-duplicate-refund-${subscriptionId}` },
    );
  }
  await stripe.subscriptions.cancel(
    subscriptionId,
    { prorate: false, invoice_now: false },
    { idempotencyKey: `babun-duplicate-cancel-${subscriptionId}` },
  );
  // Не сбой, а след для разбора: в журнале видно, что и почему снято.
  console.warn("stripe webhook: duplicate subscription refunded and cancelled", {
    tenant: tenantId,
    cancelled: subscriptionId,
    kept: keep,
    refunded: paid ? invoice?.amount_paid : 0,
  });
}

/** Что событие меняет у АККАУНТА. Оплата на странице Stripe — запомнить
 *  клиента Stripe аккаунта: по нему находятся события подписки без меток,
 *  на него же оформляются подписки остальных календарей. */
function accountUpdate(event: Stripe.Event): AccountFields | null {
  if (event.type !== "checkout.session.completed") return null;
  const session = event.data.object as Stripe.Checkout.Session;
  const customer = idOf(session.customer);
  if (session.mode !== "subscription" || session.metadata?.kind !== "tariff" || !customer) return null;
  return { stripe_customer_id: customer };
}

/** Аккаунт ещё существует. Метка на подписке переживает удаление аккаунта:
 *  `account-delete` отменяет подписку, и событие об отмене приходит, когда
 *  аккаунта уже нет — запись журнала с его id падала на внешнем ключе, ответ
 *  500, и Stripe повторял событие трое суток (аудит 04.10). Такое событие
 *  пишется в журнал без аккаунта и тариф не трогает. */
// deno-lint-ignore no-explicit-any
async function liveTenant(sbs: any, id: string): Promise<string | null> {
  const { data } = await sbs.from("tenants").select("id").eq("id", id).maybeSingle();
  return typeof data?.id === "string" ? data.id : null;
}

// deno-lint-ignore no-explicit-any
async function resolveTenantId(event: Stripe.Event, sbs: any): Promise<string | null> {
  const data = event.data.object as unknown as Record<string, unknown>;
  const clientRef = data.client_reference_id;
  if (typeof clientRef === "string" && clientRef) return liveTenant(sbs, clientRef);
  // Подписка тарифа несёт аккаунт в метке (`tariff-checkout`).
  const metaTenant = (data.metadata as Record<string, unknown> | undefined)?.tenant_id;
  if (typeof metaTenant === "string" && metaTenant) return liveTenant(sbs, metaTenant);

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

/** АРХИВНЫЙ КАЛЕНДАРЬ НЕ ПЛАТИТ СЛЕДУЮЩИЙ ПЕРИОД. Отмену в конце срока
 *  ставит `tariff-checkout` (sync) сразу после архива, но из приложения без
 *  сети этот шаг пропадает. Перед каждым счётом (`invoice.upcoming`)
 *  подписка календаря, которого больше нет среди живых, отменяется — счёт не
 *  выставится. */
async function releaseArchivedBeforeInvoice(
  event: Stripe.Event,
  stripe: Stripe,
  // deno-lint-ignore no-explicit-any
  sbs: any,
  tenantId: string,
): Promise<void> {
  if (event.type !== "invoice.upcoming") return;
  const obj = event.data.object as unknown as Record<string, unknown>;
  const subId =
    idOf(obj.subscription) ??
    idOf((obj.parent as { subscription_details?: { subscription?: unknown } } | undefined)?.subscription_details?.subscription);
  if (!subId) return;
  const { data: row, error: rowError } = await sbs
    .from("calendar_subscriptions")
    .select("team_id")
    .eq("tenant_id", tenantId)
    .eq("stripe_subscription_id", subId)
    .maybeSingle();
  if (rowError) throw new Error(`calendar subscription unreadable: ${rowError.code ?? "?"}`);
  if (!row) return;
  const { data: team, error: teamError } = await sbs
    .from("teams")
    .select("is_active")
    .eq("tenant_id", tenantId)
    .eq("id", row.team_id)
    .maybeSingle();
  // Не прочли — исключение, 5xx и повтор от Stripe, а не отмена живого.
  if (teamError) throw new Error(`calendar unreadable: ${teamError.code ?? "?"}`);
  if (team?.is_active === true) return;
  await stripe.subscriptions.cancel(
    subId,
    { prorate: false, invoice_now: false },
    { idempotencyKey: `babun-archived-cancel-${subId}` },
  );
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
      undefined,
      Stripe.createSubtleCryptoProvider(),
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
      await releaseArchivedBeforeInvoice(event, stripe, sbs, tenantIdHint);
      const bySubscription =
        event.type.startsWith("customer.subscription.") && event.type !== "customer.subscription.trial_will_end"
        || event.type === "invoice.payment_succeeded"
        || event.type === "invoice.payment_failed";
      if (bySubscription) await reconcileCalendar(event, stripe, sbs, tenantIdHint);
      const update = accountUpdate(event);
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
