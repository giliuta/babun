import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { incomeDeals } from "./income-deals";
import {
  mergeByRecord,
  recordRows,
  type RecordRow,
  type RecordRowRefs,
} from "./record-rows";

// ОПЕРАЦИИ ПОД СПИСКОМ СЧЕТОВ (владелец 2026-09-15: «нажимаю „Наличные“ — и
// внизу чётко порядок всех операций, просто по дням; нельзя выбрать доход,
// расход»). Строка — визит, как во всех панелях «Финансов»: оплата и её полный
// откат прячутся парой (денег не было), перевод между двумя счетами — одной
// строкой «Наличные → Карта».
//
// `accountIds` — выбранный счёт либо все счета среза. Вторая нога перевода
// может лежать на невыбранном счёте, поэтому сюда приходит журнал целиком.
export function accountOperationRows(
  ledger: readonly FinanceTransaction[],
  accountIds: ReadonlySet<string>,
  refs: RecordRowRefs,
): RecordRow[] {
  const own = ledger.filter(
    (tx) => tx.account_id !== null && accountIds.has(tx.account_id),
  );
  const tag = (rows: RecordRow[], tone: "income" | "expense") =>
    rows.map((row) => ({ ...row, tone, key: `${tone}:${row.key}` }));

  const income = tag(recordRows(incomeDeals(own), refs), "income");
  const expense = tag(
    recordRows(own.filter((tx) => tx.type === "expense"), refs),
    "expense",
  );

  const transferGroups = new Set(
    own.flatMap((tx) =>
      tx.type === "transfer" && tx.transfer_group_id ? [tx.transfer_group_id] : [],
    ),
  );
  const transfers = recordRows(
    ledger.filter(
      (tx) =>
        tx.type === "transfer"
        && !!tx.transfer_group_id
        && transferGroups.has(tx.transfer_group_id),
    ),
    refs,
  ).map((row) => ({ ...row, key: `tr:${row.key}` }));

  return mergeByRecord([...income, ...expense, ...transfers]).sort(newestFirst);
}

/** Свежее сверху: день, потом время, потом ключ — порядок панелей «Финансов». */
function newestFirst(a: RecordRow, b: RecordRow): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const at = a.time ?? "";
  const bt = b.time ?? "";
  if (at !== bt) return at < bt ? 1 : -1;
  return a.key < b.key ? 1 : -1;
}
