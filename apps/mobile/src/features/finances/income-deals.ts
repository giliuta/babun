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
//
// ВОЗВРАТ ЧАСТЯМИ, СЛОЖИВШИЙСЯ В ЦЕЛОЕ (прогон оплаты 04.10). Итог записи
// снизили — клиенту вернули €20 из предоплаты €50, потом визит отменили —
// вернулись остальные €30. Денег по записи ноль, но ни один возврат не равен
// оплате, и лента держала строку «€0 · 3 платежа», хотя запись, отменённая
// одним возвратом, из неё уходит. Сравнивается СУММА возвратов дохода.

export function incomeDeals(
  transactions: readonly FinanceTransaction[],
): FinanceTransaction[] {
  const byId = new Map(transactions.map((tx) => [tx.id, tx]));
  const refundsOf = new Map<string, FinanceTransaction[]>();
  for (const tx of transactions) {
    if (tx.type !== "refund" || !tx.refund_of_id) continue;
    const original = byId.get(tx.refund_of_id);
    if (!original || original.type !== "income") continue;
    const list = refundsOf.get(original.id);
    if (list) list.push(tx);
    else refundsOf.set(original.id, [tx]);
  }
  const hidden = new Set<string>();
  for (const [incomeId, refunds] of refundsOf) {
    const original = byId.get(incomeId)!;
    // Полный откат — суммы совпадают до цента.
    const refundedCents = refunds.reduce((sum, r) => sum + Math.round(Math.abs(r.amount) * 100), 0);
    if (refundedCents !== Math.round(original.amount * 100)) continue;
    hidden.add(incomeId);
    for (const r of refunds) hidden.add(r.id);
  }
  return transactions.filter(
    (tx) => (tx.type === "income" || tx.type === "refund") && !hidden.has(tx.id),
  );
}
