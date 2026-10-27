import type { Appointment } from "@babun/shared/local/appointments";
import { isCalendarEvent } from "@/features/calendar/event-access";
import {
  servicesBlockTeamMove,
  type BookingServiceRef,
} from "@/features/appointments/booking-selection";

/** «Личное» событие — без команды: оно видно в любом календаре, и перенос
 *  или копия по кубику выбранной команды не превращают его в событие этой
 *  команды (иначе «Стоматолог» становился виден партнёрам). */
export function isPersonalEvent(apt: Appointment): boolean {
  return apt.team_id == null && apt.kind !== "work";
}

/** Визит с доплатой или закрытый оплаченным: сервер не меняет ему ни день, ни
 *  команду — «Сначала отмените оплату или оформите возврат по заявке»
 *  (`protect_paid_appointment_finance`). Время внутри дня — можно. */
export function settledVisit(apt: Appointment): boolean {
  if (isCalendarEvent(apt) || apt.payment_status === "refunded") return false;
  return (
    (apt.paid_amount ?? 0) > 0 ||
    apt.payments.length > 0 ||
    (apt.status === "completed" && apt.payment_status === "paid")
  );
}
export const SETTLED_STAYS = "Оплаченная запись переносится только внутри своего дня";

/** Перенос или копия в другую команду с услугами прайса своей команды
 *  (`servicesBlockTeamMove`). */
export const SERVICES_HOLD_TEAM =
  "Услуги записи — из прайса её команды. Команду меняют на странице записи";

/** Команда, в которую встанет запись по кубику: сотрудник и личное событие
 *  команду не меняют, остальные встают в выбранный чип. */
export function placementTeam(
  apt: Appointment,
  activeTeamId: string | null,
  isCrew: boolean,
): string | null {
  return isCrew || isPersonalEvent(apt) ? apt.team_id : (activeTeamId ?? apt.team_id);
}

/** Почему запись не встанет в кубик даты `dateYmd` команды `toTeam`, или
 *  `null`. Один ответ на тап по кубику и на саму зелень: кубик, который горит,
 *  а по тапу отказывает, обещает то, чего нет. */
export function placementRefusal(
  apt: Appointment,
  kind: "move" | "copy",
  dateYmd: string,
  toTeam: string | null,
  services: readonly BookingServiceRef[],
): string | null {
  const teamChanges = toTeam !== apt.team_id;
  if (kind === "move" && (teamChanges || dateYmd !== apt.date) && settledVisit(apt)) {
    return SETTLED_STAYS;
  }
  if (
    teamChanges &&
    !isCalendarEvent(apt) &&
    servicesBlockTeamMove(apt.service_ids ?? [], services, toTeam)
  ) {
    return SERVICES_HOLD_TEAM;
  }
  return null;
}

/** У записи есть полученные деньги, которые отмена вернёт клиенту, — то же
 *  условие, по которому сервер при отмене ставит «возврат»
 *  (`protect_paid_appointment_finance`). Уже возвращённая — не в счёт. */
/** ЗАПИСЬ С ДЕНЬГАМИ НЕ УДАЛЯЕТСЯ — то же правило, что сторож сервера
 *  `guard_appointment_history_delete`: любой статус оплаты, кроме «не
 *  оплачена» (и возврат тоже), суммы, платежи, способ оплаты или инвойс по
 *  записи. Экран проверял уже: запись только с инвойсом или способом оплаты
 *  проходила вопрос «Удалить?» и падала ошибкой сервера. Такой записи пункт
 *  «Удалить» не предлагается вовсе. */
export function keptForMoneyHistory(apt: Appointment, hasInvoice: boolean): boolean {
  return (
    (apt.payment_status ?? "unpaid") !== "unpaid" ||
    (apt.paid_amount ?? 0) > 0 ||
    apt.prepaid_amount > 0 ||
    apt.payments.length > 0 ||
    apt.payment != null ||
    apt.payment_method != null ||
    hasInvoice
  );
}

export function holdsMoney(apt: Appointment): boolean {
  if (isCalendarEvent(apt) || apt.payment_status === "refunded") return false;
  return (
    apt.prepaid_amount > 0 ||
    (apt.paid_amount ?? 0) > 0 ||
    apt.payment_status === "partial" ||
    apt.payment_status === "paid" ||
    apt.payments.length > 0
  );
}
