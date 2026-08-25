export type PriceTierValue = {
  min_qty: number;
  price_per_unit: number;
};

export type DurationTierValue = {
  min_qty: number;
  duration_minutes: number;
};

export interface ServiceTierDraft {
  id: string;
  minQuantity: string;
  rowPrice: string;
  /** Расход за одну на этом количестве. Пустым не бывает: очищенный
   *  схлопывается в «0» — расход не доходит до клиента, он живёт только в
   *  прибыли, поэтому здесь пусто МОЖНО читать как ноль (у цены нельзя). */
  rowCost: string;
  totalDuration: string;
}

export interface ServiceEconomicsDraft {
  tiers: ServiceTierDraft[];
}

export interface ServiceTierErrors {
  minQuantity?: string;
  rowPrice?: string;
  rowCost?: string;
  totalDuration?: string;
  row?: string;
}

export interface ServiceEconomicsErrors {
  tiers: Record<string, ServiceTierErrors>;
}

export type CostTierValue = {
  min_qty: number;
  cost_per_unit: number;
};

export interface ServiceEconomicsValue {
  price_tiers: PriceTierValue[] | null;
  duration_tiers: DurationTierValue[] | null;
  /** Пустая лестница расхода уезжает пустым массивом, а не `null`: колонка
   *  `not null default '[]'`, и снятое пишем явно — патч частичный. */
  cost_tiers: CostTierValue[];
  /** ЗЕРКАЛО ОПТА ОБНУЛЯЕТСЯ ЯВНО, А НЕ «ПЕРЕСТАЁТ ПИСАТЬСЯ» (2026-08-21).
   *  Обновление услуги шлёт ЧАСТИЧНЫЙ патч, а `rowPrice` падает в
   *  легаси-ветку ровно тогда, когда `price_tiers` пуст: без явного нуля
   *  убранная цена от количества воскресала из этих двух колонок и считала
   *  деньги в записи. Читатель легаси остаётся — уходит только писатель. */
  bulk_threshold: number;
  bulk_price: number;
}

interface ServiceEconomicsSource {
  cost_tiers?: unknown;
  price_tiers?: unknown;
  duration_tiers?: unknown;
  bulk_threshold?: unknown;
  bulk_price?: unknown;
}

type LooseRecord = Record<string, unknown>;

function asLooseArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function asRecord(value: unknown): LooseRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as LooseRecord)
    : null;
}

function looseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function tierMinimum(record: LooseRecord): number | null {
  const value = looseNumber(
    record.min_qty ??
      record.min_quantity ??
      record.minimum_quantity ??
      record.threshold,
  );
  return value !== null && Number.isSafeInteger(value) && value >= 2 ? value : null;
}

/** Accepts current DB JSON and known legacy aliases. Invalid rows are ignored. */
export function parsePriceTiers(raw: unknown): PriceTierValue[] {
  const byMinimum = new Map<number, PriceTierValue>();
  for (const item of asLooseArray(raw)) {
    const record = asRecord(item);
    if (!record) continue;
    const minQuantity = tierMinimum(record);
    const price = looseNumber(
      record.price_per_unit ?? record.unit_price ?? record.price,
    );
    if (minQuantity === null || price === null || price < 0) continue;
    byMinimum.set(minQuantity, {
      min_qty: minQuantity,
      price_per_unit: price,
    });
  }
  return [...byMinimum.values()].sort((a, b) => a.min_qty - b.min_qty);
}

/** Accepts current DB JSON and known legacy aliases. Invalid rows are ignored. */
export function parseDurationTiers(raw: unknown): DurationTierValue[] {
  const byMinimum = new Map<number, DurationTierValue>();
  for (const item of asLooseArray(raw)) {
    const record = asRecord(item);
    if (!record) continue;
    const minQuantity = tierMinimum(record);
    const duration = looseNumber(
      record.duration_minutes ??
        record.total_duration_minutes ??
        record.total_duration,
    );
    if (
      minQuantity === null ||
      duration === null ||
      !Number.isSafeInteger(duration) ||
      duration < 0
    ) {
      continue;
    }
    byMinimum.set(minQuantity, {
      min_qty: minQuantity,
      duration_minutes: duration,
    });
  }
  return [...byMinimum.values()].sort((a, b) => a.min_qty - b.min_qty);
}

export function economicsDraftFromService(
  service?: ServiceEconomicsSource | null,
): ServiceEconomicsDraft {
  const prices = parsePriceTiers(service?.price_tiers);
  const durations = parseDurationTiers(service?.duration_tiers);

  if (prices.length === 0) {
    const legacyMinimum = looseNumber(service?.bulk_threshold);
    const legacyPrice = looseNumber(service?.bulk_price);
    if (
      legacyMinimum !== null &&
      Number.isSafeInteger(legacyMinimum) &&
      legacyMinimum >= 2 &&
      legacyPrice !== null &&
      legacyPrice > 0
    ) {
      prices.push({ min_qty: legacyMinimum, price_per_unit: legacyPrice });
    }
  }

  const costs = parseCostDrafts(service?.cost_tiers);
  const costByMinimum = new Map(costs.map((tier) => [tier.min_qty, tier]));
  const priceByMinimum = new Map(prices.map((tier) => [tier.min_qty, tier]));
  const durationByMinimum = new Map(
    durations.map((tier) => [tier.min_qty, tier]),
  );
  const minimums = [
    ...new Set([
      ...priceByMinimum.keys(),
      ...durationByMinimum.keys(),
      ...costByMinimum.keys(),
    ]),
  ].sort((a, b) => a - b);

  return {
    tiers: minimums.map((minimum, index) => ({
      id: `stored-${minimum}-${index}`,
      minQuantity: String(minimum),
      rowPrice: rowTotalFromUnit(
        priceByMinimum.get(minimum)?.price_per_unit,
        minimum,
      ),
      rowCost: String(
        round2((costByMinimum.get(minimum)?.cost_per_unit ?? 0) * minimum),
      ),
      totalDuration:
        durationByMinimum.get(minimum) === undefined
          ? ""
          : String(durationByMinimum.get(minimum)?.duration_minutes),
    })),
  };
}

/** НОВАЯ СТРОКА НЕ ПОДСТАВЛЯЕТ ЦЕНУ (владелец 2026-08-21: «когда я добавляю
 *  новое, оно меняет цену всегда на 50 — мне это не нравится»). Цена от
 *  количества почти всегда НИЖЕ базовой, поэтому подставленная база — это не
 *  подсказка, а лишняя работа: её надо стереть и напечатать своё. Количество и
 *  время подставляются, потому что там угадывать нечего: следующее свободное
 *  число и та же работа, взятая столько раз. */
function parseCostDrafts(raw: unknown): CostTierValue[] {
  const byMinimum = new Map<number, CostTierValue>();
  for (const item of asLooseArray(raw)) {
    const record = asRecord(item);
    if (!record) continue;
    const minimum = tierMinimum(record);
    const cost = looseNumber(record.cost_per_unit ?? record.cost);
    if (minimum === null || cost === null || cost < 0) continue;
    byMinimum.set(minimum, { min_qty: minimum, cost_per_unit: cost });
  }
  return [...byMinimum.values()].sort((a, b) => a.min_qty - b.min_qty);
}

/** Якоря лестницы по возрастанию количества: сама услуга при одной штуке плюс
 *  каждая заведённая строка. Пустая клетка — НЕ ЯКОРЬ: она значит «здесь ничего
 *  не задано», и правило идёт сквозь неё. */
function ladderAnchors(
  existing: ServiceTierDraft[],
  baseValue: number,
  pick: (tier: ServiceTierDraft) => string,
): { qty: number; value: number }[] {
  const anchors = [{ qty: 1, value: baseValue }];
  for (const tier of existing) {
    const qty = looseNumber(tier.minQuantity);
    const raw = looseNumber(pick(tier));
    if (qty === null || raw === null) continue;
    if (!Number.isSafeInteger(qty) || qty < 2 || raw < 0) continue;
    anchors.push({ qty, value: raw });
  }
  return anchors.sort((a, b) => a.qty - b.qty);
}

/** ВРЕМЯ НОВОЙ СТРОКИ — ПРОДОЛЖЕНИЕ ЛЕСТНИЦЫ, А НЕ «БАЗА × КОЛИЧЕСТВО»
 *  (аудит 2026-08-21).
 *
 *  Прежний сев умножал базу на количество, не глядя на уже заведённые ступени.
 *  На живой услуге это выглядело так: 40 мин · 1 ч · 1 ч 30 — ряд шагом
 *  полчаса, — а четвёртая строка приезжала с «2 ч 40», потому что 40 × 4.
 *  Число не продолжало ряд и не значило ничего. Теперь сев считает ровно тем
 *  же способом, каким `durationForQuantity` считает время в самой записи:
 *  берёт два последних якоря и продолжает их наклон. */
function seedDurationFor(
  existing: ServiceTierDraft[],
  baseDuration: number,
  minimum: number,
): number {
  const anchors = ladderAnchors(
    existing,
    Math.max(0, Math.round(baseDuration)),
    (tier) => tier.totalDuration,
  );
  const last = anchors[anchors.length - 1];
  const prev = anchors[anchors.length - 2];
  // Одна лишь база — наклона ещё нет, и «столько же работы столько раз»
  // остаётся единственной честной догадкой.
  if (!prev || last.qty === prev.qty) {
    return Math.max(0, Math.round(baseDuration * minimum));
  }
  const slope = (last.value - prev.value) / (last.qty - prev.qty);
  return Math.max(0, Math.round(last.value + slope * (minimum - last.qty)));
}

/** РАСХОД НАСЛЕДУЕТСЯ ЗА ОДНУ, А ПОДСТАВЛЯЕТСЯ ЗА ВСЁ. У материалов скидки от
 *  количества нет — та же химия на ту же штуку, — поэтому наследуем именно
 *  расход НА ЕДИНИЦУ строки выше и умножаем его на новое количество. Взять
 *  чужой тотал как есть было бы ошибкой: «20 за две» и «20 за три» — это
 *  разный расход на штуку. */
function seedCostFor(
  existing: ServiceTierDraft[],
  baseCost: string,
  minimum: number,
): string {
  let unit = looseNumber(baseCost) ?? 0;
  const sorted = [...existing]
    .map((tier) => ({
      qty: looseNumber(tier.minQuantity),
      total: looseNumber(tier.rowCost),
    }))
    .filter((x): x is { qty: number; total: number } => x.qty !== null && x.total !== null)
    .sort((a, b) => a.qty - b.qty);
  const last = sorted[sorted.length - 1];
  if (last && last.qty > 0) unit = last.total / last.qty;
  return String(round2(Math.max(0, unit) * minimum));
}

/** НОВАЯ СТРОКА НЕ ПОДСТАВЛЯЕТ ЦЕНУ (владелец 2026-08-21: «когда я добавляю
 *  новое, оно меняет цену всегда на 50 — мне это не нравится»). Цена от
 *  количества почти всегда НИЖЕ базовой, поэтому подставленная база — это не
 *  подсказка, а лишняя работа: её надо стереть и напечатать своё. Количество,
 *  расход и время подставляются, потому что там угадывать нечего: следующее
 *  свободное число, тот же расход на штуку и продолжение уже заведённого ряда. */
export function createTierDraft(
  existing: ServiceTierDraft[],
  baseDuration: number,
  /** Расход ПЕРВОЙ строки (количество 1, значит он же — за единицу). */
  baseCost = "0",
): ServiceTierDraft {
  const used = new Set(
    existing
      .map((tier) => looseNumber(tier.minQuantity))
      .filter((value): value is number => value !== null),
  );
  let minimum = 2;
  while (used.has(minimum)) minimum += 1;
  return {
    id: `new-${Date.now()}-${existing.length}`,
    minQuantity: String(minimum),
    rowPrice: "",
    rowCost: seedCostFor(existing, baseCost, minimum),
    totalDuration: String(seedDurationFor(existing, baseDuration, minimum)),
  };
}

/** ЧЕЛОВЕК ПИШЕТ СУММУ ЗА ВСЮ СТРОКУ, БАЗА ХРАНИТ ЗА ОДНУ (владелец 2026-08-21:
 *  «давай делать не за шт, а общая цена… например клининговая компания, у них
 *  3 комнаты стоит 100 — это им надо вписать 33.33, неудобно»).
 *
 *  Переводим ровно на двух границах — при чтении из базы и при записи в неё, —
 *  а сам черновик живёт в тех числах, которые человек набрал. Поэтому:
 *    · формат хранения НЕ МЕНЯЕТСЯ: `price_tiers[].price_per_unit` как был за
 *      единицу, так и остался. Ни миграции, ни правки резолверов
 *      (`pricePerUnit`, `durationForQuantity`, `buildServices`), ни риска для
 *      денег уже сохранённых записей;
 *    · старые услуги читаются сами собой: «от 2 по 50» покажется как «100» —
 *      то же число, названное иначе;
 *    · точность сходится. Первая строка — количество 1, деления нет вовсе, и
 *      `services.price numeric(12,2)` не страдает. Ступени лежат в `price_tiers`
 *      (jsonb, без ограничения знаков), поэтому 100/3 хранится целиком и
 *      обратно даёт ровно 100. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Из базы на экран: за одну × количество = сумма за всю строку. */
function rowTotalFromUnit(unit: number | undefined, minimum: number): string {
  if (unit === undefined) return "";
  return String(round2(unit * minimum));
}

/** С экрана в базу: сумма за строку ÷ количество = за одну. БЕЗ округления —
 *  33.333… обязано доехать до хранилища целиком, иначе обратный путь даст
 *  99,99 вместо 100, и человек увидит, что его число тихо испортили. */
function unitFromRowTotal(total: number, minimum: number): number {
  return minimum > 0 ? total / minimum : total;
}

/** ЛИНЗА «ЗА ВСЁ ↔ ЗА ОДНУ» (владелец 2026-08-24: «нажимаю на блок цена —
 *  открывается менюшка, там можно выбрать цена за всё или цена за количество»).
 *
 *  ЧЕРНОВИК ВСЕГДА ХРАНИТ СУММУ ЗА ВСЮ СТРОКУ — в обоих режимах, без
 *  исключений. Режим меняет только два момента: каким числом строка
 *  показывается и как понимается набранное. Это и есть защита от единственной
 *  настоящей мины переключателя: 100 «за всё» показывается как 33,33 «за
 *  одну», и если человек ничего не напечатал, обратно выйдет ровно 100, а не
 *  99,99. Пересчёт происходит ТОЛЬКО когда в поле напечатали новое число.
 *
 *  Ни `price_tiers`, ни `duration_tiers`, ни `cost_tiers` от щелчка не
 *  меняются: в базе они как лежали «за одну», так и лежат. */
export function displayValue(
  rowTotal: string,
  quantity: number,
  mode: PriceEntryMode,
): string {
  if (mode === "total" || rowTotal.trim() === "" || quantity <= 1) return rowTotal;
  const total = strictNumber(rowTotal);
  if (total === null) return rowTotal;
  return String(round2(total / quantity));
}

/** Обратный ход: то, что человек напечатал в поле, — в черновик «за всё». */
export function draftValue(
  typed: string,
  quantity: number,
  mode: PriceEntryMode,
): string {
  if (mode === "total" || typed.trim() === "" || quantity <= 1) return typed;
  const value = strictNumber(typed);
  if (value === null) return typed;
  return String(value * quantity);
}

export type PriceEntryMode = "total" | "unit";

function strictNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateServiceEconomics(
  draft: ServiceEconomicsDraft,
): { errors: ServiceEconomicsErrors; value: ServiceEconomicsValue | null } {
  const errors: ServiceEconomicsErrors = { tiers: {} };

  const parsedRows: {
    draft: ServiceTierDraft;
    minimum: number | null;
    price: number | null;
    duration: number | null;
    cost: number | null;
  }[] = [];

  for (const tier of draft.tiers) {
    const tierErrors: ServiceTierErrors = {};
    const minimum = strictNumber(tier.minQuantity);
    const price = strictNumber(tier.rowPrice);
    const duration = strictNumber(tier.totalDuration);

    if (minimum === null || !Number.isSafeInteger(minimum) || minimum < 2) {
      tierErrors.minQuantity = "От 2 и больше";
    }
    if (tier.rowPrice.trim() !== "" && (price === null || price < 0)) {
      tierErrors.rowPrice = "Число от 0";
    }
    const cost = tier.rowCost.trim() === "" ? 0 : strictNumber(tier.rowCost);
    if (cost === null || cost < 0) {
      tierErrors.rowCost = "Расход от 0";
    }
    if (
      tier.totalDuration.trim() !== "" &&
      (duration === null || !Number.isSafeInteger(duration) || duration < 0)
    ) {
      tierErrors.totalDuration = "Целые минуты";
    }
    if (tier.rowPrice.trim() === "" && tier.totalDuration.trim() === "") {
      tierErrors.row = "Впишите цену или время";
    }
    errors.tiers[tier.id] = tierErrors;
    parsedRows.push({ draft: tier, minimum, price, duration, cost });
  }

  const minimumOwners = new Map<number, string[]>();
  for (const row of parsedRows) {
    if (row.minimum === null || !Number.isSafeInteger(row.minimum) || row.minimum < 2) {
      continue;
    }
    minimumOwners.set(row.minimum, [
      ...(minimumOwners.get(row.minimum) ?? []),
      row.draft.id,
    ]);
  }
  for (const owners of minimumOwners.values()) {
    if (owners.length < 2) continue;
    for (const id of owners) {
      errors.tiers[id] = {
        ...errors.tiers[id],
        minQuantity: "Такое количество уже есть",
      };
    }
  }

  const hasTierErrors = Object.values(errors.tiers).some(
    (tier) => Object.keys(tier).length > 0,
  );
  if (hasTierErrors) return { errors, value: null };

  const sortedRows = [...parsedRows].sort(
    (a, b) => (a.minimum as number) - (b.minimum as number),
  );
  const priceTiers: PriceTierValue[] = [];
  const durationTiers: DurationTierValue[] = [];
  const costTiers: CostTierValue[] = [];
  for (const row of sortedRows) {
    if (row.price !== null) {
      priceTiers.push({
        min_qty: row.minimum as number,
        price_per_unit: unitFromRowTotal(row.price, row.minimum as number),
      });
    }
    if (row.duration !== null) {
      durationTiers.push({
        min_qty: row.minimum as number,
        duration_minutes: row.duration,
      });
    }
    if (row.cost !== null && row.cost > 0) {
      costTiers.push({
        min_qty: row.minimum as number,
        cost_per_unit: unitFromRowTotal(row.cost, row.minimum as number),
      });
    }
  }

  return {
    errors,
    value: {
      price_tiers: priceTiers.length > 0 ? priceTiers : null,
      duration_tiers: durationTiers.length > 0 ? durationTiers : null,
      cost_tiers: costTiers,
      bulk_threshold: 0,
      bulk_price: 0,
    },
  };
}
