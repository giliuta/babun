import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";

// СВАЙП «УДАЛИТЬ» — ТОЛЬКО У ОПЕРАЦИЙ, ЗАВЕДЁННЫХ РУКАМИ (владелец 03.10:
// «удалить операцию — не кнопка внизу»; «это касается только тех операций,
// которые мы своими руками создаём; доход через услугу так не удалить»).
//
// Кнопки «Удалить операцию» в листе больше нет: удаляют свайпом влево по
// строке в ленте «Финансов» и в листе дня календаря (долгое нажатие — то же
// словами), как счета и клиентов. Деньги записи снимаются в самой записи
// (блок «Оплата»), проводка инвойса — в инвойсе: у таких строк свайпа нет.
// Права решает вызывающий (его правило правки строки) — здесь только то,
// что не зависит от человека.

/** Строка ленты, которую вообще можно удалить руками. */
export function deletableByHand(tx: FinanceTransaction): boolean {
  if (tx.source !== "manual") return false;
  if (tx.invoice_id) return false;
  // Деньги записи — её блок «Оплата», не лента.
  if (tx.appointment_id && tx.type !== "expense") return false;
  // Перевод — целиком, по паре; без связи пары удалять нечего.
  if (tx.type === "transfer" && !tx.transfer_group_id) return false;
  return true;
}

/** По доходу уже вернули деньги: сервер его не удалит, пока жив возврат. */
export function refundBlocksDelete(
  tx: FinanceTransaction,
  refunded: number | undefined,
): boolean {
  return tx.type === "income" && (refunded === undefined || refunded > 0);
}
