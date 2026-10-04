import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount, getPaidAmount } from "@babun/shared/local/appointments";
import { appointmentDebt } from "@babun/shared/local/selectors/client-stats";
import { formatEUR } from "@babun/shared/common/utils/money";

// СОСТОЯНИЕ ЗАПИСИ В ИСТОРИИ — ОДНИМ СЛОВОМ СПРАВА (владелец 03.10: «дата,
// команда, услуги не пишем; справа — оплачено, ожидается, если он уже
// записан, или долг висит»).

export type VisitStatusKind =
  | "cancelled"
  | "refunded"
  | "debt"
  | "ahead"
  | "paid"
  | "past"
  | "nosum";

export interface VisitStatus {
  kind: VisitStatusKind;
  /** Число справа; пусто — денег не показываем. */
  text: string;
  /** Состояние словами — для озвучки. */
  label: string;
}

// ТОЛЬКО ЧИСЛО ПРАВИЛЬНЫМ ЦВЕТОМ (владелец 03.10: «как можно поставить
// статус „выполнено“, если его у нас нет?», затем — «уберём слова „долг“,
// „оплачено“, „ожидается“, просто цифры правильным цветом, своим
// столбиком»). Отметки «выполнена» у владельца нет — запись закрывает оплата.
// `text` — число справа, `kind` — его цвет:
//   · paid    — сумма записи, зелёным: получено целиком;
//   · debt    — сколько не получено, янтарём (правилом сводки, `appointmentDebt`);
//   · ahead   — сумма записи впереди, кобальтом;
//   · nosum   — «€0» тихо: у записи нет цены;
//   · past    — без права «Долг и деньги» денег нет, число пустое;
//   · cancelled / refunded — сумма тихо, отменённая зачёркнута на экране.
// `label` — то же словами, только для озвучки VoiceOver.
export function visitStatus(
  a: Appointment,
  today: string,
  showMoney: boolean,
): VisitStatus {
  const total = a.total_amount ?? 0;
  const money = (n: number) => formatEUR(n);
  if (a.status === "cancelled") {
    return { kind: "cancelled", text: showMoney && total > 0 ? money(total) : "", label: "отменена" };
  }
  if (a.payment_status === "refunded") {
    return { kind: "refunded", text: showMoney && total > 0 ? money(total) : "", label: "возврат" };
  }
  const ahead = a.date >= today && a.status !== "completed";
  if (!showMoney) {
    return ahead ? { kind: "ahead", text: "", label: "впереди" } : { kind: "past", text: "", label: "прошла" };
  }
  const owed = appointmentDebt(a, today);
  if (owed > 0) return { kind: "debt", text: money(owed), label: `долг ${money(owed)}` };
  if (total > 0 && getDebtAmount(a) <= 0 && getPaidAmount(a) > 0) {
    return { kind: "paid", text: money(total), label: `оплачено ${money(total)}` };
  }
  if (ahead) return { kind: "ahead", text: total > 0 ? money(total) : "", label: total > 0 ? `ожидается ${money(total)}` : "впереди" };
  return { kind: "nosum", text: money(0), label: "без суммы" };
}
