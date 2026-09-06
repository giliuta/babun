// ЧИСТАЯ ЛОГИКА БЛОКА «ОПЛАТА» (STORY-065). Ни сети, ни React: правило
// начала визита, остаток, проверка суммы и строки уже полученных денег —
// всё, что можно доказать тестом, живёт здесь, а не в JSX.

import type { Appointment, Payment } from "@babun/shared/local/appointments";
import { getPaidAmount } from "@babun/shared/local/appointments";
import { appointmentDebtCents } from "@babun/shared/local/finance/appointment-calc";
import { parseMoneyInputToCents } from "@babun/shared/common/utils/money";

export type PaymentKind = "settlement" | "prepayment";

/** «Сейчас» в рабочем поясе компании — в тех же строках, что хранит запись. */
export interface BusinessNow {
  /** YYYY-MM-DD */
  ymd: string;
  /** HH:MM */
  hm: string;
}

/**
 * Визит начался — тап по счёту значит «деньги получены», визит закрывается.
 * До начала любые деньги — только предоплата или инвойс (владелец
 * 2026-09-06: «любые деньги до визита — предоплата»). Граница — время
 * НАЧАЛА: бригадир закрывает визит и раньше конца.
 */
export function visitStarted(
  apt: Pick<Appointment, "date" | "time_start">,
  now: BusinessNow,
): boolean {
  if (apt.date < now.ymd) return true;
  if (apt.date > now.ymd) return false;
  return apt.time_start <= now.hm;
}

/** Остаток по записи в центах — тем же счётом, что «Должники». */
export function outstandingCents(apt: Appointment): number {
  return appointmentDebtCents(
    apt.total_amount,
    getPaidAmount(apt),
    apt.payment_status,
  );
}

/** Сумма из поля ввода — в центах; 0, если это не число. */
export function amountCentsFromInput(text: string): number {
  const parsed: unknown = parseMoneyInputToCents(text);
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed)
    : 0;
}

export type AmountProblem = "empty" | "exceeds";

/** Почему сумму нельзя записать; null — можно. */
export function amountProblem(
  cents: number,
  outstanding: number,
): AmountProblem | null {
  if (!Number.isFinite(cents) || cents <= 0) return "empty";
  if (cents > outstanding) return "exceeds";
  return null;
}

/** Строка полученных денег в блоке. */
export interface PaymentRow {
  /** id платежа в леджере либо служебный id общей строки. */
  id: string;
  kind: PaymentKind;
  /** Евро с копейками. */
  amount: number;
  accountId: string | null;
  /** ISO; пустая строка — момент неизвестен (общая строка). */
  paidAt: string;
  /** Можно ли снять именно эту строку. Общие строки старых путей — нельзя:
   *  у них нет платежа, на который сервер напишет сторно. */
  cancellable: boolean;
}

const cents = (euros: number): number => Math.round(euros * 100);

function prepaymentRows(apt: Appointment): PaymentRow[] {
  if (apt.prepaid_amount <= 0) return [];
  const itemized: Payment[] = apt.prepayments ?? [];
  const itemizedTotal = itemized.reduce((sum, p) => sum + p.amount, 0);
  if (itemized.length > 0 && cents(itemizedTotal) === cents(apt.prepaid_amount)) {
    return itemized.map((p) => ({
      id: p.id,
      kind: "prepayment",
      amount: p.amount,
      accountId: p.account_id ?? null,
      paidAt: p.paid_at,
      cancellable: true,
    }));
  }
  // Предоплата старого пути: суммы строк нет или она не сходится — одна
  // общая строка. Счёт известен, только пока после неё ничего не платили:
  // колонка-курьер уже могла уехать за следующим платежом.
  return [
    {
      id: "prepaid-total",
      kind: "prepayment",
      amount: apt.prepaid_amount,
      accountId: apt.payments.length === 0 ? (apt.payment_account_id ?? null) : null,
      paidAt: "",
      cancellable: false,
    },
  ];
}

function settlementRows(apt: Appointment): PaymentRow[] {
  if (apt.payment_status === "refunded") return [];
  if (apt.payments.length > 0) {
    return apt.payments.map((p) => ({
      id: p.id,
      kind: "settlement",
      amount: p.amount,
      accountId: p.account_id ?? null,
      paidAt: p.paid_at,
      cancellable: true,
    }));
  }
  // Деньги веб-зеркала без леджера (payment-объект / paid_amount) —
  // одна общая строка, снять её можно только старыми действиями.
  const mirror = apt.payment
    ? apt.payment.cashAmount + apt.payment.cardAmount
    : (apt.payment_status ?? "unpaid") !== "unpaid"
      ? (apt.paid_amount ?? 0)
      : 0;
  if (mirror <= 0) return [];
  return [
    {
      id: "settled-total",
      kind: "settlement",
      amount: mirror,
      accountId: apt.payment_account_id ?? null,
      paidAt: apt.payment?.paid_at ?? "",
      cancellable: false,
    },
  ];
}

/** Все полученные деньги записи: сначала предоплаты, потом оплаты. */
export function paymentRows(apt: Appointment): PaymentRow[] {
  return [...prepaymentRows(apt), ...settlementRows(apt)];
}

/**
 * Закрывать ли визит этим платежом: оплата после начала визита закрывает
 * его, даже частичная — работа сделана, остаток становится долгом.
 */
export function closesVisit(
  apt: Pick<Appointment, "date" | "time_start" | "status">,
  kind: PaymentKind,
  now: BusinessNow,
): boolean {
  if (kind !== "settlement") return false;
  if (apt.status === "completed" || apt.status === "cancelled") return false;
  return visitStarted(apt, now);
}
