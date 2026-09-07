import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";

// «ДОХОД» — ТОЛЬКО СДЕЛКИ (владелец 2026-09-07: «нажимаю „Доход“ — там
// должны быть только доходные сделки за период»).
//
// Леджер честен до буквы: снятая в записи оплата лежит в нём парой строк —
// «+50 Оплата по заявке» и «−50 Оплата снята». В ленте всех операций это
// правильно (история денег), но в разрезе «Доход» такая пара — не сделка, а
// шум: денег не было. Пару прячем целиком; плитка «Доход» считает то же
// самое (income + refund), поэтому список и цифра сходятся.
//
// Частичный возврат (клиенту вернули часть) — реальное событие: остаётся и
// он, и исходная оплата.

export function incomeDeals(
  transactions: readonly FinanceTransaction[],
): FinanceTransaction[] {
  const byId = new Map(transactions.map((tx) => [tx.id, tx]));
  const hidden = new Set<string>();
  for (const tx of transactions) {
    if (tx.type !== "refund" || !tx.refund_of_id) continue;
    const original = byId.get(tx.refund_of_id);
    if (!original || original.type !== "income") continue;
    // Полный откат — суммы совпадают до цента.
    if (Math.round(Math.abs(tx.amount) * 100) !== Math.round(original.amount * 100)) continue;
    hidden.add(tx.id);
    hidden.add(original.id);
  }
  return transactions.filter(
    (tx) => (tx.type === "income" || tx.type === "refund") && !hidden.has(tx.id),
  );
}
