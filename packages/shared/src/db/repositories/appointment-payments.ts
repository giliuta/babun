// ДВЕРИ ДЕНЕГ ЗАПИСИ (STORY-066): одно событие «сумма → счёт» и его снятие.
//
// Клиент больше не собирает пять зеркал записи сам: сервер
// (`record_appointment_payment` / `cancel_appointment_payment`) пишет
// леджер, зеркала и проводку в одной транзакции и возвращает свежую строку
// записи. Оба вызова идемпотентны по `requestId` — повтор после обрыва сети
// возвращает то, что уже записано, а не дублирует деньги.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import type { Appointment } from "../../local/appointments";
import { rowToAppointment } from "./appointments";

type Row = Database["public"]["Tables"]["appointments"]["Row"];

export type AppointmentPaymentKind = "settlement" | "prepayment";

export interface RecordAppointmentPaymentInput {
  appointmentId: string;
  accountId: string;
  /** Евро с копейками (не центы) — как везде в `Appointment`. */
  amount: number;
  /** UUID, придуманный клиентом: становится id платежа в леджере. */
  requestId: string;
  kind?: AppointmentPaymentKind;
  /** Момент получения денег (ISO). Сервер кладёт проводку в этот день. */
  paidAt?: string;
  /** Закрыть визит («Выполнена») тем же событием. */
  closeVisit?: boolean;
}

export async function recordAppointmentPayment(
  supabase: SupabaseClient<Database>,
  input: RecordAppointmentPaymentInput,
): Promise<Appointment> {
  const { data, error } = await supabase.rpc("record_appointment_payment", {
    p_appointment_id: input.appointmentId,
    p_account_id: input.accountId,
    p_amount: input.amount,
    p_request_id: input.requestId,
    p_kind: input.kind ?? "settlement",
    p_paid_at: input.paidAt ?? new Date().toISOString(),
    p_close_visit: input.closeVisit ?? false,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Сервер не вернул запись после оплаты");
  return rowToAppointment(data as Row);
}

export interface CancelAppointmentPaymentInput {
  appointmentId: string;
  /** id платежа из `payments[]` / `prepayments[]`. */
  paymentId: string;
  /** UUID, придуманный клиентом: становится id сторно в финансах. */
  requestId: string;
}

export async function cancelAppointmentPayment(
  supabase: SupabaseClient<Database>,
  input: CancelAppointmentPaymentInput,
): Promise<Appointment> {
  const { data, error } = await supabase.rpc("cancel_appointment_payment", {
    p_appointment_id: input.appointmentId,
    p_payment_id: input.paymentId,
    p_request_id: input.requestId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Сервер не вернул запись после снятия оплаты");
  return rowToAppointment(data as Row);
}
