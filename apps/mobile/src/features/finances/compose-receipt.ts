import type { TransactionDraft } from "@babun/shared/db/repositories/finance-transactions";
import type { ReceiptLineSnapshot } from "@babun/shared/local/finance/receipt";

/**
 * ЧЕК С НУЛЯ: сначала приход, потом бумага на него.
 *
 * ПРИХОД ПИШЕТСЯ С ID ПОПЫТКИ (`requestId` — первичный ключ строки журнала).
 * Если бумага не вышла, человек жмёт «Выписать» ещё раз: без id каждая
 * попытка кладёт в журнал новый приход, и деньги задваиваются. С ним повтор
 * упирается в уже записанную строку (`insertTransaction` читает её как успех)
 * и выписывает чек ровно на неё. Экран держит один id до успешной выписки.
 */
export async function composeReceipt<R>(
  input: { draft: TransactionDraft; lines: ReceiptLineSnapshot[]; requestId: string },
  steps: {
    insert: (draft: TransactionDraft) => Promise<{ id: string }>;
    issue: (args: { transactionId: string; lines: ReceiptLineSnapshot[] }) => Promise<R>;
  },
): Promise<R> {
  const tx = await steps.insert({ ...input.draft, request_id: input.requestId });
  return steps.issue({ transactionId: tx.id, lines: input.lines });
}
