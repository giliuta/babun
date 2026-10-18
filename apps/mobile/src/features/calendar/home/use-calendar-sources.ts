import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/Toast";
import { useTenantId } from "@/lib/tenant";
import { usePullRefresh } from "@/lib/pull-refresh";
import { useSilentRevalidating } from "@/lib/switch-revalidate";
import { useThemeColors } from "@/theme/colors";
import { useAppointments } from "@/features/calendar/queries";
import { useQuietUpdateAppointment } from "@/features/calendar/mutations";
import { useClients } from "@/features/clients/queries";
import { useServices } from "@/features/services/queries";
import { useCalendarVisibility } from "@/session/workspaces";
import { useTeams } from "@/features/reference/queries";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useCurrentRole } from "@/session/tenant";
import { useMyAccess } from "@/session/access-queries";
import { useSession } from "@/providers/SessionProvider";
import { clientKeys } from "@/lib/client-query-keys";
import { referenceKeys } from "@/features/reference/query-keys";

/** Data the calendar screen reads: records, clients, services, calendars,
 *  settings, role and access, plus the pull-to-refresh wiring. */
export function useCalendarSources() {
  const appointmentsQuery = useAppointments();
  const {
    data: appts = [],
    isLoading,
    isRefetching,
    error,
  } = appointmentsQuery;
  const qc = useQueryClient();
  const clientsQuery = useClients();
  const servicesQuery = useServices();
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);
  const {
    data: teamsAll = [],
    isLoading: teamsLoading,
    isPending: teamsPending,
    isFetching: teamsFetching,
    isError: teamsError,
    isLoadingError: teamsLoadError,
    error: teamsQueryError,
    refetch: refetchTeams,
  } = useTeams();
  // СКРЫТЫЕ КАЛЕНДАРИ: скрытого своего в ленте и в выборе
  // нет. Скрыты все свои — экран уходит в календарь другого аккаунта (ниже):
  // скрыть последний видимый правило не даёт.
  const calendarVisibility = useCalendarVisibility();
  const { isHidden } = calendarVisibility;
  const visibilityTenantId = useTenantId();
  const teams = useMemo(
    () => teamsAll.filter((tm) => !isHidden(visibilityTenantId, tm.id)),
    [teamsAll, isHidden, visibilityTenantId],
  );
  const ownAllHidden = teamsAll.length > 0 && teams.length === 0;
  // УДАЛЁННЫХ КАЛЕНДАРЕЙ В ЛЕНТЕ НЕТ — НИ ЗДЕСЬ, НИ В «ФИНАНСАХ».
  //
  // Отдельный список `useTeams({ includeInactive: true })` оставил бы удалённую
  // команду чипом, пока за ней числятся записи. Чип НИЧЕМ не отличался бы от
  // живого, «Финансы» его не показывали бы вовсе, а создание записи из такого
  // календаря молча уходило бы в первый живой. Потерю работы с сетки закрывает
  // вопрос удаления — он называет цифрой работу, которая слетит
  // (`calendar-delete.ts`).
  const calSettingsQuery = useCalendarSettings();
  const calSettings = calSettingsQuery.data;
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  const myAccessQuery = useMyAccess();
  const { session } = useSession();
  // «Первый день недели» — общая настройка; правит Неделю, Месяц и мини-
  // календарь одинаково (до этого понедельник был зашит в каждом из трёх).
  // Без подписки на состояние мутации: экран её не читает, а каждый шаг
  // (ожидание → успех) перерисовывал бы весь календарь на переносе.
  const updateAppt = useQuietUpdateAppointment();
  const toast = useToast();
  const t = useThemeColors();

  // Pull-to-refresh (agenda list). Invalidates the shared ['appointments']
  // key so the query refetches from the repo; the per-client appointment
  // hooks share that key and refresh in lockstep. The promise is returned
  // so RefreshControl keeps spinning until the refetch actually settles —
  // a fire-and-forget invalidate dropped the spinner on a warm cache
  // before fresh data arrived.
  const onRefresh = useCallback(
    () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["appointments"] }),
        qc.invalidateQueries({ queryKey: clientKeys.all() }),
        qc.invalidateQueries({ queryKey: ["services"] }),
        qc.invalidateQueries({ queryKey: referenceKeys.teamAll() }),
        qc.invalidateQueries({ queryKey: ["calendar-settings"] }),
        qc.invalidateQueries({ queryKey: ["team-schedules"] }),
        qc.invalidateQueries({ queryKey: referenceKeys.cityAll() }),
        qc.invalidateQueries({ queryKey: ["day-cities"] }),
      ]),
    [qc],
  );
  // Контрол ленты отражает ЖЕСТ: раньше он питался от isRefetching, то есть
  // выезжал сам при каждом возврате на календарь.
  const pull = usePullRefresh(onRefresh);
  // Тихая очередь — подпиской, а не чтением модуля: конец очереди обязан
  // перерисовать экран, иначе начатое в ней настоящее перечитывание
  // осталось бы без полосы.
  const silentRevalidating = useSilentRevalidating();

  return {
    appointmentsQuery, appts, isLoading, isRefetching, error, clientsQuery,
    servicesQuery, clients, teamsAll, teamsLoading, teamsPending, teamsFetching,
    teamsError, teamsLoadError, teamsQueryError, refetchTeams, calendarVisibility,
    visibilityTenantId, teams, ownAllHidden, calSettingsQuery, calSettings, roleQuery,
    role, myAccessQuery, session, updateAppt, toast, t,
    onRefresh, pull, silentRevalidating,
  };
}

export type CalendarSources = ReturnType<typeof useCalendarSources>;
