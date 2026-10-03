import { pluralRu } from "@babun/shared/common/utils/plural-ru";

// ТАРИФЫ «СОЛО · ПРО · МАКС» (владелец 01.10) — ЧИСТЫЙ СЛОЙ.
//
//   • без тарифа — свой календарь («Личный»), события, свои финансы;
//     клиенты, записи клиентов, услуги, документы и SMS — серым;
//   • Соло — всё это, один календарь, без партнёров;
//   • Про — до 5 команд и 5 партнёров;
//   • Макс — до 50 команд и 50 партнёров;
//   • пробный 14 дней — один раз, на выбранный тариф, без карты;
//   • тариф — у аккаунта-владельца команды: партнёр в чужой команде работает
//     по тарифу её владельца.
//
// Истина — на сервере (`tenant_effective_plan`, `enforce_plan_limits`,
// миграция 20261001183700): экран только не предлагает закрытое и объясняет.
// Лист без React: его читают экраны, хуки и тесты.

export type Tier = "free" | "solo" | "pro" | "max";

export const PAID_TIERS: readonly Exclude<Tier, "free">[] = ["solo", "pro", "max"];

const RANK: Record<Tier, number> = { free: 0, solo: 1, pro: 2, max: 3 };

/** Что открывает тариф. */
export type TierFeature =
  | "clients"
  | "book-clients"
  | "services"
  | "masters"
  | "documents"
  | "sms"
  | "partners"
  | "teams";

/** С какого тарифа открывается возможность. */
const OPENS_FROM: Record<TierFeature, Tier> = {
  clients: "solo",
  "book-clients": "solo",
  services: "solo",
  masters: "solo",
  documents: "solo",
  sms: "solo",
  partners: "pro",
  teams: "pro",
};

/** Лимиты тарифа — те же числа, что `tenant_tier_limit` на сервере. */
export const TIER_LIMITS: Record<Tier, { teams: number; partners: number }> = {
  free: { teams: 1, partners: 0 },
  solo: { teams: 1, partners: 0 },
  pro: { teams: 5, partners: 5 },
  max: { teams: 50, partners: 50 },
};

/** Карточка тарифа на странице «Тариф». Цена — евро в месяц; за год — цена
 *  месяца при оплате на год вперёд (владелец 01.10: «пока помесячно, но
 *  оставьте зазор»). */
export interface TierCard {
  tier: Exclude<Tier, "free">;
  name: string;
  monthly: string;
  yearlyMonthly: string;
  /** Что входит — словами владельца, по строке. */
  includes: readonly string[];
}

export const TIER_CARDS: readonly TierCard[] = [
  {
    tier: "solo",
    name: "Соло",
    monthly: "€6.99",
    yearlyMonthly: "€4.99",
    includes: ["Клиенты без лимита", "Записи, услуги и оплата", "Инвойсы, чеки и SMS", "Один календарь"],
  },
  {
    tier: "pro",
    name: "Про",
    monthly: "€29.99",
    yearlyMonthly: "€21.99",
    includes: ["Всё, что в Соло", "До 5 команд", "До 5 партнёров"],
  },
  {
    tier: "max",
    name: "Макс",
    monthly: "€59.99",
    yearlyMonthly: "€44.99",
    includes: ["Всё, что в Про", "До 50 команд", "До 50 партнёров"],
  },
];

const NAMES: Record<Tier, string> = {
  free: "Без тарифа",
  solo: "Соло",
  pro: "Про",
  max: "Макс",
};

export function tierName(tier: Tier): string {
  return NAMES[tier];
}

function isTier(value: unknown): value is Tier {
  return value === "free" || value === "solo" || value === "pro" || value === "max";
}

/** Действующий тариф из профиля аккаунта. С 01.10 сервер отдаёт `tier`
 *  (владельцу и партнёрам); до наката — по старым полям: `free` — без
 *  тарифа, `pro` — Про, ручная выдача и прочее платное — Макс. Пустой план
 *  (партнёр до наката не видит тарифа) — неизвестно: `null`, и экран не
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

/** С какого тарифа открывается — для слов плашки. */
export function tierFor(feature: TierFeature): Tier {
  return OPENS_FROM[feature];
}

/** Можно ли завести ещё одну команду при стольких живых. */
export function canAddTeam(tier: Tier | null | undefined, liveTeams: number): boolean {
  if (!tier) return true;
  return liveTeams < TIER_LIMITS[tier].teams;
}

/** Можно ли пригласить ещё одного партнёра (люди и ждущие приглашения). */
export function canAddPartner(tier: Tier | null | undefined, partners: number): boolean {
  if (!tier) return true;
  return partners < TIER_LIMITS[tier].partners;
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

/** Подпись тарифа в Кабинете: «Макс», «Про · пробный, ещё 9 дней», «Без
 *  тарифа». */
export function tierLine(tier: Tier | null, trial: { days: number } | null): string {
  if (!tier) return "—";
  if (trial && tier !== "free") return `${NAMES[tier]} · пробный, ещё ${trial.days} ${daysWord(trial.days)}`;
  return NAMES[tier];
}

function daysWord(n: number): string {
  // Форма числа — общим правилом: на других языках интерфейса «21» уже не «один».
  return pluralRu(n, ["день", "дня", "дней"]);
}

/** Какие команды работают при этом тарифе — то же правило, что
 *  `team_is_working` на сервере: в пределах лимита работают все; сверх —
 *  выбранные владельцем первыми, свободные места добираются живыми по
 *  созданию. Остальные только смотрят: новых клиентов и записей в них нет. */
export function workingTeamIds(
  teams: readonly { id: string; created_at?: string | null; is_active?: boolean | null }[],
  tier: Tier | null | undefined,
  chosen: readonly string[] | null | undefined,
): Set<string> {
  const live = teams.filter((team) => team.is_active !== false);
  if (!tier || live.length <= TIER_LIMITS[tier].teams) return new Set(live.map((team) => team.id));
  const order = chosen ?? [];
  const rank = (id: string) => {
    const at = order.indexOf(id);
    return at < 0 ? Number.POSITIVE_INFINITY : at;
  };
  const sorted = live.slice().sort((a, b) => {
    const ra = rank(a.id);
    const rb = rank(b.id);
    if (ra !== rb) return ra < rb ? -1 : 1;
    const byCreated = (a.created_at ?? "").localeCompare(b.created_at ?? "");
    return byCreated !== 0 ? byCreated : a.id.localeCompare(b.id);
  });
  return new Set(sorted.slice(0, TIER_LIMITS[tier].teams).map((team) => team.id));
}

/** Состояние тарифа аккаунта для страницы «Тариф». */
export interface TariffState {
  tier: Tier | null;
  /** Подписка оплачена (не пробный). */
  paid: boolean;
  /** Выдан навсегда — платить и пробовать нечего. */
  forever: boolean;
  trial: { tier: Exclude<Tier, "free">; days: number } | null;
  trialUsed: boolean;
  /** Продление не списалось (`past_due`): доступ ещё держится, а Stripe
   *  уже сдвинул конец периода — «Оплачен до …» было бы неправдой. */
  pastDue?: boolean;
}

/** Одно действие страницы «Тариф» — в футере. Пробный — пока его не было и
 *  ничего не оплачено; дальше — оплата выбранного; подписка уже есть —
 *  переход на выбранный тариф в ней же. На своём оплаченном и на выданном
 *  навсегда кнопки нет. */
export function tariffAction(
  state: TariffState,
  selected: Exclude<Tier, "free">,
): { kind: "trial" | "pay" | "change"; label: string } | null {
  if (state.forever) return null;
  if (state.paid && state.tier === selected) return null;
  if (state.paid) return { kind: "change", label: `Перейти на ${NAMES[selected]}` };
  if (!state.trial && !state.trialUsed) {
    return { kind: "trial", label: "Попробовать 14 дней" };
  }
  const card = TIER_CARDS.find((item) => item.tier === selected);
  return { kind: "pay", label: card ? `Оплатить ${card.monthly} в месяц` : "Оплатить" };
}

/** Подпись текущего тарифа на странице: живое состояние, не пояснение. */
export function tariffStatus(state: TariffState, periodEnd?: string | null): string {
  if (state.forever) return "Навсегда";
  if (state.trial) return `Пробный · ещё ${state.trial.days} ${daysWord(state.trial.days)}`;
  if (state.pastDue) return "Оплата не прошла — обновите карту";
  if (state.paid) {
    const end = periodEnd ? new Date(periodEnd) : null;
    return end && !Number.isNaN(end.getTime())
      ? `Оплачен до ${String(end.getDate()).padStart(2, "0")}.${String(end.getMonth() + 1).padStart(2, "0")}`
      : "Оплачен";
  }
  if (state.trialUsed) return "Пробный закончился";
  return "Календарь и события";
}
