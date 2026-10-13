import { useEffect, useMemo, useRef } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import {
  reconcileAutoReminders,
  reconcileEventAppointmentReminders,
  reconcileSelfReminders,
} from "@/features/calendar/reminders";
import {
  useTeamNotifyPrefs,
  useTeamNotifyVersion,
} from "@/lib/notification-prefs-store";
import { reminderSignature } from "./grouping";
import type { CalendarRoute } from "./use-calendar-route";
import type { CalendarSources } from "./use-calendar-sources";

type UseReminderReconcileDeps =
  Pick<CalendarSources, "appts" | "appointmentsQuery" | "isLoading" | "error" | "teamsLoading"
    | "teamsError" | "calSettingsQuery" | "teams" | "calSettings">
  & Pick<CalendarRoute, "tenantId">;

/** Keeps the phone's local pushes in line with the records: event
 *  reminders, self reminders and the per-team automatic ones. */
export function useReminderReconcile(deps: UseReminderReconcileDeps) {
  const {
    appts, appointmentsQuery, isLoading, error, teamsLoading, teamsError,
    calSettingsQuery, teams, calSettings, tenantId,
  } = deps;
  // ПОДПИСЬ ДЛЯ СВЕРКИ НАПОМИНАНИЙ: только то, от чего зависит момент пуша.
  // Эффект звал нативные уведомления на КАЖДУЮ новую ссылку списка — в том
  // числе на каждый шаг переноса; теперь — когда реально сменились дата,
  // время или статус, и не чаще раза в секунду.
  const reminderSig = useMemo(() => reminderSignature(appts), [appts]);
  // Правило «О записях» — у каждой команды (Кабинет → Уведомления, 03.10):
  // календарь держит копию настроек свежей, а правка любой команды
  // пересобирает группу `auto:` сразу, без правки в календаре.
  useTeamNotifyPrefs();
  const autoRuleSig = useTeamNotifyVersion();
  const apptsRef = useRef(appts);
  /** Имя клиента записи для сверки пушей «себе» — функция объявлена ниже. */
  const clientNameRef = useRef<(a: Appointment) => string>(() => "");
  apptsRef.current = appts;
  useEffect(() => {
    if (
      // Записи РЕАЛЬНО пришли: без сети запрос стоит на паузе, а у
      // выключенного isLoading ложно — пустой список сверка принимала за
      // «записей нет» и стирала все пуши (проверка системы 03.10).
      !appointmentsQuery.isSuccess ||
      isLoading ||
      error ||
      teamsLoading ||
      teamsError ||
      calSettingsQuery.isLoading ||
      calSettingsQuery.isError
    ) {
      return;
    }
    const teamTimezones = new Map(
      teams.map((team) => [team.id, team.timezone] as const),
    );
    const tzFor = (appointment: Appointment) =>
      (appointment.team_id ? teamTimezones.get(appointment.team_id) : null) ??
      calSettings?.timezone ??
      "Europe/Nicosia";
    const timer = setTimeout(() => {
      const list = apptsRef.current;
      void reconcileEventAppointmentReminders(list, tzFor).catch(() => {});
      // Пуши «себе» (колокольчик) пересчитываются от свежих дат: перенесли
      // запись — напоминание переехало, отменили — снято.
      // С ИМЕНЕМ КЛИЕНТА (аудит 2026-10-03): «Напомнить» ставится с именем,
      // а сверка без третьего аргумента пересобирала тот же пуш без него —
      // через секунду после любой правки в календаре имя из пуша пропадало.
      void reconcileSelfReminders(
        list,
        tzFor,
        (a) => clientNameRef.current(a) || undefined,
      ).catch(() => {});
      // Напоминание о каждой записи — по правилу телефона; у записи с
      // колокольчиком звонит колокольчик.
      if (tenantId) {
        void reconcileAutoReminders(
          list,
          tzFor,
          (a) => clientNameRef.current(a) || undefined,
          tenantId,
        ).catch(() => {});
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [
    appointmentsQuery.isSuccess,
    tenantId,
    reminderSig,
    autoRuleSig,
    calSettings?.timezone,
    calSettingsQuery.isError,
    calSettingsQuery.isLoading,
    error,
    isLoading,
    teams,
    teamsError,
    teamsLoading,
  ]);

  return {
    clientNameRef,
  };
}

export type ReminderReconcile = ReturnType<typeof useReminderReconcile>;
