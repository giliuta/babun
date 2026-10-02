import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount, getPaidAmount } from "@babun/shared/local/appointments";
import { appointmentDebt } from "@babun/shared/local/selectors/client-stats";
import { formatEUR } from "@babun/shared/common/utils/money";

// СОСТОЯНИЕ ЗАПИСИ В ИСТОРИИ — ОДНИМ СЛОВОМ СПРАВА (владелец 03.10: «дата,
// команда, услуги не пишем; справа — оплачено, ожидается, если он уже
// записан, или долг висит»).
//
// Долг — тем же правилом, что «Долг» в сводке клиента (`appointmentDebt`):
// выполненная с недоплатой и прошедшая, по которой не отчитались. Будущая
// запись долгом не бывает — она «Ожидается». Без права «Долг и деньги»
// сумм нет: остаются слова о самой работе.

export type VisitStatusKind =
  | "cancelled"
  | "refunded"
  | "debt"
  | "ahead"
  | "paid"
  | "done"
  | "unclosed";

export interface VisitStatus {
  kind: VisitStatusKind;
  text: string;
}

export function visitStatus(
  a: Appointment,
  today: string,
  showMoney: boolean,
): VisitStatus {
  if (a.status === "cancelled") return { kind: "cancelled", text: "Отменена" };
  if (a.payment_status === "refunded") return { kind: "refunded", text: "Возврат" };
  const owed = appointmentDebt(a, today);
  if (owed > 0) {
    return showMoney
      ? { kind: "debt", text: `Долг ${formatEUR(owed)}` }
      : a.status === "completed"
        ? { kind: "done", text: "Выполнена" }
        : { kind: "unclosed", text: "Не закрыта" };
  }
  if (a.status !== "completed") {
    return a.date >= today
      ? { kind: "ahead", text: "Ожидается" }
      : { kind: "unclosed", text: "Не закрыта" };
  }
  const total = a.total_amount ?? 0;
  if (showMoney && total > 0 && getDebtAmount(a) <= 0 && getPaidAmount(a) > 0) {
    return { kind: "paid", text: "Оплачено" };
  }
  return { kind: "done", text: "Выполнена" };
}
