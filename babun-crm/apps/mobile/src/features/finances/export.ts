import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import type { FinanceTransaction, PaymentMethod } from "@babun/shared/local/finance/transaction";
import type { Account } from "@babun/shared/local/finance/account";
import { csvCell, csvDocument, csvTextCell } from "@/lib/share-csv";

const TYPE_LABEL: Record<FinanceTransaction["type"], string> = {
  income: "Доход",
  expense: "Расход",
  transfer: "Перевод",
  refund: "Возврат",
};

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
  other: "Другое",
};

export interface CsvLookups {
  /** id команды → имя; NULL team_id печатается как «Компания». */
  teamName?: ReadonlyMap<string, string>;
  accounts?: readonly Pick<Account, "id" | "name">[];
}

export function financeTransactionsToCsv(
  transactions: readonly FinanceTransaction[],
  categories: readonly FinanceCategory[],
  lookups: CsvLookups = {},
): { contents: string; count: number } {
  const exportable = transactions.filter((tx) => tx.type !== "transfer");
  const categoryName = new Map(categories.map((item) => [item.id, item.name]));
  const accountName = new Map(
    (lookups.accounts ?? []).map((item) => [item.id, item.name]),
  );
  const rows = exportable.map((tx) => [
    csvCell(tx.occurred_on),
    csvCell(TYPE_LABEL[tx.type]),
    csvTextCell(tx.category_id ? categoryName.get(tx.category_id) ?? "" : ""),
    // Общекорпоративная операция без команды — честная строка «Компания».
    csvTextCell(
      tx.team_id ? lookups.teamName?.get(tx.team_id) ?? "" : "Компания",
    ),
    csvTextCell(tx.account_id ? accountName.get(tx.account_id) ?? "" : ""),
    csvTextCell(tx.payment_method ? METHOD_LABEL[tx.payment_method] : ""),
    csvCell(tx.amount),
    csvTextCell(tx.notes ?? ""),
  ]);

  return {
    contents: csvDocument([
      [
        "Дата",
        "Тип",
        "Категория",
        "Команда",
        "Счёт",
        "Способ оплаты",
        "Сумма",
        "Заметка",
      ].map(csvCell),
      ...rows,
    ]),
    count: exportable.length,
  };
}
