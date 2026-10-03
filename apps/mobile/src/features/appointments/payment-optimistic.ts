import type { Appointment, Payment } from "@babun/shared/local/appointments";
import type { AccountKind } from "@babun/shared/local/finance/account";

// ОПЛАТА ВИДНА ПО ТАПУ, А НЕ ПО ОТВЕТУ СЕРВЕРА (владелец 2026-09-30: «когда
// нажимаю оплату на счёт — начинает тупить, с задержкой; должно всё
// мгновенно»). Плитка ждала `record_appointment_payment` целиком: до ответа
// все плитки гасли, и только потом одна становилась «оплачено». Теперь запись
// в кэше меняется сразу — ровно так, как её поменяет сервер (тело RPC,
// сверено 2026-09-30), — а ответ сервера лишь заменяет её канонической
// строкой. Отказ сервера возвращает прежнюю запись.

const cents = (euros: number): number => Math.round(euros * 100);

/** Способ оплаты по виду счёта — тем же `case`, что в RPC. */
export function methodForAccount(kind: AccountKind): Payment["method"] {
  if (kind === "cash") return "cash";
  if (kind === "card") return "card";
  if (kind === "bank") return "transfer";
  return "other";
}

export interface OptimisticPaymentInput {
  /** id платежа = id попытки (`requestId`), как пишет сервер. */
  requestId: string;
  amount: number;
  accountId: string;
  accountKind: AccountKind;
  kind: "prepayment" | "settlement";
  closeVisit: boolean;
  paidAt: string;
}

export function optimisticRecordPayment(
  apt: Appointment,
  input: OptimisticPaymentInput,
): Appointment {
  const method = methodForAccount(input.accountKind);
  const entry: Payment = {
    id: input.requestId,
    method,
    amount: input.amount,
    paid_at: input.paidAt,
    account_id: input.accountId,
  };
  if (input.kind === "prepayment") {
    const prepaid = (cents(apt.prepaid_amount) + cents(input.amount)) / 100;
    return {
      ...apt,
      prepaid_amount: prepaid,
      prepayments: [...(apt.prepayments ?? []), entry],
      payment_method: method as Appointment["payment_method"],
      payment_account_id: input.accountId,
      paid_amount: 0,
      payment_status: cents(prepaid) >= cents(apt.total_amount) ? "paid" : "unpaid",
    };
  }
  const oldPaid =
    apt.payment_status === "partial" || apt.payment_status === "paid" ? apt.paid_amount ?? 0 : 0;
  const outstanding = cents(apt.total_amount) - cents(apt.prepaid_amount) - cents(oldPaid);
  const paid = (cents(oldPaid) + cents(input.amount)) / 100;
  return {
    ...apt,
    payments: [...apt.payments, entry],
    // Зеркало веба сервер пересобирает из платежей; до ответа его заменяет
    // `paid_amount` (getPaidAmount берёт максимум из двух).
    payment: null,
    paid_amount: paid,
    payment_status: cents(input.amount) >= outstanding ? "paid" : "partial",
    payment_method: method as Appointment["payment_method"],
    payment_account_id: input.accountId,
    status:
      input.closeVisit && (apt.status === "scheduled" || apt.status === "in_progress")
        ? "completed"
        : apt.status,
  };
}

/** Снятие платежа — тот же принцип: строка платежа уходит сразу.
 *
 *  ЗЕРКАЛО `cancel_appointment_payment` СТРОКА В СТРОКУ (аудит 2026-10-03).
 *  Прежняя версия считала статус только по своей ветке: снятая предоплата
 *  при живой оплате давала «unpaid» (сервер — «partial»), а способ и счёт
 *  оплаты оставались от снятого платежа — плитка и общая строка «Предоплата»
 *  стояли не на том счёте, пока не придёт ответ. Сервер пересчитывает всё из
 *  ОСТАВШИХСЯ строк: «получено» = предоплата + сумма оплат, способ и счёт —
 *  у последней оставшейся оплаты, иначе у последней предоплаты. */
export function optimisticCancelPayment(apt: Appointment, paymentId: string): Appointment {
  const prepayments = apt.prepayments ?? [];
  const settled = apt.payments.find((p) => p.id === paymentId);
  const pre = settled ? undefined : prepayments.find((p) => p.id === paymentId);
  if (!settled && !pre) return apt;
  const payments = settled ? apt.payments.filter((p) => p.id !== paymentId) : apt.payments;
  const remainingPrepayments = pre
    ? prepayments.filter((p) => p.id !== paymentId)
    : prepayments;
  const prepaidCents = pre
    ? Math.max(0, cents(apt.prepaid_amount) - cents(pre.amount))
    : cents(apt.prepaid_amount);
  const paidCents = payments.reduce((sum, p) => sum + cents(p.amount), 0);
  const totalCents = cents(apt.total_amount);
  const last = payments.at(-1) ?? remainingPrepayments.at(-1) ?? null;
  return {
    ...apt,
    payments,
    prepayments: remainingPrepayments,
    // Зеркало веба сервер пересобирает из оставшихся оплат; до ответа его
    // заменяет `paid_amount` — как у приёма.
    payment: null,
    paid_amount: paidCents / 100,
    prepaid_amount: prepaidCents / 100,
    payment_status:
      totalCents > 0 && prepaidCents + paidCents >= totalCents
        ? "paid"
        : paidCents > 0
          ? "partial"
          : "unpaid",
    payment_method: last ? (last.method as Appointment["payment_method"]) : undefined,
    payment_account_id: last ? (last.account_id ?? null) : null,
  };
}
