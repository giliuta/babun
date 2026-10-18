// Helpers every appointment mutation hook shares.
import { clientKeys } from "@/lib/client-query-keys";
import { useAccessBlocks } from "@/session/access-queries";
import { memberWriteRefusal } from "@/features/appointments/member-writes";

/** Сотрудник пишет запись только дверями сервера (STORY-088): каждое поле там
 *  проверяется своим блоком в календаре записи. Отказ — словами, с названием
 *  блока, которого не хватило. */
export function useMemberRefusal() {
  const blocks = useAccessBlocks().data;
  return (step: string, message: string): Error =>
    new Error(
      memberWriteRefusal(message, (key) => blocks?.find((b) => b.key === key)?.title) ??
        `${step}: ${message}`,
    );
}

// Appointment writes go through the shared repo (same as web). Completing an
// appointment triggers finance income sync server-side (sync_appointment_finance
// writes an income row with account_id), so we also invalidate the finance
// queries INCLUDING account balances.
export function invalidateKeys() {
  return [
    ["appointments"],
    ["transactions"],
    clientKeys.all(),
    ["accounts"],
    ["invoices"],
    // Чек рождается сервером на приём денег (issue_receipt_for_income):
    // оплата записи выдаёт чек, и список чеков обязан его довезти.
    ["receipts"],
  ];
}
