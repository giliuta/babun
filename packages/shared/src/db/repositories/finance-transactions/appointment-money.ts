// Appointment payment RPCs: the appointment and its ledger commit atomically.

import { rpcArgs } from "../../rpc-args";
import type { PaymentMethod } from "../../../local/finance/transaction";
import type { DbSupabase } from "./shared";

/**
 * Permanently reset every outstanding receipt for an appointment. The server
 * appends linked refunds for prepayment and settlement events, clears the
 * payment mirrors and reopens appointment/invoice debt in one transaction.
 */
export async function resetAppointmentPayment(
  supabase: DbSupabase,
  appointmentId: string,
): Promise<void> {
  const { error } = await supabase.rpc("reset_appointment_payment", {
    p_appointment_id: appointmentId,
  });
  if (error) throw new Error(error.message || "Не удалось отменить оплату");
}

/**
 * Set the absolute prepayment before settlement. Reducing it creates linked
 * refund events; changing its tender refunds the old account and records a
 * fresh receipt on the matching account. This must never enter the offline
 * queue because the appointment and ledger commit atomically on the server.
 */
export async function setAppointmentPrepayment(
  supabase: DbSupabase,
  appointmentId: string,
  amount: number,
  paymentMethod: PaymentMethod | null,
): Promise<void> {
  const { error } = await supabase.rpc(
    "set_appointment_prepayment",
    rpcArgs<"set_appointment_prepayment">({
      p_appointment_id: appointmentId,
      p_amount: amount,
      p_payment_method: paymentMethod,
    }),
  );
  if (error) {
    throw new Error(error.message || "Не удалось изменить предоплату");
  }
}
