import { useCallback } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import { useFeatureOn } from "@/features/settings/company-features";
import {
  useCalendarActionsReader,
  useEventRightsReader,
  useRecordBlocksReader,
} from "@/features/appointments/useRecordRights";
import {
  canMutateCalendarAppointment,
  isCalendarEvent,
} from "@/features/calendar/event-access";
import { usePlanAllows, useTenant } from "@/session/tenant";
import { useCalendarTariffs } from "@/session/calendar-tariffs";
import { tierAllows } from "@/session/tiers";
import { useTariffNudge } from "@/features/tariffs/use-tariff";
import { useMirror } from "@/session/mirror-state";
import type { CalendarSources } from "./use-calendar-sources";

type UseCalendarRightsDeps =
  Pick<CalendarSources, "role" | "session">;

/** Who may do what in the calendar: role, plan and per-calendar rights. */
export function useCalendarRights(deps: UseCalendarRightsDeps) {
  const { role, session } = deps;
  const isCrew = role === "master";
  const canManageBookings = role === "owner" || role === "dispatcher";
  const smsInPlan = usePlanAllows("sms");
  const workInPlan = usePlanAllows("book-clients");
  // ТАРИФ — У КАЛЕНДАРЯ ЗАПИСИ: у каждого календаря своя оплата, и запись
  // клиента в неоплаченном только для просмотра, даже если другой календарь
  // аккаунта оплачен. Тариф календаря ещё не пришёл — решает аккаунт.
  const calendarTariffs = useCalendarTariffs().data;
  const workInPlanFor = useCallback(
    (teamId: string | null | undefined) => {
      const row = teamId ? calendarTariffs?.get(teamId) : undefined;
      return row ? tierAllows(row.plan, "book-clients") : workInPlan;
    },
    [calendarTariffs, workInPlan],
  );
  const nudgeTariff = useTariffNudge();
  const companyName = useTenant().data?.name ?? null;
  // Метки дня — функция компании (STORY-088): выключены — тап по дате метку
  // не открывает, в сетке меток нет.
  const dayLabelsOn = useFeatureOn("day_labels");
  // ПРАВА СОТРУДНИКА ПО КАЛЕНДАРЮ (STORY-088): у мастера каждое действие
  // сетки — свой блок в календаре записи («Новые записи», «Переносить»,
  // «Отменять и удалять», «События», «Метка дня», «Цвет записи»). Владельцу и
  // диспетчеру читатель отдаёт всё — их ветки ниже не меняются.
  const actionsIn = useCalendarActionsReader();
  const eventRightsIn = useEventRightsReader();
  // ОПЛАТУ ЗАПИСИ СОТРУДНИК МОЖЕТ НЕ ВИДЕТЬ («Оплата: Скрыта»): сервер шлёт
  // нули, и сетка красила каждый прошедший визит «нет оплаты». Владельцу читатель отдаёт всё — у него всегда «видит».
  const recordRightsIn = useRecordBlocksReader();
  const paymentHiddenFor = useCallback(
    (a: Appointment) => recordRightsIn(a.team_id ?? null).payment === "hidden",
    [recordRightsIn],
  );
  // Сумма в повестке — по праву «Сумма» календаря записи, а не по роли.
  const amountVisible = useCallback(
    (a: Appointment) => recordRightsIn(a.team_id ?? null).amount !== "hidden",
    [recordRightsIn],
  );
  // ЧЬЁ СОБЫТИЕ — ГЛАЗАМИ ТОГО, КОГО ПОКАЗЫВАЕМ. В
  // зеркале «своё» сверялось с вошедшим владельцем: его события выглядели
  // доступными сотруднику для переноса и удаления, а события самого
  // сотрудника — нет.
  const mirror = useMirror();
  const actorId = mirror ? mirror.userId : session?.user.id;
  const canMutateAppointment = useCallback(
    (appointment: Appointment) =>
      canMutateCalendarAppointment(role, actorId, appointment),
    [role, actorId],
  );
  /** Можно ли двигать запись: пальцем, «Перенести», растяжкой. */
  const canMoveAppointment = useCallback(
    (appointment: Appointment) => {
      // Без тарифа запись клиента не двигается ни пальцем, ни растяжкой:
      // сервер её правку отклонит.
      if (!workInPlanFor(appointment.team_id) && !isCalendarEvent(appointment)) return false;
      if (!isCrew) return canMutateAppointment(appointment);
      const can = actionsIn(appointment.team_id ?? null);
      return isCalendarEvent(appointment)
        ? can.events === "write" && !!actorId && appointment.created_by === actorId
        : can.move;
    },
    [workInPlanFor, isCrew, canMutateAppointment, actionsIn, actorId],
  );

  return {
    isCrew, canManageBookings, smsInPlan, workInPlan, workInPlanFor, nudgeTariff, companyName,
    dayLabelsOn, actionsIn, eventRightsIn, paymentHiddenFor, amountVisible, mirror,
    actorId, canMutateAppointment, canMoveAppointment,
  };
}

export type CalendarRights = ReturnType<typeof useCalendarRights>;
