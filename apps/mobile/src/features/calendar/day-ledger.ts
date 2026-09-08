import type { DayExtra } from "@babun/shared/local/day-extras";
import {
  signedAmount,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";

// ДЕНЬГИ ДНЯ В КАЛЕНДАРЕ — ИЗ ЛЕДЖЕРА (владелец 2026-09-07: «сделай так,
// чтобы внизу в календаре доход/расход заработал»). Футер и разбор дня
// считали только записи и «ручные операции дня» старой схемы (day_extras);
// операция, добавленная на вкладке «Финансы» (чаевые, заправка), в календаре
// не появлялась. Теперь ручные проводки леджера входят в ту же формулу как
// «ручные операции»: computeDayFinance получает их вместе с day_extras.
//
// Авто-проводки записей сюда НЕ идут — их деньги computeDayFinance уже
// считает по самим записям (оплаты), иначе доход удвоился бы. Переводы
// нейтральны для P&L.

export function ledgerExtrasForDay(
  transactions: readonly FinanceTransaction[],
  ymd: string,
): DayExtra[] {
  const out: DayExtra[] = [];
  for (const tx of transactions) {
    if (tx.occurred_on !== ymd) continue;
    if (tx.source !== "manual") continue;
    if (tx.type === "transfer") continue;
    const kind = tx.type === "expense" ? "expense" : "income";
    out.push({
      id: `tx:${tx.id}`,
      name: tx.notes?.trim() || (kind === "income" ? "Поступление" : "Расход"),
      // Возврат — отрицательный доход, sumExtras это переживает.
      amount: kind === "income" ? signedAmount(tx) : Math.abs(tx.amount),
      kind,
    });
  }
  return out;
}

/** Ручные проводки диапазона, разложенные по дням — для футера недели. */
export function ledgerExtrasByDay(
  transactions: readonly FinanceTransaction[],
): Map<string, DayExtra[]> {
  const byDay = new Map<string, DayExtra[]>();
  const days = new Set(transactions.map((tx) => tx.occurred_on));
  for (const ymd of days) {
    const extras = ledgerExtrasForDay(transactions, ymd);
    if (extras.length > 0) byDay.set(ymd, extras);
  }
  return byDay;
}
