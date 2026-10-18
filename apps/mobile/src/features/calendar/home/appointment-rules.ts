import type { Appointment } from "@babun/shared/local/appointments";
import { isCalendarEvent } from "@/features/calendar/event-access";

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

/** У записи есть полученные деньги, которые отмена вернёт клиенту, — то же
 *  условие, по которому сервер при отмене ставит «возврат»
 *  (`protect_paid_appointment_finance`). Уже возвращённая — не в счёт. */
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
