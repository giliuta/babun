import { looseNumber, parseCostDrafts, parseDurationTiers, parsePriceTiers } from "./economics/parse";
import type {
  CostTierValue,
  DurationTierValue,
  PriceTierValue,
  ServiceEconomicsDraft,
  ServiceEconomicsErrors,
  ServiceEconomicsValue,
  ServiceTierDraft,
  ServiceTierErrors,
} from "./economics/types";

// Service economics: tier draft <-> stored values. Shapes and stored-JSON
// readers live in `./economics/`.

export type {
  CostTierValue,
  DurationTierValue,
  PriceTierValue,
  ServiceEconomicsDraft,
  ServiceEconomicsErrors,
  ServiceEconomicsValue,
  ServiceTierDraft,
  ServiceTierErrors,
} from "./economics/types";
export { parseDurationTiers, parsePriceTiers } from "./economics/parse";

interface ServiceEconomicsSource {
  cost_tiers?: unknown;
  price_tiers?: unknown;
  duration_tiers?: unknown;
  bulk_threshold?: unknown;
  bulk_price?: unknown;
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
      // РАСХОД — ЗА ОДНУ, КАК В БАЗЕ И НА ЭКРАНЕ. Хранение «за всю строку»
      // (×min здесь, ÷min при сохранении) разошлось бы с листом услуги
      // (`ServiceSheet`: showCost/storeCost), который понимает поле «за одну»:
      // ступень «от 3 · €10» показывалась бы как 30, набранные 12 сохранялись
      // бы как 4, а деньги в прибыли записи (`costPerUnit × qty`) ехали мимо.
      rowCost: String(round2(costByMinimum.get(minimum)?.cost_per_unit ?? 0)),
      totalDuration:
        durationByMinimum.get(minimum) === undefined
          ? ""
          : String(durationByMinimum.get(minimum)?.duration_minutes),
    })),
  };
}

/** Время новой строки: последнее время + шаг между двумя последними. */
export function nextDuration(existing: ServiceTierDraft[], baseDuration: number): number {
  const series = [
    baseDuration,
    ...existing.map((tier) => looseNumber(tier.totalDuration) ?? null),
  ].filter((value): value is number => value !== null);
  const last = series[series.length - 1] ?? baseDuration;
  if (series.length < 2) return last;
  const step = last - series[series.length - 2];
  return Math.max(0, last + step);
}

/** НОВАЯ СТРОКА НЕ ПОДСТАВЛЯЕТ ЦЕНУ. Цена от количества почти всегда НИЖЕ
 *  базовой, поэтому подставленная база — это не подсказка, а лишняя работа: её
 *  надо стереть и напечатать своё. Количество, расход и время подставляются,
 *  потому что там угадывать нечего: следующее свободное число, тот же расход
 *  на штуку и продолжение уже заведённого ряда. */
export function createTierDraft(
  existing: ServiceTierDraft[],
  baseDuration: number,
  /** Расход ПЕРВОЙ строки (количество 1, значит он же — за единицу). */
  baseCost = "0",
): ServiceTierDraft {
  // КОЛИЧЕСТВО — СЛЕДУЮЩЕЕ СВОБОДНОЕ ЧИСЛО. Единица измерения живёт в НАЗВАНИИ
  // услуги («Обмотка 1 м», «Чистка 10 м²»), и количество значит ровно одно —
  // СКОЛЬКО РАЗ взяли услугу. Для счёта «два после одного» не выдумка, а
  // очевидное следующее.
  //
  // ВРЕМЯ ПРОДОЛЖАЕТ ШАГ, КОТОРЫЙ ЗАДАЛ ЧЕЛОВЕК: если следующая ступень на 30
  // мин больше предыдущей, то и следующая будет на 30 мин больше; если две
  // подряд одинаковы — следующая такая же. Ряд — первая строка (количество 1)
  // и все ступени; шаг — разница двух последних. Пока строка одна, шага нет —
  // берём её время как есть, а не умножаем: «2 ч», которых человек не вводил,
  // продукт за него не называет.
  const used = new Set(
    existing
      .map((tier) => looseNumber(tier.minQuantity))
      .filter((value): value is number => value !== null),
  );
  let minimum = 2;
  while (used.has(minimum)) minimum += 1;
  const previous = existing[existing.length - 1];
  return {
    id: `new-${Date.now()}-${existing.length}`,
    minQuantity: String(minimum),
    rowPrice: "",
    rowCost: previous ? previous.rowCost : baseCost,
    totalDuration: String(nextDuration(existing, baseDuration)),
  };
}

/** ЧЕЛОВЕК ПИШЕТ СУММУ ЗА ВСЮ СТРОКУ, БАЗА ХРАНИТ ЗА ОДНУ (клининговой
 *  компании «3 комнаты стоит 100» неудобно вписывать как 33.33).
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

/** ЛИНЗА «ЗА ВСЁ ↔ ЗА ОДНУ» (в блоке «Цена» выбирают цену за всё или за
 *  количество).
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
    // Пустая цена ступени — «как выше»: ступень без цены в прайс не уходит,
    // и на этом количестве действует предыдущая цена (ступень только меняет
    // время). «Бесплатно» — это пустая БАЗОВАЯ цена.
    // Требовать хоть что-то одно всё же надо: строка без цены И без времени
    // не добавляет к услуге ничего и лишь занимает место в таблице.
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
        // Расход в черновике уже «за одну» — см. economicsDraftFromService.
        cost_per_unit: row.cost,
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
