// Appointments data layer.
//
// Форма записи и правила чтения денег по ней. Хранит записи Supabase
// (db/repositories/appointments.ts) — здесь только shape и селекторы.

import type {
  Appointment,
  AppointmentStatus,
} from "./appointments/types";

export type {
  Appointment,
  AppointmentExpense,
  AppointmentKind,
  AppointmentPayment,
  AppointmentPhoto,
  AppointmentService,
  AppointmentSource,
  AppointmentStatus,
  Discount,
  Payment,
  PaymentMethod,
  PersonalEventRepeat,
  PhotoKind,
} from "./appointments/types";
export {
  createBlankAppointment,
  CUSTOM_SERVICE_PREFIX,
  duplicateAppointment,
  isCustomServiceId,
  newCustomServiceId,
} from "./appointments/factories";

/** Статус СЛОВОМ — только отмена (статуса в продукте нет).
 *  «Запланирована / В работе / Выполнена» нигде
 *  не печатаются; внутри «выполнена» остаётся закрытием визита оплатой — по
 *  нему считаются долги и аналитика. */
export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: "",
  in_progress: "",
  completed: "",
  cancelled: "Отменена",
};

// ─── Computed helpers ──────────────────────────────────────────────────

export function getPaidAmount(apt: Appointment): number {
  // A full refund is a terminal economic state for the appointment read
  // model. Historical receipt mirrors deliberately stay on the row for the
  // audit trail, but they must not be resurrected as current revenue.
  if (apt.payment_status === "refunded") return 0;

  // Получено СВЕРХ аванса считается по двум источникам и берётся максимум:
  // леджер payments[] (мобильные пути: buildDebtPaidPatch) и
  // веб-зеркала — payment-объект (нал+карта) либо колонка paid_amount
  // (actualPaid, web appointment-builders) — оба БЕЗ аванса. Именно max,
  // а не «леджер вытесняет зеркала»: у смешанных строк первый мобильный
  // платёж ложится в леджер поверх зеркальной истории веба, и приоритет
  // леджера «воскрешал» уже погашенный долг. paid_amount при
  // payment_status 'unpaid' игнорируем: бэкфилл миграции 20260517000001
  // записал туда prepaid_amount всех старых строк — чтение задваивало бы
  // аванс (prepaid_amount прибавляется отдельно строкой ниже).
  const ledger = apt.payments.reduce((sum, p) => sum + p.amount, 0);
  const mirror = apt.payment
    ? apt.payment.cashAmount + apt.payment.cardAmount
    : (apt.payment_status ?? "unpaid") !== "unpaid"
      ? apt.paid_amount ?? 0
      : 0;
  return cents(apt.prepaid_amount + Math.max(ledger, mirror));
}

/** До цента. Аванс 4,76 + платёж 7,14 во float — 11.899999…, и долг
 *  оплаченной записи выходил 1.8e-15: строка «€0» в «Долгах», в долгах дня и
 *  у клиента. Деньги в продукте живут в центах. */
function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getDebtAmount(apt: Appointment): number {
  // Refunding a completed visit does not silently reopen customer debt. The
  // visit remains in history with the explicit «Возврат» status; collecting
  // it again requires a new payment lifecycle, not a derived balance.
  if (apt.payment_status === "refunded") return 0;
  return Math.max(0, cents(apt.total_amount - getPaidAmount(apt)));
}

export function isFullyPaid(apt: Appointment): boolean {
  return getPaidAmount(apt) >= apt.total_amount && apt.total_amount > 0;
}

/**
 * Revenue recognized by operational KPI screens. Those screens historically
 * value every completed job at its agreed total (even when collection is
 * still pending), which is intentionally different from getPaidAmount(). A
 * fully refunded job remains completed work in visit counters but contributes
 * zero to revenue and leaderboards.
 */
export function getRecognizedRevenue(apt: Appointment): number {
  if (apt.status !== "completed" || apt.payment_status === "refunded") return 0;
  return Math.max(0, apt.total_amount ?? 0);
}
