import { pluralRu } from "@babun/shared/common/utils/plural-ru";
import { CALENDAR_PRICE, calendarsMonthly, calendarsYearly, euro, type BillingPeriod } from "./calendar-price";

// ТАРИФ — У КАЛЕНДАРЯ. ЧИСТЫЙ СЛОЙ.
//
//   • каждый календарь оплачивается своей подпиской: €9,99 в месяц (€7,99
//     при оплате за год); один можно оплатить, другой нет; люди бесплатно;
//   • неоплаченный календарь ведёт события; клиенты, записи клиентов,
//     услуги, документы и SMS в нём — серым;
//   • «навсегда» и пробный 14 дней (один раз, без карты) — у аккаунта: они
//     открывают все его календари;
//   • партнёр в чужом календаре работает по оплате этого календаря.
//
// Истина — на сервере (`calendar_effective_plan`, `enforce_plan_limits`):
// экран только не предлагает закрытое и объясняет. Лист без React: его
// читают экраны, хуки и тесты.

export type Tier = "free" | "solo" | "pro" | "max";

const RANK: Record<Tier, number> = { free: 0, solo: 1, pro: 2, max: 3 };

/** Что открывает тариф. */
export type TierFeature =
  | "clients"
  | "book-clients"
  | "services"
  | "masters"
  | "documents"
  | "sms"
  | "partners";

/** С какого тарифа открывается возможность. */
const OPENS_FROM: Record<TierFeature, Tier> = {
  clients: "solo",
  "book-clients": "solo",
  services: "solo",
  masters: "solo",
  documents: "solo",
  sms: "solo",
  partners: "pro",
};

/** Лимит партнёров аккаунта — то же число, что `tenant_tier_limit` на
 *  сервере. Календари числом не ограничены: новый бесплатен, пока в нём нет
 *  работы. */
export const PARTNER_LIMIT: Record<Tier, number> = {
  free: 0,
  solo: 0,
  pro: 5,
  max: 1000,
};

/** Карточка цены на странице тарифа. Цена — евро в месяц; за год — цена
 *  месяца при оплате на год вперёд. */
export interface TierCard {
  name: string;
  monthly: string;
  yearlyMonthly: string;
  /** Что входит — словами владельца, по строке. */
  includes: readonly string[];
}

export { CALENDAR_PRICE, calendarsMonthly, calendarsYearly, type BillingPeriod } from "./calendar-price";

export const CALENDAR_CARD: TierCard = {
  name: "Календарь",
  monthly: euro(CALENDAR_PRICE.monthly),
  yearlyMonthly: euro(CALENDAR_PRICE.yearlyMonthly),
  includes: ["Клиенты, записи и деньги", "Инвойсы, чеки и SMS", "Люди — бесплатно и без лимита"],
};

const NAMES: Record<Tier, string> = {
  free: "Без тарифа",
  solo: "Соло",
  pro: "Про",
  max: "Календарь",
};

/** Имя тарифа — в строке оплаты: «Календарь», у старых подписок «Соло» и «Про». */
export function tierName(tier: Tier): string {
  return NAMES[tier];
}

function isTier(value: unknown): value is Tier {
  return value === "free" || value === "solo" || value === "pro" || value === "max";
}

/** Действующий тариф из профиля аккаунта. Сервер отдаёт `tier`
 *  (владельцу и партнёрам): платный, если оплачен хоть один календарь.
 *  Пустой план (партнёр не видит тарифа) — неизвестно: `null`, и экран не
 *  режет — решает сервер. */
export function tierOf(
  profile: { tier?: unknown; plan?: string | null; plan_override?: string | null } | null | undefined,
): Tier | null {
  if (!profile) return null;
  if (isTier(profile.tier)) return profile.tier;
  const override = profile.plan_override?.trim();
  if (override) return "max";
  const plan = profile.plan?.trim();
  if (!plan) return null;
  if (plan === "free") return "free";
  if (plan === "solo" || plan === "pro" || plan === "max") return plan;
  return "max";
}

/** Открывает ли тариф возможность. Неизвестный тариф — да (решает сервер):
 *  мигание «нельзя → можно» на холодном старте выглядит сломанным продуктом. */
export function tierAllows(tier: Tier | null | undefined, feature: TierFeature): boolean {
  if (!tier) return true;
  return RANK[tier] >= RANK[OPENS_FROM[feature]];
}

/** Можно ли пригласить ещё одного партнёра (люди и ждущие приглашения). */
export function canAddPartner(tier: Tier | null | undefined, partners: number): boolean {
  if (!tier) return true;
  return partners < PARTNER_LIMIT[tier];
}

/** Пробный период: тариф и сколько полных дней осталось; кончился или не
 *  начинался — `null`. */
export function trialLeft(
  profile: { trial_tier?: unknown; trial_ends_at?: string | null } | null | undefined,
  now: Date = new Date(),
): { tier: Exclude<Tier, "free">; days: number } | null {
  if (!profile) return null;
  const tier = profile.trial_tier;
  if (tier !== "solo" && tier !== "pro" && tier !== "max") return null;
  const ends = profile.trial_ends_at ? Date.parse(profile.trial_ends_at) : NaN;
  if (Number.isNaN(ends) || ends <= now.getTime()) return null;
  return { tier, days: Math.max(1, Math.ceil((ends - now.getTime()) / 86_400_000)) };
}

/** Пробный уже был — второй раз не даётся. */
export function trialUsed(profile: { trial_started_at?: string | null } | null | undefined): boolean {
  return !!profile?.trial_started_at;
}

function daysWord(n: number): string {
  // Форма числа — общим правилом: на других языках интерфейса «21» уже не «один».
  return pluralRu(n, ["день", "дня", "дней"]);
}

/** Строка тарифа календаря, как её отдаёт `calendar_tariffs()`. Срок, период
 *  и отмена — только владельцу и партнёру с правом «Тариф». */
export interface CalendarTariffRow {
  teamId: string;
  plan: Tier;
  status: string | null;
  period: BillingPeriod | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

/** Разбор ответа `calendar_tariffs()`: строка без календаря или с чужим
 *  тарифом отбрасывается, а не превращается в «бесплатно». */
export function parseCalendarTariffs(data: unknown): Map<string, CalendarTariffRow> {
  const out = new Map<string, CalendarTariffRow>();
  if (!Array.isArray(data)) return out;
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const teamId = typeof row.team_id === "string" ? row.team_id : null;
    if (!teamId || !isTier(row.plan)) continue;
    out.set(teamId, {
      teamId,
      plan: row.plan,
      status: typeof row.status === "string" ? row.status : null,
      period: row.period === "year" ? "year" : row.period === "month" ? "month" : null,
      periodEnd: typeof row.current_period_end === "string" ? row.current_period_end : null,
      cancelAtPeriodEnd: row.cancel_at_period_end === true,
    });
  }
  return out;
}

/** Подписка, которая сейчас даёт доступ и списывает деньги. */
const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Состояние тарифа одного календаря для его страницы. */
export interface TariffState {
  tier: Tier | null;
  /** У календаря живая подписка (не пробный аккаунта). */
  paid: boolean;
  /** Выдан навсегда — платить и пробовать нечего. */
  forever: boolean;
  trial: { tier: Exclude<Tier, "free">; days: number } | null;
  trialUsed: boolean;
  /** Продление не списалось (`past_due`): доступ ещё держится, а Stripe
   *  уже сдвинул конец периода — «Оплачен до …» было бы неправдой. */
  pastDue?: boolean;
  /** Как платят: помесячно или за год. */
  period?: BillingPeriod | null;
  /** Подписку отменили: календарь работает до конца оплаченного срока. */
  cancelling?: boolean;
}

/** Тариф календаря: «навсегда» и пробный — от аккаунта, подписка — своя. */
export function calendarTariffState(
  account: Pick<TariffState, "forever" | "trial" | "trialUsed">,
  row: CalendarTariffRow | null | undefined,
): TariffState {
  const live = !!row?.status && LIVE_STATUSES.has(row.status);
  const paid = live && !account.forever;
  return {
    tier: row?.plan ?? null,
    paid,
    forever: account.forever,
    trial: account.trial,
    trialUsed: account.trialUsed,
    pastDue: paid && row?.status === "past_due",
    period: paid ? (row?.period ?? null) : null,
    cancelling: paid && row?.cancelAtPeriodEnd === true,
  };
}

/** Кнопка оплаты календаря: «Оплатить €9,99 в месяц» или «Оплатить €95,88 за год». */
function payLabel(period: BillingPeriod): string {
  return period === "year" ? `Оплатить ${calendarsYearly(1)} за год` : `Оплатить ${calendarsMonthly(1)} в месяц`;
}

/** Одно действие страницы тарифа календаря — в футере. Пробный — пока его не
 *  было и ничего не оплачено; дальше — оплата за выбранный период; подписка
 *  уже есть — переход на другой период в ней же. На оплаченном с тем же
 *  периодом и на выданном навсегда кнопки нет. */
export function tariffAction(
  state: TariffState,
  /** Как платить: помесячно или за год вперёд. */
  period: BillingPeriod = "month",
): { kind: "trial" | "pay" | "change"; label: string } | null {
  if (state.forever) return null;
  if (state.paid) {
    if (!state.period || state.period === period) return null;
    return {
      kind: "change",
      label: period === "year" ? `Платить за год — ${calendarsYearly(1)}` : `Платить помесячно — ${calendarsMonthly(1)}`,
    };
  }
  if (!state.trial && !state.trialUsed) {
    return { kind: "trial", label: "Попробовать 14 дней" };
  }
  return { kind: "pay", label: payLabel(period) };
}

/** ДЕЙСТВИЕ ПАРТНЁРА С «ТАРИФ: ОПЛАЧИВАЕТ». Партнёр только оформляет оплату
 *  календаря, пока подписки нет: пробный, смену периода в живой подписке и
 *  выданный навсегда решает владелец. Имя аккаунта — в самой кнопке, чтобы
 *  не спутать со своим. */
export function partnerTariffAction(
  state: TariffState,
  accountName: string | null,
  period: BillingPeriod = "month",
): { kind: "pay"; label: string } | null {
  if (state.forever || state.paid) return null;
  const pay = payLabel(period);
  return { kind: "pay", label: accountName ? `${pay} за ${accountName}` : pay };
}

const ddmm = (iso: string | null | undefined): string | null => {
  const end = iso ? new Date(iso) : null;
  return end && !Number.isNaN(end.getTime())
    ? `${String(end.getDate()).padStart(2, "0")}.${String(end.getMonth() + 1).padStart(2, "0")}`
    : null;
};

/** Подпись тарифа календаря: живое состояние, не пояснение. */
export function tariffStatus(
  state: TariffState,
  periodEnd?: string | null,
  /** Можно ли платить здесь (`CAN_PAY_HERE`): в приложении из магазина
   *  «обновите карту» не говорим — только состояние. Ни
   *  отсчёта пробного, ни «пробный закончился»: это зовёт купить, а покупки
   *  там нет (App Store 3.1.3(f)). */
  payHere = true,
): string {
  if (state.forever) return "Навсегда";
  if (state.pastDue) return payHere ? "Оплата не прошла — обновите карту" : "Оплата не прошла";
  if (state.paid) {
    const end = ddmm(periodEnd);
    if (state.cancelling) return end ? `Отменён · работает до ${end}` : "Отменён";
    return end ? `Оплачен до ${end}` : "Оплачен";
  }
  if (state.trial) return payHere ? `Пробный · ещё ${state.trial.days} ${daysWord(state.trial.days)}` : "Действует";
  return "Не оплачен";
}
