import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { csvCell, csvDocument, csvTextCell } from "@/lib/share-csv";

const TYPE_LABEL: Record<FinanceTransaction["type"], string> = {
  income: "Доход",
  expense: "Расход",
  transfer: "Перевод",
  refund: "Возврат",
};

export function financeTransactionsToCsv(
  transactions: readonly FinanceTransaction[],
  categories: readonly FinanceCategory[],
): { contents: string; count: number } {
  const exportable = transactions.filter((tx) => tx.type !== "transfer");
  const categoryName = new Map(categories.map((item) => [item.id, item.name]));
  const rows = exportable.map((tx) => [
    csvCell(tx.occurred_on),
    csvCell(TYPE_LABEL[tx.type]),
    csvTextCell(tx.category_id ? categoryName.get(tx.category_id) ?? "" : ""),
    csvCell(tx.amount),
    csvTextCell(tx.notes ?? ""),
  ]);

  return {
    contents: csvDocument([
      ["Дата", "Тип", "Категория", "Сумма", "Заметка"].map(csvCell),
      ...rows,
    ]),
    count: exportable.length,
  };
}
