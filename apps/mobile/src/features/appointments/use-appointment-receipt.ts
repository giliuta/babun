import { useMemo } from "react";
import { useAppointmentLedger } from "@/features/finances/queries";
import { useReceipts } from "@/features/documents/receipts-queries";
import { incomesAwaitingReceipt } from "@/features/documents/receipt-for-payment";

// ЧЕК ЗАПИСИ ДЛЯ ЗНАЧКА В «ОПЛАТЕ» (владелец 2026-10-03: «оплатили — запись
// становится оплачена, и открывается возможность делать чек; нажимаю на
// иконку чека — оно сразу заполняет»). Значку нужно два ответа: есть ли
// приход, которому чек ещё не выписан (тогда значок ведёт в составитель
// чека с этой проводкой), и последний выписанный чек (тогда значок горит и
// открывает его).
export function useAppointmentReceipt(appointmentId: string | null, enabled: boolean) {
  const id = enabled ? appointmentId : null;
  const ledger = useAppointmentLedger(id);
  const receipts = useReceipts({ appointmentId: id, enabled: !!id });
  return useMemo(() => {
    const live = (receipts.data ?? []).filter((r) => r.status !== "void");
    const awaiting = incomesAwaitingReceipt(ledger.data ?? [], receipts.data ?? []);
    return {
      /** Первый приход без чека — на него и выпишем. */
      next: receipts.isSuccess ? (awaiting[0] ?? null) : null,
      /** Последний выписанный чек записи. */
      latest: live[0] ?? null,
    };
  }, [ledger.data, receipts.data, receipts.isSuccess]);
}
