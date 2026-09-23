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

  // ЧТО ПЕРЕВОД СДЕЛАЛ С ЭТОЙ ЛЕНТОЙ — сумма его ног внутри среза, в копейках.
  // Обе ноги в срезе (лента всех счетов) дают ноль: деньги переехали между
  // показанными счетами, строка нейтральна и в итог дня не входит. Одна нога
  // (лента «Наличных», вторая на «Карте») даёт −55 или +55: для этой ленты
  // деньги правда ушли или пришли, и «€55» без знака при итоге дня «€0»
  // прятало это (живой прогон 2026-09-23).
  const sliceNet = new Map<string, number>();
  for (const tx of own) {
    if (tx.type !== "transfer" || !tx.transfer_group_id) continue;
    const cents = Math.round(tx.amount * 100);
    sliceNet.set(
      tx.transfer_group_id,
      (sliceNet.get(tx.transfer_group_id) ?? 0) + cents,
    );
  }
  const groupOfTx = new Map(
    ledger.flatMap((tx) =>
      tx.type === "transfer" && tx.transfer_group_id
        ? [[tx.id, tx.transfer_group_id] as const]
        : [],
    ),
  );
  const transfers = recordRows(
    ledger.filter(
      (tx) =>
        tx.type === "transfer"
        && !!tx.transfer_group_id
        && sliceNet.has(tx.transfer_group_id),
    ),
    refs,
  ).map((row) => {
    // Склеенный перевод — `transfer:<группа>`, одиночная нога — id проводки.
    const group = row.key.startsWith("transfer:")
      ? row.key.slice("transfer:".length)
      : groupOfTx.get(row.key);
    const net = group ? (sliceNet.get(group) ?? 0) : 0;
    return net === 0
      ? { ...row, key: `tr:${row.key}` }
      : { ...row, key: `tr:${row.key}`, amount: net / 100, crossesSlice: true };
  });

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
