import { startTransition, useCallback, useMemo, useState } from "react";
import { useSharedValue } from "react-native-reanimated";
import { haptics } from "@/lib/haptics";
import { useLatestHandler } from "@/features/calendar/use-latest-handler";
import { HOUR_H_DEFAULT } from "@/features/calendar/zoom";
import { addDays } from "./dates";
import type { CalendarClock } from "./use-calendar-clock";
import type { CalendarGrid } from "./use-calendar-grid";
import type { CalendarRights } from "./use-calendar-rights";
import type { CalendarScope } from "./use-calendar-scope";
import type { CalendarSources } from "./use-calendar-sources";
import type { CalendarUiState } from "./use-calendar-ui-state";
import type { CalendarView } from "./use-calendar-view";
import type { CreateAt } from "./slot-placement";
import type { OpenActionMenu } from "./action-menu";
import type { QuickEvents } from "./use-quick-events";
import type { RecordActions } from "./use-record-actions";
import type { RecordColors } from "./use-record-colors";
import type { RecordNaming } from "./use-record-naming";
import type { Reschedule } from "./reschedule";
import type { VisibleAppointments } from "./use-visible-appointments";

type UseGridPropsDeps =
  Pick<RecordActions, "openEdit">
  & { openActionMenu: OpenActionMenu }
  & { createAt: CreateAt }
  & Pick<QuickEvents, "slotMenu">
  & { reschedule: Reschedule }
  & Pick<CalendarView, "setDay">
  & Pick<CalendarScope, "canManageDayLabels" | "activeTeamId">
  & Pick<VisibleAppointments, "dayYmd">
  & Pick<CalendarUiState, "setCityPickerYmd">
  & Pick<RecordNaming, "clientName" | "serviceLabel" | "addressFor">
  & Pick<RecordColors, "teamColorFor" | "labelTintFor">
  & Pick<CalendarRights, "canManageBookings" | "isCrew" | "canMoveAppointment">
  & Pick<CalendarGrid, "visStartHour" | "visEndHour" | "workBandFor" | "freeSlotsFor"
    | "bufferMinutes" | "scrollToHour">
  & Pick<CalendarSources, "calSettings">
  & Pick<CalendarClock, "nowMinutes">;

/** Grid zoom, stable gesture handlers and the shared props of the Week and
 *  Day grids. */
export function useGridProps(deps: UseGridPropsDeps) {
  const {
    openEdit, openActionMenu, createAt, slotMenu, reschedule, setDay,
    canManageDayLabels, activeTeamId, dayYmd, setCityPickerYmd, clientName,
    serviceLabel, addressFor, teamColorFor, canManageBookings, isCrew,
    canMoveAppointment, visStartHour, visEndHour, calSettings, workBandFor,
    freeSlotsFor, labelTintFor, bufferMinutes, nowMinutes, scrollToHour,
  } = deps;
  // Pixels-per-hour for the time grid — pinch-to-zoom (session-only, web
  // parity: web resets zoom on reload too). Shared by Day + Week grids.
  // The LIVE value is the shared value (mutated on the UI thread by the
  // pinch, zero re-renders mid-gesture); the state mirror commits once per
  // gesture so render-time derivations (block text fit) catch up.
  const hourHSv = useSharedValue(HOUR_H_DEFAULT);
  const [hourH, setHourH] = useState(HOUR_H_DEFAULT);

  // ОБРАБОТЧИКИ СЕТКИ — СТАБИЛЬНЫЕ ПО ССЫЛКЕ, НО ЗОВУТ СВЕЖЕЕ ЗАМЫКАНИЕ.
  // Колонки и блоки мемоизированы; функция, пересоздаваемая каждым рендером,
  // перерисовывала бы все двадцать одну колонку недели на любой флаг запроса.
  // `useCallback` здесь не годится: зависимостей у этих функций десятки, и
  // ссылка менялась бы почти всегда. Обёртка же отдаёт жесту (перенос
  // пальцем, долгое нажатие, тап по слоту) функцию последнего ПОКАЗАННОГО
  // рендера — с сегодняшними записями, режимом переноса и правами, а не с
  // теми, что были при последней отрисовке блока. См. `use-latest-handler`.
  const onEditGrid = useLatestHandler(openEdit);
  const onMenuGrid = useLatestHandler(openActionMenu);
  const createAtGrid = useLatestHandler(createAt);
  // Стабильная ссылка, как у тапа: иначе memo Недели мёртв на каждом рендере.
  const slotMenuGrid = useLatestHandler(slotMenu);
  const rescheduleGrid = useLatestHandler(reschedule);
  // Коммит зума — низким приоритетом: полный ре-рендер сетки на отпускании
  // щипка давал видимый «прыжок» кадра (жалоба владельца). Живая геометрия
  // и так на UI-потоке; здесь догоняют только «холодные» слои (текст-фит).
  // Сеттер стабилен, поэтому пустые зависимости честны.
  const onZoom = useCallback(
    (v: number) => startTransition(() => setHourH(v)),
    [],
  );
  const onCommitWeekPage = useCallback(
    (dir: 1 | -1) => setDay((d) => addDays(d, dir * 7)),
    [setDay],
  );
  const onCommitDayPage = useCallback(
    (dir: 1 | -1) => setDay((d) => addDays(d, dir)),
    [setDay],
  );
  // Тап по шапке Дня — метка ИМЕННО открытой даты, поэтому dayYmd в
  // зависимостях: иначе после свайпа метка ставилась бы на прежний день.
  const onDayLabelTap = useMemo(
    () =>
      canManageDayLabels && activeTeamId
        ? () => {
            haptics.tap();
            setCityPickerYmd(dayYmd);
          }
        : undefined,
    [canManageDayLabels, activeTeamId, dayYmd, setCityPickerYmd],
  );

  const gridProps = useMemo(
    () => ({
      clientName,
      serviceLabel,
      addressFor,
      teamColorFor,
      onEdit: onEditGrid,
      onReschedule: canManageBookings || isCrew ? rescheduleGrid : undefined,
      canReschedule: canMoveAppointment,
      startHour: visStartHour,
      endHour: visEndHour,
      // Привязка драга и тапа по пустому слоту — 15 мин, константа. «Шаг сетки»
      // как настройка убран: ни одной линии он не рисовал (сетку рисует зум —
      // граница часа безусловна, получас появляется при hourH ≥ 52), зато тайно
      // задавал длительность новой записи. Длительность теперь честная настройка
      // календаря (teams.default_slot_minutes).
      stepMinutes: 15,
      workStartHour: calSettings?.workStartHour,
      workEndHour: calSettings?.workEndHour,
      workBandFor,
      freeSlotsFor,
      labelTintFor,
      bufferMinutes,
      nowMinutes,
      scrollToHour,
      hourH,
      hourHSv,
      onZoom,
    }),
    [
      clientName,
      serviceLabel,
      addressFor,
      teamColorFor,
      onEditGrid,
      canManageBookings,
      isCrew,
      rescheduleGrid,
      canMoveAppointment,
      visStartHour,
      visEndHour,
      calSettings?.workStartHour,
      calSettings?.workEndHour,
      workBandFor,
      freeSlotsFor,
      labelTintFor,
      bufferMinutes,
      nowMinutes,
      scrollToHour,
      hourH,
      hourHSv,
      onZoom,
    ],
  );

  return {
    onMenuGrid, createAtGrid, slotMenuGrid, onCommitWeekPage, onCommitDayPage,
    onDayLabelTap, gridProps,
  };
}

export type GridHandlers = ReturnType<typeof useGridProps>;
