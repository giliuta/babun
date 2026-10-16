import { useCallback, useMemo } from "react";
import { haptics } from "@/lib/haptics";
import { type CalMode } from "@/features/calendar/ViewModeDropdown";
import { usePeriodPager } from "@/features/calendar/pager";
import { monthTitle, weekTitle } from "@/features/calendar/header-title";
import { startOfDay } from "./dates";
import type { CalendarClock } from "./use-calendar-clock";
import type { CalendarUiState } from "./use-calendar-ui-state";
import type { CalendarView } from "./use-calendar-view";
import type { GridModes } from "./use-grid-modes";
import type { VisibleAppointments } from "./use-visible-appointments";

type UseCalendarHeaderNavDeps =
  Pick<CalendarView, "mode" | "monthAnchor" | "day" | "setDay" | "setMode" | "rememberView"
    | "rememberViewRef">
  & Pick<VisibleAppointments, "weekDays" | "weekYmds" | "dayYmd">
  & Pick<CalendarClock, "now" | "todayYmd">
  & Pick<GridModes, "setEditingApt" | "setMoving">
  & Pick<CalendarUiState, "setMiniCalOpen">;

/** Header title, the Today button, mode switch, month paging and the long-press
 *  jumps between Month, Week and Day. */
export function useCalendarHeaderNav(deps: UseCalendarHeaderNavDeps) {
  const {
    mode, weekDays, monthAnchor, day, now, weekYmds, todayYmd, dayYmd, setDay, setMode,
    setEditingApt, setMoving, rememberView, rememberViewRef, setMiniCalOpen,
  } = deps;
  // Неделя на стыке месяцев называет оба (`header-title.ts`). «Список» —
  // месяц, как и его лента.
  const headerTitle =
    mode === "week" && weekDays.length > 0
      ? weekTitle(weekDays[0], weekDays[weekDays.length - 1])
      : monthTitle(mode === "month" || mode === "agenda" ? monthAnchor : day);

  // «Список» живёт месяцем, как и «Месяц»: по дню
  // кнопка «Сегодня» появлялась в текущем месяце, а тап по ней только прятал
  // её — лента никуда не ехала.
  const isOnToday =
    mode === "month" || mode === "agenda"
      ? monthAnchor.getFullYear() === now.getFullYear() &&
        monthAnchor.getMonth() === now.getMonth()
      : mode === "week"
        ? weekYmds.includes(todayYmd)
        : dayYmd === todayYmd;

  const goToday = () => {
    haptics.tap();
    setDay(startOfDay(now));
  };
  // Неделя→День приземляется на СЕГОДНЯ, если оно в видимой неделе (web
  // parity: handleViewModeChange, page.tsx:1382-1398) — диспетчер, тапнувший
  // «День» в текущей неделе, ждёт сегодня, а не старый выбранный день.
  // Чужая неделя — якорь сохраняется: её смотрят сознательно.
  const changeMode = (m: CalMode) => {
    if (m === "day" && mode === "week" && weekYmds.includes(todayYmd)) {
      setDay(startOfDay(now));
    }
    // В Месяце и Списке тянуть нечего — «Свободное перемещение» снимается.
    // И перенос с копией: зелёных кубиков там нет, а плашка «Выберите
    // зелёное время» висела над видом без них.
    if (m === "month" || m === "agenda") {
      setEditingApt(null);
      setMoving(null);
    }
    setMode(m);
    rememberView({ mode: m });
  };
  const jumpToDate = (d: Date) => {
    setDay(startOfDay(d));
    setMiniCalOpen(false);
  };
  // Листание месяца двигает ТОТ ЖЕ якорь: day = 1-е число целевого месяца,
  // поэтому Месяц→День всегда открывает согласованную дату.
  const prevMonth = () =>
    setDay((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const nextMonth = () =>
    setDay((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  // Живой пейджер месяца (та же механика, что в Дне/Неделе — pager.tsx).
  const monthPager = usePeriodPager({
    periodKey: `${monthAnchor.getFullYear()}-${monthAnchor.getMonth()}`,
    onCommit: (dir) => (dir === 1 ? nextMonth() : prevMonth()),
  });
  // Стабильные Date трёх страниц + стабильный обработчик — MonthView
  // мемоизирован, соседние месяцы не пересчитываются на каждый тик.
  const monthPages = useMemo(
    () =>
      [-1, 0, 1].map(
        (off) =>
          new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + off, 1),
      ),
    [monthAnchor],
  );
  // Долгий тап по дню Месяца — провалиться в Неделю этого дня (тап —
  // попап метки, см. MonthView).
  const openWeekFromMonth = useCallback((d: Date) => {
    haptics.tap();
    setDay(startOfDay(d));
    setMode("week");
    rememberViewRef.current({ mode: "week" });
  }, [setDay, setMode, rememberViewRef]);

  // Долгий тап по дате в Неделе — провалиться в День (см. WeekHeaderRow).
  // Стабильная ссылка (как `openWeekFromMonth`): иначе memo Недели мёртв.
  // Настройка пишется через ref — там всегда свежий `rememberView`.
  const pickDay = useCallback((d: Date) => {
    haptics.tap();
    setDay(startOfDay(d));
    setMode("day");
    rememberViewRef.current({ mode: "day" });
  }, [setDay, setMode, rememberViewRef]);

  return {
    headerTitle, isOnToday, goToday, changeMode, jumpToDate, monthPager, monthPages,
    openWeekFromMonth, pickDay,
  };
}

export type CalendarHeaderNav = ReturnType<typeof useCalendarHeaderNav>;
