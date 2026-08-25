// Services data layer — extended fields per Bumpix parity.
//
// Форма и правила цены/длительности. Каталог живёт в Supabase
// (db/repositories/services.ts), здесь хранилища нет.

import { generateId } from "./masters";

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // ISO: Mon=1..Sun=7

export interface ServiceMaterialCost {
  id: string;
  name: string;
  amount: number; // EUR per single execution
}

export interface Service {
  id: string;
  name: string;
  category_id: string | null;
  duration_minutes: number;
  price: number;
  color: string; // hex — custom calendar tint
  available_weekdays: Weekday[]; // empty = any day
  online_enabled: boolean;
  material_costs: ServiceMaterialCost[];
  is_active: boolean;
  created_at: string;
  // MEGA-UPDATE: новые поля единой модели услуг.
  /** От скольких штук срабатывает bulk_price. 0 = без bulk. */
  bulk_threshold: number;
  /** Цена за единицу при bulk. 0 если bulk_threshold = 0. */
  bulk_price: number;
  /** Расход материалов на одну штуку (химия, фреон, и т.д.). */
  cost_per_unit: number;
  /** true = можно делать N штук одной услугой (чистка × 3); false
   *  = количество всегда 1 (диагностика, ремонт). */
  /** Команды, которые делают эту услугу. Пусто = все команды. */
  brigade_ids: string[];
  /** Sprint 033 Phase I18 — explicit sort order inside the parent
   *  category. Services without a value sort after those that have
   *  one (treated as Infinity). Reordered by drag-and-drop on the
   *  brigade services subroute. */
  sort_order?: number;
  /** Sprint 033 Phase I20 — bulk-pricing LADDER. Replaces the
   *  single-step bulk_threshold + bulk_price pair with an array of
   *  { min_qty, price_per_unit } steps. Legacy records are migrated
   *  on load. Tiers are sorted by min_qty asc; the tier with the
   *  highest min_qty ≤ current qty wins. */
  price_tiers?: PriceTier[];
  /** Sprint 033 Phase I22 — duration LADDER. Same mechanic as
   *  price_tiers but for minutes per unit. E.g. «от 3 шт — 30 мин»,
   *  «от 5 шт — 25 мин» reflects crew efficiency on repeated work.
   *  Tier with the highest min_qty ≤ current qty wins. */
  duration_tiers?: DurationTier[];
}

export interface PriceTier {
  /** Minimum quantity for this tier to apply. Must be ≥ 2 (qty=1
   *  always uses the base Service.price). */
  min_qty: number;
  /** Price per single unit when the tier applies. */
  price_per_unit: number;
}

export interface DurationTier {
  /** Minimum quantity for this tier to apply. Must be ≥ 2 (qty=1
   *  always uses the base Service.duration_minutes). */
  min_qty: number;
  /** Total minutes when the tier applies (e.g. «5 кондиционеров за
   *  120 мин суммарно»). UI input is minutes; display can format
   *  as HH:MM. */
  duration_minutes: number;
}

// Pricing helper. Sprint 033 Phase I20: honours the new price_tiers
// ladder first — pick the tier with the highest min_qty ≤ qty.
// Falls back to the legacy single-step bulk_threshold / bulk_price
// for records that haven't been migrated yet.
// Accepts just the pricing fields so callers with a different Service
// shape (mobile's Supabase row) can reuse the same ladder.
export type ServicePricing = Pick<
  Service,
  "price" | "bulk_threshold" | "bulk_price" | "price_tiers"
>;

export function pricePerUnit(service: ServicePricing, qty: number): number {
  const basePrice =
    Number.isFinite(service.price) && service.price >= 0 ? service.price : 0;
  const quantity =
    Number.isFinite(qty) && qty >= 1 ? Math.max(1, Math.floor(qty)) : 1;
  const tiers = Array.isArray(service.price_tiers)
    ? service.price_tiers.filter(
        (tier): tier is PriceTier =>
          tier !== null &&
          typeof tier === "object" &&
          Number.isSafeInteger(tier.min_qty) &&
          tier.min_qty >= 2 &&
          Number.isFinite(tier.price_per_unit) &&
          tier.price_per_unit >= 0,
      )
    : [];
  if (tiers.length > 0) {
    // Sort defensively; the UI writes them sorted but we shouldn't
    // trust storage on that.
    const sorted = [...tiers].sort((a, b) => a.min_qty - b.min_qty);
    let unit = basePrice;
    for (const t of sorted) {
      if (quantity >= t.min_qty) unit = t.price_per_unit;
    }
    return unit;
  }
  if (
    Number.isSafeInteger(service.bulk_threshold) &&
    service.bulk_threshold >= 2 &&
    Number.isFinite(service.bulk_price) &&
    service.bulk_price > 0 &&
    quantity >= service.bulk_threshold
  ) {
    return service.bulk_price;
  }
  return basePrice;
}

export type ServiceDuration = Pick<
  Service,
  "duration_minutes" | "duration_tiers"
>;

/**
 * ВРЕМЯ ОТ КОЛИЧЕСТВА — ЯКОРЯ И ПРЯМАЯ МЕЖДУ НИМИ (2026-08-18).
 *
 * Ступень длительности хранит ИТОГ на всю строку: «три комнаты — 2 ч 40 мин».
 * Раньше это читалось буквально и порождало две неправды сразу:
 *   · между порогами время скакало по формуле «база × количество» (две комнаты
 *     — 2 ч, три — вдруг 2 ч 40);
 *   · после последнего порога время ЗАМИРАЛО навсегда: и пять комнат, и десять
 *     занимали те же 2 ч 40, а команда опаздывала на вечерний адрес.
 * Чтобы описать клининговую лестницу (2 ч → 3 ч → 4 ч → 4:45 → 5:30), человеку
 * приходилось заводить ступень на каждое число.
 *
 * Теперь точки (1, база) и каждый порог — это ЯКОРЯ, а между ними и за
 * последним из них время идёт по прямой:
 *   · количество ≤ 1 — база;
 *   · между двумя якорями — линейно между ними;
 *   · дальше последнего якоря — тем же наклоном, что и последний отрезок.
 * Та же лестница описывается двумя ступенями, а «время не растёт» выражается
 * якорем с тем же значением (наклон 0 — две собаки гуляют за тот же час).
 *
 * Хранение не изменилось: пороги целые ≥ 2, значение — минуты на всю строку.
 */
export function durationForQuantity(
  service: ServiceDuration,
  qty: number,
): number {
  const quantity =
    Number.isFinite(qty) && qty >= 1 ? Math.max(1, Math.floor(qty)) : 1;
  const baseDuration =
    Number.isFinite(service.duration_minutes) && service.duration_minutes >= 0
      ? Math.floor(service.duration_minutes)
      : 0;
  const tiers = Array.isArray(service.duration_tiers)
    ? service.duration_tiers.filter(
        (tier): tier is DurationTier =>
          tier !== null &&
          typeof tier === "object" &&
          Number.isSafeInteger(tier.min_qty) &&
          tier.min_qty >= 2 &&
          Number.isSafeInteger(tier.duration_minutes) &&
          tier.duration_minutes >= 0,
      )
    : [];
  if (tiers.length === 0) return baseDuration * quantity;

  // Якоря по возрастанию количества; первый — сама услуга при одной штуке.
  const anchors: { qty: number; minutes: number }[] = [
    { qty: 1, minutes: baseDuration },
    ...[...tiers]
      .sort((a, b) => a.min_qty - b.min_qty)
      .map((tier) => ({ qty: tier.min_qty, minutes: tier.duration_minutes })),
  ];
  if (quantity <= 1) return Math.max(0, Math.round(anchors[0].minutes));

  for (let i = 1; i < anchors.length; i += 1) {
    const prev = anchors[i - 1];
    const next = anchors[i];
    if (quantity <= next.qty) {
      const span = next.qty - prev.qty;
      if (span <= 0) return Math.max(0, Math.round(next.minutes));
      const slope = (next.minutes - prev.minutes) / span;
      return Math.max(
        0,
        Math.round(prev.minutes + slope * (quantity - prev.qty)),
      );
    }
  }

  // Дальше последнего якоря — продолжаем последним наклоном.
  const last = anchors[anchors.length - 1];
  const prev = anchors[anchors.length - 2];
  const span = last.qty - prev.qty;
  const slope = span > 0 ? (last.minutes - prev.minutes) / span : 0;
  return Math.max(0, Math.round(last.minutes + slope * (quantity - last.qty)));
}

// ─── Helpers ───────────────────────────────────────────────────────────

export function createBlankService(overrides: Partial<Service> = {}): Service {
  return {
    id: generateId("svc"),
    name: "",
    category_id: null,
    duration_minutes: 60,
    price: 0,
    color: "#3b82f6",
    available_weekdays: [],
    online_enabled: true,
    material_costs: [],
    is_active: true,
    created_at: new Date().toISOString(),
    bulk_threshold: 0,
    bulk_price: 0,
    cost_per_unit: 0,
    brigade_ids: [],
    ...overrides,
  };
}

export interface ServiceCostSource {
  cost_per_unit?: unknown;
  cost_tiers?: unknown;
  material_costs?: unknown;
}

/** РАСХОД ЗА ОДНУ ПРИ ДАННОМ КОЛИЧЕСТВЕ — ступенька, как цена, а НЕ прямая,
 *  как время (2026-08-21). Действует расход последней строки с `min_qty <= qty`.
 *  Интерполяции у расхода нет намеренно: наклон между строками сочинял бы
 *  цифру, которую человек не вводил. Умножает КОЛИЧЕСТВО, а не сама величина
 *  себя: справочник хранит расход одной штуки, запись умножает.
 */
export function costPerUnit(
  service: {
    cost_per_unit?: unknown;
    cost_tiers?: unknown;
    material_costs?: unknown;
  },
  qty: number,
): number {
  const base = getServiceMaterialCost(service);
  const tiers = parseCostTiers(service.cost_tiers);
  let value = base;
  for (const tier of tiers) {
    if (qty >= tier.min_qty) value = tier.cost_per_unit;
  }
  return value;
}

/** Читает `cost_tiers` из базы, отбрасывая мусор — зеркало `parsePriceTiers`. */
function parseCostTiers(
  raw: unknown,
): { min_qty: number; cost_per_unit: number }[] {
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? (() => {
          try {
            const parsed: unknown = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];
  const byMinimum = new Map<number, { min_qty: number; cost_per_unit: number }>();
  for (const item of source) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const minimum = Number(record.min_qty);
    const cost = Number(record.cost_per_unit);
    if (!Number.isSafeInteger(minimum) || minimum < 2) continue;
    if (!Number.isFinite(cost) || cost < 0) continue;
    byMinimum.set(minimum, { min_qty: minimum, cost_per_unit: cost });
  }
  return [...byMinimum.values()].sort((a, b) => a.min_qty - b.min_qty);
}

/** Cost of materials for one unit. cost_per_unit is the canonical value;
 * named material rows remain a compatibility fallback for older records. */
function getServiceMaterialCost(service: ServiceCostSource): number {
  const explicit =
    typeof service.cost_per_unit === "number" &&
    Number.isFinite(service.cost_per_unit) &&
    service.cost_per_unit >= 0
      ? service.cost_per_unit
      : null;
  const materialRows = Array.isArray(service.material_costs)
    ? service.material_costs
    : [];
  const rowsTotal = materialRows.reduce((sum, row) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) return sum;
    const amount = (row as { amount?: unknown }).amount;
    return typeof amount === "number" && Number.isFinite(amount) && amount >= 0
      ? sum + amount
      : sum;
  }, 0);
  return explicit !== null && (explicit > 0 || rowsTotal === 0)
    ? explicit
    : rowsTotal;
}

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс",
};

/** ДНИ, ПО КОТОРЫМ УСЛУГУ ДЕЛАЮТ (владелец 2026-08-24: «в понедельник мы
 *  выполняем эту услугу, а во вторник эта услуга невозможна»).
 *
 *  Пустой список — «делаем в любой день», и это НЕ «не заполнил»: у пяти услуг
 *  из шести на проде так и есть, и заставлять человека зажигать семь плиток
 *  ради «как обычно» было бы работой ради колонки.
 *
 *  ЧИТАТЕЛЬ РОВНО ОДИН — каталог выбора услуги в записи. Услуга, которую в
 *  этот день не делают, НЕ ПРЯЧЕТСЯ: она уезжает вниз списка приглушённой и
 *  выбирается тапом. Спрятать нельзя — человек, не нашедший услугу, решит,
 *  что она исчезла из прайса; запретить нельзя тем более: продукт не
 *  отказывает в деньгах. */
export function servedOnWeekday(
  service: { available_weekdays?: unknown },
  isoWeekday: number,
): boolean {
  const raw = service.available_weekdays;
  if (!Array.isArray(raw) || raw.length === 0) return true;
  return raw.some(
    (day) => typeof day === "number" && Math.floor(day) === isoWeekday,
  );
}

/** ISO-день недели (1 = понедельник) из строки «YYYY-MM-DD». */
export function isoWeekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return 1;
  const js = new Date(y, m - 1, d).getDay();
  return js === 0 ? 7 : js;
}
