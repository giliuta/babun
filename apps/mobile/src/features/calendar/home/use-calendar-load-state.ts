import { useEffect } from "react";
import { ColdOfflineCacheMissError } from "@babun/shared/sync";
import { markBootReady } from "@/features/boot/BootSplash";
import type { CalendarGrid } from "./use-calendar-grid";
import type { CalendarSources } from "./use-calendar-sources";
import type { RecordColors } from "./use-record-colors";

type UseCalendarLoadStateDeps =
  Pick<CalendarSources, "calendarVisibility" | "isLoading" | "clientsQuery" | "servicesQuery"
    | "calSettingsQuery" | "appointmentsQuery" | "teamsLoadError" | "teamsQueryError">
  & Pick<RecordColors, "citiesQuery" | "dayCitiesQuery">
  & Pick<CalendarGrid, "teamScheduleQuery">;

/** Whether the grid can be shown: first load, offline-cold, load errors. */
export function useCalendarLoadState(deps: UseCalendarLoadStateDeps) {
  const {
    calendarVisibility, isLoading, clientsQuery, servicesQuery, calSettingsQuery,
    citiesQuery, dayCitiesQuery, teamScheduleQuery, appointmentsQuery, teamsLoadError,
    teamsQueryError,
  } = deps;
  const calendarLoading =
    // Пока не известно, что скрыто, сетка не показывает ни одного календаря:
    // иначе первым кадром мелькал бы скрытый.
    !calendarVisibility.known ||
    isLoading ||
    clientsQuery.isLoading ||
    servicesQuery.isLoading ||
    calSettingsQuery.isLoading ||
    citiesQuery.isLoading ||
    dayCitiesQuery.isLoading ||
    teamScheduleQuery.isLoading;
  // Календарь загрузился (или упал с ошибкой) — заставка загрузки уходит.
  useEffect(() => {
    if (!calendarLoading) markBootReady();
  }, [calendarLoading]);

  // СЕТКУ ПРЯЧЕТ ТОЛЬКО ОШИБКА ПЕРВОЙ ЗАГРУЗКИ. Неудачное
  // ПЕРЕЧИТЫВАНИЕ в react-query ставит `error`, а данные оставляет — и
  // загруженная неделя целиком менялась на «Не удалось загрузить календарь»,
  // стоило метке дня или графику не перечитаться при возврате в приложение.
  const loadError = (q: { isLoadingError: boolean; error: unknown }) =>
    q.isLoadingError ? q.error : null;
  // Без сети записи без копии в памяти не читаются вовсе — запрос стоит на
  // паузе, данных и ошибки нет, и рисовалась пустая неделя «Пока нет
  // записей». Это тот же «нет копии на устройстве», что и у обёртки кэша.
  const appointmentsOfflineCold =
    appointmentsQuery.isPending && appointmentsQuery.fetchStatus === "paused";
  const calendarError =
    loadError(appointmentsQuery) ||
    (appointmentsOfflineCold ? new ColdOfflineCacheMissError("appointments") : null) ||
    (teamsLoadError ? teamsQueryError : null) ||
    loadError(clientsQuery) ||
    loadError(servicesQuery) ||
    loadError(calSettingsQuery) ||
    loadError(citiesQuery) ||
    loadError(dayCitiesQuery) ||
    loadError(teamScheduleQuery);

  return {
    calendarLoading, calendarError,
  };
}
