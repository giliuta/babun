// ДВЕРИ ДЕНЕГ ЗАПИСИ (STORY-066): одно событие «сумма → счёт» и его снятие.
//
// Клиент больше не собирает пять зеркал записи сам: сервер
// (`record_appointment_payment` / `cancel_appointment_payment`) пишет
// леджер, зеркала и проводку в одной транзакции и возвращает свежую строку
// записи. Оба вызова идемпотентны по `requestId` — повтор после обрыва сети
// возвращает то, что уже записано, а не дублирует деньги.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../database.types";
import type { Appointment } from "../../local/appointments";
import { rowToAppointment } from "./appointments";

type Row = Database["public"]["Tables"]["appointments"]["Row"];

export type AppointmentPaymentKind = "settlement" | "prepayment";

interface RecordAppointmentPaymentInput {
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
    // Часы телефона В МОМЕНТ ОТПРАВКИ, а не оплаты: очередь мастера шлёт
    // платёж позже, и время оплаты у неё прежнее. Разница с часами сервера —
    // сбой часов телефона, сервер на неё сдвигает время оплаты.
    p_sent_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Сервер не вернул запись после оплаты");
  return rowToAppointment(data as Row);
}

interface CancelAppointmentPaymentInput {
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

interface RefundOverpaymentAndSaveInput {
  appointmentId: string;
  /** Сколько вернуть клиенту — евро с копейками. */
  amount: number;
  /** UUID, придуманный клиентом: становится id первой строки возврата. */
  requestId: string;
  /** Сохранение записи: у мастера — тело его двери (`memberPatch`), у
   *  владельца и диспетчера — колонки базы (`appointmentToUpdate`). */
  patch: Json;
  /** `updated_at` записи, по которой посчитан возврат: изменилась — отказ
   *  до возврата (у мастера сервер его не сверяет). */
  expectedUpdatedAt?: string | null;
}

/** ВЕРНУТЬ КЛИЕНТУ ПЕРЕПЛАТУ И СОХРАНИТЬ НОВЫЙ ИТОГ — ОДНОЙ ТРАНЗАКЦИЕЙ.
 *  Итог стал меньше полученного: сервер (`refund_overpayment_and_save`)
 *  пишет возвраты «Возврат клиенту» от последнего платежа к первому и тут же
 *  сохраняет запись. Отказ сохранения откатывает и возврат — денег назад без
 *  нового итога не бывает. Ответ — строка записи у владельца и диспетчера,
 *  `null` у мастера (его дверь возвращает только номер). */
export async function refundOverpaymentAndSave(
  supabase: SupabaseClient<Database>,
  input: RefundOverpaymentAndSaveInput,
): Promise<Appointment | null> {
  const { data, error } = await supabase.rpc("refund_overpayment_and_save", {
    p_appointment_id: input.appointmentId,
    p_amount: input.amount,
    p_request_id: input.requestId,
    p_patch: input.patch,
    ...(input.expectedUpdatedAt ? { p_expected_updated_at: input.expectedUpdatedAt } : {}),
  });
  if (error) throw new Error(error.message);
  const row = data as Row | null;
  return row && typeof row === "object" && "tenant_id" in row ? rowToAppointment(row) : null;
}
