import {
  getPaidAmount,
  type Appointment,
  type PaymentMethod,
} from "@babun/shared/local/appointments";

// СТРОКА ЗНАЧКОВ ВНИЗУ БЛОКА (владелец 15.10: «внизу иконочки — отправили
// SMS, оплатили или не оплатили… без суммы в евро»). Блок говорит, что у
// записи уже есть, а чего нет, не открывая её. Порядок значков постоянный —
// глаз привыкает к местам и читает пропуски, не вчитываясь.
//
// Отдельного значка «нет объекта» нет: эту дыру уже говорит цвет всего блока
// (`record-color`, ситуация «Нет объекта»).

/** Деньги записи для значка. `null` — платить нечего: событие, отмена,
 *  возврат или запись без суммы. */
export type BlockMoney = {
  state: "paid" | "partial" | "unpaid";
  /** Каким способом пришли деньги — последний платёж. `null` — ещё не
   *  платили или способ неизвестен. */
  method: "cash" | "card" | "transfer" | "other" | null;
} | null;

export function blockMoney(apt: Appointment): BlockMoney {
  if (apt.kind !== "work") return null;
  if (apt.status === "cancelled" || apt.payment_status === "refunded") return null;
  const total = apt.total_amount ?? 0;
  if (!(total > 0)) return null;
  // Те же деньги, что видят «Финансы» и долги: аванс + платежи, до цента.
  const paid = getPaidAmount(apt);
  const state = paid >= total ? "paid" : paid > 0 ? "partial" : "unpaid";
  return { state, method: state === "unpaid" ? null : paymentMethodOf(apt) };
}

function paymentMethodOf(apt: Appointment): Exclude<NonNullable<BlockMoney>["method"], undefined> {
  const last = apt.payments.length > 0 ? apt.payments[apt.payments.length - 1].method : undefined;
  const raw: PaymentMethod | undefined =
    last ?? apt.payment_method ?? (apt.payment ? (apt.payment.cashAmount > 0 ? "cash" : "card") : undefined);
  switch (raw) {
    case "cash":
    case "card":
    case "transfer":
      return raw;
    case undefined:
      return null;
    // Раздельный платёж и счёт-инвойс — «другое»: их значок не скажет, где
    // лежат деньги, а соврать способом хуже, чем промолчать.
    default:
      return "other";
  }
}
