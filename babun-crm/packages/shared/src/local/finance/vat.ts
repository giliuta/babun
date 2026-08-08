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
