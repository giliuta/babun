import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { useReceipts } from "../receipts-queries";

/** ДОХОД С ВЫДАННЫМ ЧЕКОМ: сумму, счёт и дату сервер не даёт менять — бумага
 *  уже у клиента. Номер чека, если правка трогает деньги; иначе null —
 *  заметку и прочее править можно. */
export function useReceiptLock(input: {
  visible: boolean;
  transaction: FinanceTransaction | null | undefined;
  amountCents: number | null;
  accountId: string | null;
  date: string;
}): string | null {
  const { visible, transaction, amountCents, accountId, date } = input;
  const income = !!transaction && transaction.type === "income";
  const receipts = useReceipts({
    transactionIds: transaction ? [transaction.id] : [],
    enabled: visible && income,
  });
  if (!transaction || !income) return null;
  const issued = receipts.data?.find(
    (r) => r.status === "issued" && r.transaction_id === transaction.id,
  );
  if (!issued) return null;
  const moneyTouched =
    amountCents !== Math.round(Math.abs(transaction.amount) * 100) ||
    accountId !== transaction.account_id ||
    date !== transaction.occurred_on;
  return moneyTouched ? issued.number : null;
}
