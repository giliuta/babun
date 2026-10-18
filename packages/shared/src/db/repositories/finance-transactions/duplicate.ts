// Повтор вставки с тем же `request_id`: тот же ли это замысел.

import { exactMoneyAmountToCents } from "../../../common/utils/money";
import type { FinanceTransaction } from "../../../local/finance/transaction";
import type { TransactionDraft } from "./writes";

/** Id занят строкой с другим содержимым: прошлая попытка записала одно, а
 *  человек повторил уже другое. Молчаливый «успех» показал бы тост «добавлена»
 *  про сумму, которой в базе нет. */
export const REQUEST_ID_REUSED =
  "Операция с этим номером уже записана с другими данными. Обновите ленту и проверьте её, прежде чем записывать снова.";

const cents = (amount: number): number | null =>
  exactMoneyAmountToCents(Math.abs(amount), {});

const text = (value: string | null | undefined): string => (value ?? "").trim();

/**
 * Совпадает ли найденная по `request_id` строка с тем, что отправили сейчас.
 * Сравниваются поля, которые человек правит перед повтором: тип, сумма,
 * счёт, категория, день и заметка. Служебное (налоговый снимок, команда) сервер
 * достраивает сам — оно в замысел не входит. День у возврата не сверяется:
 * это «сегодня», и повтор через полночь — тот же возврат.
 */
export function sameLedgerContent(
  existing: Pick<
    FinanceTransaction,
    "type" | "amount" | "account_id" | "category_id" | "occurred_on" | "notes"
  >,
  draft: TransactionDraft,
): boolean {
  if (existing.type !== draft.type) return false;
  if (cents(existing.amount) !== cents(draft.amount)) return false;
  if ((existing.account_id ?? null) !== (draft.account_id ?? null)) return false;
  if ((existing.category_id ?? null) !== (draft.category_id ?? null)) return false;
  if (text(existing.notes) !== text(draft.notes)) return false;
  if (draft.type !== "refund" && draft.occurred_on && existing.occurred_on !== draft.occurred_on) {
    return false;
  }
  return true;
}
