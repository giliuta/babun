import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Appointment } from "@babun/shared/local/appointments";
import {
  cancelAppointmentPayment,
  recordAppointmentPayment,
  type AppointmentPaymentKind,
} from "@babun/shared/db/repositories/appointment-payments";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useCurrentRole } from "@/features/settings/tenant";
import { appointmentsQueryKey } from "@/features/calendar/queries";
import { NEVER_PAUSE } from "@/features/finances/accounts";

// ДЕНЬГИ ПИШУТСЯ СРАЗУ ПО ТАПУ (владелец 2026-09-06: «без черновика — не
// нравится выполнять несколько действий»). Поэтому здесь не патч записи, а
// событие: сервер сам дописывает леджер, зеркала и проводку и возвращает
// свежую строку — её кладём в кэш списка, остальные денежные ключи
// перечитываем (те же, что у useUpdateAppointment при денежном патче).
//
// `requestId` придумывает ТАП, а не мутация: один и тот же id на все повторы
// одного нажатия делает запись идемпотентной на сервере.

const MONEY_QUERY_KEYS: readonly (readonly string[])[] = [
  ["appointments"],
  ["transactions"],
  ["clients"],
  ["accounts"],
  ["invoices"],
  ["receipts"],
];

function useSettleFreshAppointment() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  return (fresh: Appointment): void => {
    qc.setQueryData<Appointment[]>(appointmentsQueryKey(tenantId, role), (cur) =>
      cur?.map((a) => (a.id === fresh.id ? fresh : a)),
    );
    for (const key of MONEY_QUERY_KEYS) {
      qc.invalidateQueries({ queryKey: [...key] });
    }
  };
}

export interface RecordPaymentVars {
  appointmentId: string;
  accountId: string;
  /** Евро с копейками. */
  amount: number;
  requestId: string;
  kind?: AppointmentPaymentKind;
  closeVisit?: boolean;
}

export function useRecordPayment() {
  const settle = useSettleFreshAppointment();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (vars: RecordPaymentVars) =>
      recordAppointmentPayment(supabase, {
        appointmentId: vars.appointmentId,
        accountId: vars.accountId,
        amount: vars.amount,
        requestId: vars.requestId,
        kind: vars.kind,
        closeVisit: vars.closeVisit,
        paidAt: new Date().toISOString(),
      }),
    onSuccess: settle,
  });
}

export interface CancelPaymentVars {
  appointmentId: string;
  paymentId: string;
  requestId: string;
}

export function useCancelPayment() {
  const settle = useSettleFreshAppointment();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (vars: CancelPaymentVars) =>
      cancelAppointmentPayment(supabase, vars),
    onSuccess: settle,
  });
}
