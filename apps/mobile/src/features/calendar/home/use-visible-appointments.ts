import { useCallback, useMemo, useRef } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import { haptics } from "@/lib/haptics";
import { formatYMD } from "@/features/appointments/helpers";
import { useFeatureOn } from "@/features/settings/company-features";
import { hiddenByWindow } from "@/features/appointments/record-window";
import { startOfWeek } from "@/features/calendar/week";
import {
  COLOR_SITUATIONS,
  appointmentSituation,
  worstSituation,
  type ColorSituation,
} from "@/features/appointments/record-color";
import { isPersonalEvent } from "./appointment-rules";
import { addDays, repeatExpandAnchor, repeatExpandWindow } from "./dates";
import {
  agendaMonthSections,
  expandWithOccurrenceCache,
  groupByDate,
  type OccurrenceCache,
} from "./grouping";
import type { CalendarClock } from "./use-calendar-clock";
import type { CalendarRights } from "./use-calendar-rights";
import type { CalendarScope } from "./use-calendar-scope";
import type { CalendarSources } from "./use-calendar-sources";
import type { CalendarUiState } from "./use-calendar-ui-state";
import type { CalendarView } from "./use-calendar-view";
import type { RecordColors } from "./use-record-colors";

type UseVisibleAppointmentsDeps =
  Pick<CalendarScope, "activeTeam" | "activeTeamId" | "canManageDayLabels">
  & Pick<CalendarSources, "calSettings" | "appts">
  & Pick<CalendarRights, "actionsIn" | "mirror" | "paymentHiddenFor">
  & Pick<CalendarClock, "todayYmd">
  & Pick<CalendarView, "mode" | "day" | "monthAnchor">
  & Pick<RecordColors, "situationPalette" | "activeSituations">
  & Pick<CalendarUiState, "setCityPickerYmd">;

/** Which records each surface shows: the grid set, the money set, by
 *  date, by week and the month list. */
export function useVisibleAppointments(deps: UseVisibleAppointmentsDeps) {
  const {
    activeTeam, calSettings, activeTeamId, actionsIn, todayYmd, mirror, mode, day,
    appts, situationPalette, activeSituations, paymentHiddenFor, canManageDayLabels,
    setCityPickerYmd, monthAnchor,
  } = deps;
  // Скрывать отменённые: настройка команды побеждает глобальную (web
  // parity: dashboard/page.tsx:1613 `activeTeam?.hide_cancelled ?? …`).
  const hideCancelled =
    activeTeam?.hide_cancelled ?? !!calSettings?.hideCancelled;
  // Записи активного календаря. Личные события без команды (team_id null,
  // kind ≠ work) видны в ЛЮБОМ календаре: у мобильного нет веб-таба «Мой
  // календарь» (web page.tsx:914-936 — personal tab = «mine, by exclusion»),
  // и без этого правила они не были бы видны нигде.
  const inTeamCal = useCallback(
    (a: Appointment) =>
      activeTeamId
        ? a.team_id === activeTeamId || isPersonalEvent(a)
        : true,
    [activeTeamId],
  );
  // События — функция компании (STORY-088): выключены — их нет в сетке ни у
  // кого; данные не стираются.
  const eventsOn = useFeatureOn("events");
  // «ЕГО ГЛАЗАМИ» — РОВНО ТО, ЧТО ОТДАСТ ЕМУ СЕРВЕР.
  // Записи в зеркале читаются токеном владельца, то есть ВСЕ: личные события
  // владельца без команды и события команд, где у сотрудника «События:
  // Скрыт», стояли в его календаре. Режем тем же правилом, что сервер
  // (`list_master_appointments_safe`): без команды — нет, «Записи клиентов:
  // Скрыты» — нет ничего, событие — только при «Событиях: Видит».
  const mirrorSees = useCallback(
    (a: Appointment) => {
      if (a.team_id == null) return false;
      const can = actionsIn(a.team_id);
      if (can.records === "hidden") return false;
      // «Ограничения»: прошедшая работа старше окна команды ему не
      // видна — сервер режет её так же (`member_record_window_start`).
      if (hiddenByWindow(a, can.window, todayYmd)) return false;
      return a.kind === "work" || can.events !== "hidden";
    },
    [actionsIn, todayYmd],
  );
  const byTeam = useCallback(
    (a: Appointment) =>
      inTeamCal(a) &&
      (!hideCancelled || a.status !== "cancelled") &&
      (eventsOn || a.kind !== "event") &&
      (!mirror || mirrorSees(a)),
    [inTeamCal, hideCancelled, eventsOn, mirror, mirrorSees],
  );

  // Web parity (dashboard/page.tsx, STORY-091): recurring seeds expand into
  // virtual occurrences inside a window around the visible anchor. В режиме
  // «Месяц» пейджер держит соседние страницы целиком, поэтому окно покрывает
  // prev/next месяцы (+ недельные хвосты их сеток); в остальных видах —
  // −30/+60 дней вокруг якоря. includeCancelled: отменённая серия остаётся
  // видимой при выключенном «Скрывать отменённые» (byTeam выше сам фильтрует
  // по hideCancelled). Virtuals carry virtualParentId — openEdit routes
  // their tap back to the seed.
  // ОКНО РАЗВОРОТА ПОВТОРОВ — ГРУБЫМ ШАГОМ (Android). Окно от
  // `day` заставило бы КАЖДЫЙ свайп недели/дня разворачивать повторы по
  // всей истории заново, а следом пересчитывалась бы вся цепочка (видимые,
  // по датам, финансы). Поэтому окно сдвигается раз в четыре недели (в месяце
  // — раз в месяц) и с запасом покрывает «−30…+60 дней» от любого дня
  // своего шага; свайп внутри шага не трогает ничего.
  const expandAnchor = useMemo(
    () => repeatExpandAnchor(day, mode === "month"),
    [day, mode],
  );
  // Вхождения повторов — ТЕ ЖЕ ОБЪЕКТЫ, пока не поменялась сама серия: новый
  // объект на каждый пересчёт ломал сравнение колонок, и каждая колонка с
  // повтором перерисовывалась.
  const occurrenceCache = useRef<OccurrenceCache>(new Map());
  const expandedAppts = useMemo(() => {
    const { fromKey, toKey } = repeatExpandWindow(expandAnchor, mode === "month");
    const { list, cache } = expandWithOccurrenceCache(
      appts,
      fromKey,
      toKey,
      occurrenceCache.current,
    );
    occurrenceCache.current = cache;
    return list;
  }, [appts, expandAnchor, mode]);

  // Team-scoped set — MonthView counts every visible cell (incl. the
  // prev/next-month tails) and the MiniCalendar dots from this.
  const visibleAppts = useMemo(
    () => expandedAppts.filter(byTeam),
    [expandedAppts, byTeam],
  );

  // ДЫРА ДНЯ ДЛЯ МЕСЯЦА — один проход на весь пейджер (три страницы месяца
  // живут одновременно). Считается по ВИДИМОМУ набору, тому же, что даёт
  // счётчик: денежный набор сюда подставлять нельзя, они намеренно расходятся
  // по «Скрывать отменённые». В остальных видах не считаем вовсе.
  const holeByDay = useMemo(() => {
    const out = new Map<string, { name: string; color: string }>();
    if (mode !== "month") return out;
    const byDate = new Map<string, (ColorSituation | null)[]>();
    for (const a of visibleAppts) {
      const arr = byDate.get(a.date) ?? [];
      arr.push(
        appointmentSituation(a, {
          palette: situationPalette,
          active: activeSituations,
          todayYmd,
          // Как у сетки и ленты: партнёру без
          // «Оплаты» сервер отдаёт нули, и выполненная сегодня запись горела в
          // месяце пилюлей «Не оплачено», хотя в сетке дыры не было.
          paymentHidden: paymentHiddenFor(a),
        }),
      );
      byDate.set(a.date, arr);
    }
    for (const [date, list] of byDate) {
      const worst = worstSituation(list);
      const color = worst ? (situationPalette[worst] ?? "").trim() : "";
      if (!worst || !color) continue;
      out.set(date, {
        name: COLOR_SITUATIONS.find((s) => s.id === worst)?.label ?? "",
        color,
      });
    }
    return out;
  }, [mode, visibleAppts, situationPalette, activeSituations, todayYmd, paymentHiddenFor]);
  const holeFor = useCallback(
    (dateYmd: string) => holeByDay.get(dateYmd) ?? null,
    [holeByDay],
  );
  // Стрелка прямо в пропе делала `memo` месяца мёртвым: свежая функция на
  // каждый рендер родителя перерисовывала все три страницы пейджера, и
  // стабильность `holeFor` ничего не защищала. Неделя берёт тот же
  // обработчик: тап по дате у неё значит то же самое, и её memo так же мёртв
  // от стрелки.
  const onPickLabelDay = useMemo(
    () =>
      canManageDayLabels && activeTeamId
        ? (dateYmd: string) => {
            haptics.tap();
            setCityPickerYmd(dateYmd);
          }
        : undefined,
    [canManageDayLabels, activeTeamId, setCityPickerYmd],
  );

  // Денежный набор: «Скрывать отменённые» — визуальная настройка сетки и
  // итоги дня менять не должна. Судьбу отменённых в деньгах решает сам
  // computeDayFinance (planned их не считает, earned — только
  // completed/in_progress), поэтому денежные поверхности получают полный
  // командный набор.
  const financeAppts = useMemo(
    () => expandedAppts.filter(inTeamCal),
    [expandedAppts, inTeamCal],
  );
  const financeByDate = useMemo(() => groupByDate(financeAppts), [financeAppts]);
  const financeFor = useCallback(
    (ymd: string) => financeByDate.get(ymd) ?? [],
    [financeByDate],
  );
  // Запись по id — для строк леджера, чья запись в другом дне (предоплата
  // сегодня за завтра): разбор дня называет её услугами и её днём.
  const financeById = useMemo(
    () => new Map(financeAppts.map((a) => [a.id, a])),
    [financeAppts],
  );
  const findFinanceRecord = useCallback(
    (id: string) => financeById.get(id),
    [financeById],
  );

  const dayYmd = formatYMD(day);
  // Резолвер «записи дня» для страниц пейджера (prev/cur/next день или
  // неделя) — окно visibleAppts (−30/+60д вокруг якоря) покрывает соседей.
  const apptsByDate = useMemo(() => groupByDate(visibleAppts), [visibleAppts]);
  const apptsFor = useCallback(
    (ymd: string) => apptsByDate.get(ymd) ?? [],
    [apptsByDate],
  );
  const weekDays = useMemo(() => {
    const first = startOfWeek(day);
    return Array.from({ length: 7 }, (_, i) => addDays(first, i));
  }, [day]);
  const weekYmds = useMemo(() => weekDays.map(formatYMD), [weekDays]);
  // Финансы недельного футера — денежный набор (см. financeAppts выше).
  const financeWeekAppts = useMemo(
    () => financeAppts.filter((a) => weekYmds.includes(a.date)),
    [financeAppts, weekYmds],
  );

  // «СПИСОК» — ВЕСЬ ВЫБРАННЫЙ МЕСЯЦ. Шапка называет
  // месяц, как у недели и месяца; «ближайшие 60 дней» от выбранного
  // дня путали бы: шапка говорила бы одно, лента показывала другое.
  // Список месяца нужен только виду «Список» — в неделе и дне сортировать
  // месяц на каждый пересчёт незачем (Android).
  const agendaSections = useMemo(
    () => (mode !== "agenda" ? [] : agendaMonthSections(visibleAppts, monthAnchor)),
    [visibleAppts, monthAnchor, mode],
  );

  return {
    eventsOn, visibleAppts, holeFor, onPickLabelDay, financeAppts, financeFor,
    findFinanceRecord, dayYmd, apptsFor, weekDays, weekYmds, financeWeekAppts,
    agendaSections,
  };
}

export type VisibleAppointments = ReturnType<typeof useVisibleAppointments>;
