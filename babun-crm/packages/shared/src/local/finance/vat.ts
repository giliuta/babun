import type { FinanceTransaction } from "./transaction";

// НДС — ЧУЖИЕ ДЕНЬГИ ВНУТРИ ТВОИХ.
//
// Клиент платит 480: 400 — выручка компании, 80 — налог, который компания
// держит для государства. Если считать доходом все 480, прибыль завышена на
// 80, и в конце квартала выясняется, что часть «заработанного» надо отдать.
//
// Поставщику компания платит налог сама — он идёт В ЗАЧЁТ. Поэтому отдать
// нужно РАЗНИЦУ: собрал минус уплатил. Владелец 2026-08-09: «считать
// наперёд» — цифра должна быть видна всегда, а не всплывать в конце квартала.

export type VatMode = "off" | "inclusive" | "exclusive";

/** Как назначен налог КОНКРЕТНОЙ операции. Три клавиши, которые владелец
 *  жмёт руками: «Без НДС» — наличка от частника, «НДС включён» — цена уже с
 *  налогом, «Плюс НДС» — налог сверху введённой цены. */
export type TxVatMode = "none" | "inclusive" | "exclusive";

export const TX_VAT_MODE_LABELS: Record<TxVatMode, string> = {
  none: "Без НДС",
  inclusive: "НДС включён",
  exclusive: "Плюс НДС",
};

/** Режим операции по умолчанию — из действующей настройки (счёт → команда →
 *  компания). Выключенный НДС означает «без налога», а не «спроси ещё раз». */
export function defaultTxVatMode(settings: VatSettings): TxVatMode {
  if (settings.mode === "off" || !(settings.rate > 0)) return "none";
  return settings.mode;
}

export interface VatBreakdown {
  /** Что уйдёт в базу и ляжет на счёт. */
  gross: number;
  /** Налог внутри валовой суммы. 0 — операция без налога. */
  vat: number;
  /** Что останется компании. */
  net: number;
}

/**
 * Введённая сумма → то, что реально движется по счёту.
 *
 * Здесь единственное место, где «плюс НДС» превращает цену в деньги: при
 * exclusive человек вводит 400, а на счёт приходит 480. Считать это в UI
 * нельзя — тогда запись, инвойс и чек разойдутся на ставку.
 */
export function applyTxVat(
  input: number,
  mode: TxVatMode,
  rate: number,
): VatBreakdown {
  if (mode === "none" || !(rate > 0)) {
    return { gross: round2(input), vat: 0, net: round2(input) };
  }
  const gross = mode === "exclusive" ? grossFromNet(input, rate) : round2(input);
  const vat = vatFromGross(gross, rate);
  return { gross, vat, net: round2(gross - vat) };
}

/** Обратный ход для повторного открытия операции: в поле показываем то, что
 *  человек когда-то ввёл, а не то, что легло на счёт. */
export function inputFromGross(
  gross: number,
  mode: TxVatMode,
  rate: number,
): number {
  if (mode === "exclusive" && rate > 0) return netFromGross(gross, rate);
  return round2(gross);
}

export interface VatSettings {
  mode: VatMode;
  /** Процент. 19 — Кипр, 24 — Греция. */
  rate: number;
  /** Текст освобождения для документов (печатается вместо ставки). */
  exemptionNote: string | null;
}

export const VAT_OFF: VatSettings = { mode: "off", rate: 0, exemptionNote: null };

/** Налог ВНУТРИ валовой суммы: 480 при ставке 20 → 80. */
export function vatFromGross(gross: number, rate: number): number {
  if (!(rate > 0)) return 0;
  return round2((gross * rate) / (100 + rate));
}

/** Валовая сумма из цены БЕЗ налога: 400 при ставке 20 → 480. */
export function grossFromNet(net: number, rate: number): number {
  if (!(rate > 0)) return net;
  return round2(net * (1 + rate / 100));
}

/** Сколько из валовой суммы останется компании: 480 при ставке 20 → 400. */
export function netFromGross(gross: number, rate: number): number {
  return round2(gross - vatFromGross(gross, rate));
}

/** Валовая цена для прайса: при «плюс НДС» налог добавляется сверху, при
 *  «включён» цена уже валовая. Одна точка — иначе итог записи и итог
 *  инвойса разойдутся на ставку. */
export function grossForPrice(price: number, settings: VatSettings): number {
  if (settings.mode === "exclusive") return grossFromNet(price, settings.rate);
  return price;
}

export interface VatSummary {
  /** Налог, собранный с клиентов (в доходах). */
  collected: number;
  /** Налог, уплаченный поставщикам (в расходах) — идёт в зачёт. */
  paid: number;
  /** Сколько отдать государству. Отрицательное — государство должно тебе. */
  due: number;
  /** Выручка без налога: то, что реально заработано. */
  netIncome: number;
}

/**
 * Сводка по НДС за набор операций.
 *
 * Переводы между своими счетами НЕ ТРОГАЕМ: деньги не меняют владельца,
 * налога там нет и быть не может. Возвраты приходят с отрицательной суммой
 * и таким же налогом — они сами уменьшают собранное.
 */
export function summarizeVat(
  transactions: readonly FinanceTransaction[],
): VatSummary {
  let collected = 0;
  let paid = 0;
  let netIncome = 0;
  for (const t of transactions) {
    if (t.type === "transfer") continue;
    const vat = t.vat_amount ?? 0;
    if (t.type === "income" || t.type === "refund") {
      // refund хранится отрицательным — суммирование само вычитает.
      collected += vat;
      netIncome += t.amount - vat;
    } else if (t.type === "expense") {
      paid += vat;
    }
  }
  return {
    collected: round2(collected),
    paid: round2(paid),
    due: round2(collected - paid),
    netIncome: round2(netIncome),
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
