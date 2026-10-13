import { useMemo } from "react";
import { DEFAULT_CALENDAR_SETTINGS } from "@babun/shared/local/calendar-settings";
import type { FreeSlotRange } from "@/features/calendar/DayView";
import { minutesBetweenHM } from "@/features/appointments/helpers";
import { freeSlotsForDay } from "@/features/calendar/free-slots";
import {
  effectiveBuffer,
  effectiveWorkHours,
} from "@/features/calendar/setting-options";
import {
  deriveScrollHour,
  deriveWindow,
  effectiveCalendarWindow,
  hmToMinutes,
} from "@/features/calendar/window";
import {
  useTeamSchedule,
  useUpsertTeamSchedule,
} from "@/features/reference/team-schedule";
import { sheetBandResolver, workBandResolver } from "./work-band";
import type { CalendarClock } from "./use-calendar-clock";
import type { CalendarScope } from "./use-calendar-scope";
import type { CalendarSources } from "./use-calendar-sources";
import type { CalendarView } from "./use-calendar-view";
import type { GridModes } from "./use-grid-modes";
import type { VisibleAppointments } from "./use-visible-appointments";

type UseCalendarGridDeps =
  Pick<CalendarScope, "activeTeam" | "activeTeamId">
  & Pick<CalendarSources, "calSettings">
  & Pick<CalendarView, "mode">
  & Pick<VisibleAppointments, "weekYmds" | "dayYmd" | "visibleAppts" | "apptsFor">
  & Pick<GridModes, "moving" | "movingKind" | "pickClientId">
  & Pick<CalendarClock, "todayYmd" | "nowMinutes">;

/** Grid geometry of the open calendar: working bands, buffer, visible
 *  hours, the opening scroll hour and the green free slots. */
export function useCalendarGrid(deps: UseCalendarGridDeps) {
  const {
    activeTeam, calSettings, activeTeamId, mode, weekYmds, dayYmd, visibleAppts, moving,
    movingKind, pickClientId, apptsFor, todayYmd, nowMinutes,
  } = deps;
  // Буфер после каждой записи (дорога/уборка) — СВОЙ У БРИГАДЫ, компанейский
  // остаётся фолбэком (владелец 2026-08-17: буфер переехал в график команды).
  // Один резолвер на все поверхности — три собственных `?? 0` уже разъезжались
  // на рабочих часах. Лента рисуется в DayColumn.
  const bufferMinutes = effectiveBuffer(activeTeam, calSettings);

  // Рабочие часы команды по датам (team_schedules: weekday/date overrides,
  // vacations) — web DayColumn.tsx:231 resolves per date via the shared
  // getDayScheduleForDate. null = нерабочий день → колонка без wash (web
  // v473: day-off body stays plain); undefined (нет строки расписания /
  // мусор в HH:MM) → фолбэк на глобальные workStartHour/EndHour в колонке.
  const teamScheduleQuery = useTeamSchedule(activeTeamId ?? undefined);
  const teamSchedule = teamScheduleQuery.data;
  const upsertSchedule = useUpsertTeamSchedule();
  const workBandFor = useMemo(() => workBandResolver(teamSchedule), [teamSchedule]);

  // Общие рабочие часы — фолбэк, когда у команды нет своего графика (у части
  // живых команд строки team_schedules нет вовсе, и красит их именно это).
  // ОДИН РЕЗОЛВЕР НА ВЕСЬ ПРОДУКТ. Свои «?? 6 / ?? 22» здесь давали третий
  // ответ на вопрос «какие у нас рабочие часы»: экран настроек показывал одно,
  // сетка красила другое, свободные слоты считали третье.
  const globalWork = useMemo(
    () => effectiveWorkHours(calSettings ?? DEFAULT_CALENDAR_SETTINGS),
    [calSettings],
  );
  // Разложено на числа: массив зависимостей у хука ниже сравнивает по ссылке,
  // а объект globalWork пересобирается на каждый рендер.
  const workStartMin = globalWork.start * 60;
  const workEndMin = globalWork.end * 60;

  // Рабочая полоса дня для листа записи — тот же резолвер и фолбэк, что
  // красят серый wash сетки (DayColumn): подсветка «вне рабочих часов» в
  // колесе никогда не противоречит серому на сетке. Поэтому без явных
  // рабочих часов (нет ни графика команды, ни настройки) сигнала НЕТ —
  // сетка в этом случае wash не рисует, и колесо не должно гадать
  // дефолтами 6–22 из globalWork.
  const sheetBandFor = useMemo(
    () =>
      sheetBandResolver(
        workBandFor,
        calSettings?.workStartHour,
        calSettings?.workEndHour,
      ),
    [workBandFor, calSettings?.workStartHour, calSettings?.workEndHour],
  );

  // Видимое окно: «Часы календаря» из настроек, а при «Автоматически» —
  // ВЫВОДИТСЯ из рабочих часов просматриваемых дней; в обоих режимах
  // раздвигается под записи, которые выпали (см. features/calendar/window.ts).
  // Дни берём ровно те, что на экране: в Дне — один, в Неделе — семь
  // (иначе рельс скакал бы при переходе между видами).
  const visibleDays = useMemo(
    () => (mode === "week" ? weekYmds : [dayYmd]),
    [mode, weekYmds, dayYmd],
  );
  const visWindow = useMemo(() => {
    const bands = visibleDays.map((ymd) => workBandFor?.(ymd));
    const dayAppts = visibleAppts.filter((a) => visibleDays.includes(a.date));
    // «Часы календаря» ЭТОГО календаря: своя пара команды → стандарт компании
    // (владелец 2026-08-17: у команды один и команды два часы разные). Читается
    // буквально — «Автоматически» в продукте больше нет. Записи раздвигают
    // окно: deriveWindow держит инвариант «ничего не спрятано».
    //
    // МИНУТЫ ГРАНИЦЫ ОКРУГЛЯЮТСЯ НАРУЖУ. Рельс размечен целыми часами
    // (DayView рисует по одной подписи на час), поэтому «с 08:30» показывается
    // рельсом с 08:00, а «до 20:30» — до 21:00. Округление именно наружу:
    // внутрь оно спрятало бы половину часа, которую человек попросил видеть.
    const win = effectiveCalendarWindow(activeTeam, calSettings);
    return deriveWindow(bands, globalWork, dayAppts, {
      start: Math.floor(hmToMinutes(win.start) / 60),
      end: Math.min(24, Math.ceil(hmToMinutes(win.end) / 60)),
    });
  }, [
    visibleDays,
    workBandFor,
    globalWork,
    visibleAppts,
    activeTeam,
    calSettings,
  ]);
  const visStartHour = visWindow.startHour;
  const visEndHour = visWindow.endHour;

  // Час открытия — начало работы просматриваемого дня (стабильное значение:
  // «сейчас» тикает раз в минуту, а openScroll перезапускается на каждое его
  // изменение — рельс дёргался бы под пальцем. Вернуться к текущему часу есть
  // чем: «Сегодня» в шапке и «к сейчас» на сетке).
  const scrollToHour = useMemo(
    () => deriveScrollHour(workBandFor?.(dayYmd), globalWork, visWindow),
    [workBandFor, dayYmd, globalWork, visWindow],
  );

  // Свободные кубики считаются ТОЛЬКО в режиме подбора: обычный календарь
  // остаётся прежним, без зелени.
  // Окно переноса — длительность записи; у записи без длительности — шаг.
  const moveWindowMin = moving
    ? minutesBetweenHM(moving.time_start, moving.time_end) ||
      (activeTeam?.default_slot_minutes ?? 30)
    : 0;
  const freeSlotsFor = useMemo(() => {
    if (!pickClientId && !moving) return undefined;
    // Считаем каждую дату ОДИН раз: пейджер держит три страницы, и в Неделе
    // резолвер зовётся 21 раз за рендер — без кэша это тысячи проходов по
    // записям на каждый тик «сейчас» и на каждый свайп.
    const cache = new Map<string, readonly FreeSlotRange[]>();
    return (dateYmd: string): readonly FreeSlotRange[] => {
      const hit = cache.get(dateYmd);
      if (hit) return hit;
      const out = compute(dateYmd);
      cache.set(dateYmd, out);
      return out;
    };
    function compute(dateYmd: string): readonly FreeSlotRange[] {
      // Прошедшие дни не предлагаются вовсе: записать «во вчера» нельзя,
      // туда можно только перенести уже существующую запись.
      if (dateYmd < todayYmd) return [];
      // ТОЛЬКО ЗАНЯТОСТЬ ЭТОЙ БРИГАДЫ. Общий срез календаря содержит ещё и
      // личные события без команды — они видны в КАЖДОМ календаре, и одно
      // событие «весь день» обнуляло свободное время у всех команд разом:
      // зелёных кубиков нет нигде, а тап мимо кубика ловится запретом
      // «Выберите зелёное время». Записать становилось физически нельзя,
      // хотя команды работают.
      const appts = (apptsFor(dateYmd) ?? []).filter(
        (a) => a.team_id === activeTeamId,
      );
      const step = activeTeam?.default_slot_minutes ?? 30;
      return freeSlotsForDay({
        band: workBandFor?.(dateYmd),
        fallback: {
          startMin: Math.round(workStartMin),
          endMin: Math.round(workEndMin),
        },
        appts,
        stepMinutes: step,
        bufferMinutes,
        nowMinutes: dateYmd === todayYmd ? nowMinutes ?? null : null,
        // Перенос: окно = длительность записи, её собственное время свободно.
        durationMinutes: moving ? moveWindowMin : undefined,
        // Своё время свободно только при ПЕРЕНОСЕ в своей же команде: копия
        // встаёт рядом с оригиналом, а в чужой команде записи нет вовсе.
        ignoreId:
          moving && movingKind === "move" && moving.team_id === activeTeamId
            ? moving.id
            : null,
      }).map((slot) => ({
        startMin: slot.startMin,
        endMin: slot.startMin + step,
      }));
    }
  }, [
    pickClientId,
    moving,
    movingKind,
    moveWindowMin,
    apptsFor,
    activeTeamId,
    workBandFor,
    workStartMin,
    workEndMin,
    bufferMinutes,
    activeTeam?.default_slot_minutes,
    todayYmd,
    nowMinutes,
  ]);

  return {
    bufferMinutes, teamScheduleQuery, teamSchedule, upsertSchedule, workBandFor,
    globalWork, sheetBandFor, visStartHour, visEndHour, scrollToHour, moveWindowMin,
    freeSlotsFor,
  };
}

export type CalendarGrid = ReturnType<typeof useCalendarGrid>;
