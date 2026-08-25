/**
 * РАСЧЁТ УСЛУГИ: ЦЕНА, РАБОТА, СЛОТ (спека владельца v4, 2026-08-25).
 *
 * Один модуль на всё, что считает деньги и минуты услуги. Он чистый: ни базы,
 * ни React, ни форматирования — только числа. Поэтому его целиком покрывают
 * тесты, и поэтому же ни один экран не имеет права считать это у себя.
 *
 * ДВА ТИПА УСЛУГИ, И ЭТО ФУНДАМЕНТ:
 *   • `quantity` — одна работа, повторённая N раз. «Три кондиционера» — это
 *     три раза одна работа, и вопрос «сколько стоит одна» имеет смысл.
 *   • `variant` — разные объёмы работ БЕЗ математической связи. Трёхкомнатная
 *     квартира не равна «три раза комната», а семикомнатная не выводится
 *     экстраполяцией — это отдельный разговор с клиентом. Считать здесь нечего,
 *     поэтому у вариантов нет ни порогов, ни правила «свыше».
 *
 * ЧТО СЧИТАЕТСЯ ПО-РАЗНОМУ И ПОЧЕМУ:
 *   ЦЕНА зависит от `pricing_mode`. `per_unit` — цена ступени за ОДНУ единицу,
 *   умножается на количество. `flat` — цена ступени это ФИКСИРОВАННЫЙ ИТОГ за
 *   диапазон, и умножать её нельзя: «до пяти комнат — €200» не превращается в
 *   €1000 на пяти.
 *
 *   ВРЕМЯ всегда суммарное, в обоих режимах. `duration` ступени — полная
 *   длительность визита, а не «за штуку»: бригаду планируют слотом в календаре,
 *   и «45 минут за каждый из трёх кондиционеров» — не то число, которое туда
 *   уходит. Кривая при этом нелинейна, и в этом весь смысл ступеней: первый
 *   кондиционер — 30 минут вместе с «приехать и разложиться», второй — уже 15.
 */

export type ServiceType = "quantity" | "variant";
export type PricingMode = "per_unit" | "flat";

export interface PricingTier {
  /** С какого количества действует ступень. */
  fromQty: number;
  /** `per_unit` — за одну; `flat` — итог за диапазон. */
  price: number;
  /** Полная длительность визита на этом количестве, минуты. */
  durationMin: number;
}

export interface PricingVariant {
  id: string;
  name: string;
  price: number;
  durationMin: number;
}

export interface PricedService {
  serviceType: ServiceType;
  pricingMode: PricingMode;
  tiers: PricingTier[];
  variants: PricingVariant[];
  /** Единица: у «часа» количество И ЕСТЬ длительность. */
  unit: string | null;
  /** Правило за последним порогом. `null` — правила нет. */
  overflowPrice: number | null;
  overflowDurationMin: number | null;
  bufferBeforeMin: number;
  bufferAfterMin: number;
}

export interface SelectedService {
  service: PricedService;
  qty: number;
  variantId?: string | null;
}

/** Копейки, а не float-хвост: 50,01 × 3 в двоичной арифметике даёт
 *  150.03000000000003, и это число уезжало бы в базу и в счёт. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Мусор не считается: NaN, Infinity и отрицательные количества — это не
 *  «ноль работы», а сломанный ввод, и они не должны молча давать цену. */
function safeQty(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

function safeNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Ступень, действующая на этом количестве: последняя с `fromQty <= qty`.
 *  Ниже первого порога действует первая ступень — прайс не отказывает. */
export function resolveTier(
  tiers: readonly PricingTier[],
  qty: number,
): PricingTier | null {
  if (tiers.length === 0) return null;
  const sorted = [...tiers].sort((a, b) => a.fromQty - b.fromQty);
  const matched = sorted.filter((tier) => tier.fromQty <= qty).pop();
  return matched ?? sorted[0];
}

function maxTierQty(tiers: readonly PricingTier[]): number {
  return tiers.reduce((max, tier) => Math.max(max, tier.fromQty), 0);
}

function variantOf(
  service: PricedService,
  variantId?: string | null,
): PricingVariant | null {
  if (!variantId) return null;
  return service.variants.find((variant) => variant.id === variantId) ?? null;
}

/** ЦЕНА. Вариант без выбранного варианта стоит ноль — это не ошибка расчёта, а
 *  незаконченный выбор, и запись такую строку не сохранит. */
export function calcPrice(
  service: PricedService,
  qty: number,
  variantId?: string | null,
): number {
  if (service.serviceType === "variant") {
    return round2(variantOf(service, variantId)?.price ?? 0);
  }
  const quantity = safeQty(qty);
  if (quantity === 0) return 0;
  const tier = resolveTier(service.tiers, quantity);
  if (!tier) return 0;

  if (service.pricingMode === "flat") {
    // Итог за диапазон плюс правило «свыше» за каждую единицу за последним
    // порогом. Без правила (`overflowPrice = null`) действует последняя
    // ступень — цену за уже сделанную работу продукт не занижает и не
    // выдумывает.
    const beyond = Math.max(0, quantity - maxTierQty(service.tiers));
    return round2(tier.price + beyond * safeNumber(service.overflowPrice));
  }
  return round2(tier.price * quantity);
}

/** РАБОТА без буферов. У «часа» количество и есть длительность: массаж на два
 *  часа длится два часа, и отдельное поле длительности там неизбежно
 *  разошлось бы с количеством. */
export function calcWorkDuration(
  service: PricedService,
  qty: number,
  variantId?: string | null,
): number {
  if (service.serviceType === "variant") {
    return Math.max(0, Math.round(variantOf(service, variantId)?.durationMin ?? 0));
  }
  const quantity = safeQty(qty);
  if (quantity === 0) return 0;
  if (service.unit === "ч") return Math.round(quantity * 60);

  const tier = resolveTier(service.tiers, quantity);
  if (!tier) return 0;
  const beyond = Math.max(0, quantity - maxTierQty(service.tiers));
  return Math.round(
    tier.durationMin + beyond * safeNumber(service.overflowDurationMin),
  );
}

/** Округление ВВЕРХ к шагу сетки: лучше зарезервировать лишние минуты, чем
 *  наложить записи друг на друга. */
export function roundToSlot(minutes: number, granularity: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  const step = Number.isFinite(granularity) && granularity > 0 ? granularity : 1;
  return Math.ceil(minutes / step) * step;
}

/**
 * СЛОТ В КАЛЕНДАРЕ = буферы + работа, округлённые вверх.
 *
 * БУФЕРЫ БЕРУТСЯ МАКСИМАЛЬНЫЕ, А НЕ СУММИРУЮТСЯ: дорога до адреса одна, и две
 * услуги в одном визите не удваивают её. Суммирование давало бы «час езды»
 * там, где ехали двадцать минут, и календарь врал бы о занятости бригады.
 */
export function calcSlot(
  selected: readonly SelectedService[],
  granularity: number,
): number {
  if (selected.length === 0) return 0;
  const work = selected.reduce(
    (sum, item) => sum + calcWorkDuration(item.service, item.qty, item.variantId),
    0,
  );
  const before = Math.max(
    0,
    ...selected.map((item) => safeNumber(item.service.bufferBeforeMin)),
  );
  const after = Math.max(
    0,
    ...selected.map((item) => safeNumber(item.service.bufferAfterMin)),
  );
  return roundToSlot(before + work + after, granularity);
}

/** ЭКОНОМИЯ ПО ЛЕСТНИЦЕ — внутренняя информация для бригады: сколько клиент
 *  выигрывает против цены первой ступени. У `flat` и у вариантов сравнивать не
 *  с чем, поэтому там ноль. */
export function calcSavings(service: PricedService, qty: number): number {
  if (service.serviceType === "variant" || service.pricingMode === "flat") {
    return 0;
  }
  const quantity = safeQty(qty);
  const first = resolveTier(service.tiers, 1);
  if (!first || quantity === 0) return 0;
  return Math.max(0, round2(first.price * quantity - calcPrice(service, quantity)));
}
