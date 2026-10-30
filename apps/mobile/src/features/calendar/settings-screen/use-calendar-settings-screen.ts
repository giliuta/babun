import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { readTenantPref } from "@/lib/tenant-prefs";
import { useTenantId } from "@/lib/tenant";
import { useSaveCalendarOrder } from "@/session/use-calendar-order";
import { useCalendarChips, useCalendarVisibility } from "@/session/workspaces";
import { useLeaveCalendar } from "@/features/settings/leave-calendar";
import {
  AUTO_COLOR_RULES,
  BOOKING_BLOCKS,
  useAutoColorRule,
  useBookingBlocks,
} from "@/features/appointments/booking-prefs";
import {
  DEFAULT_CALENDAR_SETTINGS,
  type CalendarSettings,
} from "@babun/shared/local/calendar-settings";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useCities, useTeams, useUpdateTeam } from "@/features/reference/queries";
import { useAllTeamSchedules } from "@/features/reference/team-schedule";
import { schedulePreview } from "@/features/reference/schedule-days";
import { useCalendarDelete } from "@/features/calendar/useCalendarDelete";
import { calendarSettingsRows } from "@/features/calendar/settings-rows";
import { readOpeningZoom, readViewportH, writeGridZoom, zoomToPct, type GridZoom } from "@/features/calendar/grid-memory";
import { useCurrentRole, usePlanAllows } from "@/session/tenant";
import { useCalendarActionsReader } from "@/features/appointments/useRecordRights";
import { useMemberUpdateTeam } from "@/features/calendar/mutations";
import { accessGate } from "@/session/my-access";
import { useMyAccess } from "@/session/access-queries";
import { useToast } from "@/components/ui/Toast";
import { notify } from "@/lib/notify";
import { effectiveCalendarWindow } from "@/features/calendar/window";
import { effectiveWorkHours, hourLabel } from "@/features/calendar/setting-options";
import { useTariff } from "@/features/tariffs/use-tariff";
import { bookingSubtitle, labelsSubtitle, windowSpanHours } from "./settings-subs";

/** Ключ, под которым вид календаря лежал ДО переезда настроек на компанию.
 *  Передаётся в `readTenantPref` третьим аргументом: он забирает старое
 *  значение один раз и сносит, иначе в день правки у всех сбросился бы вид. */
const CAL_VIEW_LEGACY_KEY = "calendar.view";

/** State, queries and derived rows of the «Календарь» settings screen. */
export function useCalendarSettingsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ team?: string }>();
  const settingsQuery = useCalendarSettings();
  const settings = settingsQuery.data;
  const { data: teams = [], isLoading: teamsLoading } = useTeams();
  // Календари числом не ограничены: новый бесплатен, пока в нём нет работы.
  const tariffForever = useTariff().state.forever;
  const { data: schedules = {} } = useAllTeamSchedules();
  const update = useUpdateTeam();
  const archiveTeam = useCalendarDelete().archive;
  const toast = useToast();
  const [savedTick, setSavedTick] = useState(0);
  // Отдельной двери к общим «Рабочим часам» нет:
  // когда работает команда, отвечает её ГРАФИК — он правится листом снизу.
  // Колонки `work_start_hour/work_end_hour` живы и остаются фолбэком сетки для
  // команды без строки расписания — стандарт 06:00–20:00.
  const [picker, setPicker] = useState<"view" | "zoom" | "tz" | null>(null);
  const role = useCurrentRole().data;
  // ПАРТНЁР ВЫХОДИТ САМ (внизу не «удалить команду», а «выйти из неё»). Своё удаляет владелец; чужую команду
  // партнёр не удаляет, а покидает — `leave_calendar`.
  const leaveCalendar = useLeaveCalendar();
  const canLeave = role != null && role !== "owner";
  const isOwner = role === "owner";
  // График команды правится ЛИСТОМ, а не страницей:
  // семь дней надо видеть целиком, пока правишь один. См. шапку
  // `TeamScheduleSheet` — там же, почему это исключение из закона «настройка —
  // всегда страница».
  const actionsIn = useCalendarActionsReader();
  const memberUpdateTeam = useMemberUpdateTeam();
  const myAccess = useMyAccess().data;
  // СТРАНИЦА ОТКРЫТА ВСЕМ, СТРОКИ — ПО ДОСТУПУ (визуал страницы одинаков, блоков внутри
  // шестерёнки может не быть). Правило и его причины — `settings-rows.ts`.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const tenantId = useTenantId();
  // СКРЫТЫЕ КАЛЕНДАРИ ВКЛЮЧАЮТ ЗДЕСЬ (тумблером в настройках календаря), поэтому шестерёнка видит и скрытые.
  // ВСЕ КАЛЕНДАРИ ВСЕХ АККАУНТОВ ОДНОЙ ЛЕНТОЙ: можно
  // переключаться между командами и своей личной, доступ разный. Тап по календарю
  // другого аккаунта переводит в него; строки ниже — по доступу в нём.
  const calendarVisibility = useCalendarVisibility();
  const saveCalendarOrder = useSaveCalendarOrder();
  const gearChips = useCalendarChips({
    own: teams,
    includeHidden: true,
    onPickOwn: (teamId) => router.setParams({ team: teamId }),
    onSwitchError: (message) => toast(message, "error"),
  });
  // Какой календарь настраиваем: параметр из шестерёнки → тот, что открыт в
  // самом календаре (MMKV, тот же ключ) → первый. Экран всегда показывает
  // календарь, в котором человек работает, а не абстрактный «первый».
  const persisted = tenantId
    ? readTenantPref<{ teamId?: string | null }>(
        "calendar.view",
        tenantId,
        CAL_VIEW_LEGACY_KEY,
      )?.teamId
    : undefined;
  const activeId = params.team ?? persisted ?? teams[0]?.id;
  const team = teams.find((x) => x.id === activeId) ?? teams[0];
  // БЕЗ ОПЛАТЫ ЭТОГО КАЛЕНДАРЯ ДВЕРИ К ПРАЙСУ НЕТ. Неоплаченный календарь
  // ведёт события; прайс — работа с клиентами, она в оплаченном. Строка,
  // которая ведёт в закрытое, хуже отсутствия строки: человек идёт и упирается
  // (канон, правило 10).
  const canUseServices = usePlanAllows("services", team?.id ?? null);
  // СТРОКИ — ПО ПРАВАМ ЭТОЙ КОМАНДЫ: сотруднику открываются те, что владелец
  // выдал в блоке «Настройки команды».
  const rowLevel = (blockKey: string): "hidden" | "read" | "write" => {
    const gate = accessGate({ role, map: myAccess, blockKey, scope: "calendar", teamId: team?.id ?? null });
    return gate === "write" ? "write" : gate === "read" ? "read" : "hidden";
  };
  const rows = calendarSettingsRows(
    role,
    { services: canUseServices },
    {
      schedule: actionsIn(team?.id ?? null).schedule,
      identity: rowLevel("calendar.identity"),
      timezone: rowLevel("calendar.timezone"),
      hours: rowLevel("calendar.hours"),
      booking: rowLevel("calendar.booking_form"),
      services: rowLevel("calendar.services"),
      labels: rowLevel("calendar.labels"),
    },
  );
  // ПОДПИСЬ СТРОКИ «ЗАПИСИ» — ЭТОЙ КОМАНДЫ: откуда цвет и сколько блоков.
  const bookingBlocks = useBookingBlocks(team?.id ?? null);
  const bookingRule = useAutoColorRule(team?.id ?? null);
  const bookingSub = bookingSubtitle(
    AUTO_COLOR_RULES.find((r) => r.id === bookingRule)?.label,
    bookingBlocks.length,
    BOOKING_BLOCKS.length,
  );
  // Метки ЭТОГО календаря: подпись строки обязана перечислять его собственные.
  const { data: labels = [] } = useCities({ teamId: activeId ?? null });

  const s: CalendarSettings = settings ?? DEFAULT_CALENDAR_SETTINGS;

  // Instant-commit: контрол шлёт частичный патч сразу, кнопки «Сохранить» нет.
  // До резолва запроса патчи игнорируем — контролы показывают ещё
  // неподтверждённые дефолты, и правка ушла бы не от той базы.
  const patchTeam = (p: Record<string, unknown>) => {
    if (!team) return;
    // Сотрудник пишет поле команды своей дверью — сервер пускает его по
    // праву строки в «Настройках команды».
    if (role === "master") {
      memberUpdateTeam.mutate(
        { teamId: team.id, patch: p },
        {
          onSuccess: () => setSavedTick(Date.now()),
          onError: (e) => notify("Ошибка", e.message),
        },
      );
      return;
    }
    update.mutate(
      { id: team.id, patch: p },
      {
        onSuccess: () => setSavedTick(Date.now()),
        onError: (e) => notify("Ошибка", e.message),
      },
    );
  };

  // Масштаб при открытии — с этого телефона; щипок по сетке его не трогает.
  const [gridZoom, setGridZoom] = useState(readOpeningZoom);
  const applyZoom = (zoom: GridZoom) => {
    writeGridZoom(zoom, true);
    setGridZoom(zoom);
  };

  const work = effectiveWorkHours(s);
  // ПОЯС ЭТОГО КАЛЕНДАРЯ. Порядок ровно тот же, что читает весь продукт
  // (`activeTeam?.timezone ?? calSettings?.timezone` в календаре, в записи и в
  // напоминаниях), — экран не имеет права разрешать его иначе, чем сетка.
  const companyZone = s.timezone ?? DEFAULT_CALENDAR_SETTINGS.timezone;
  const timezone = team?.timezone ?? companyZone;
  // «Часы календаря» — видимое окно рельса ЭТОГО календаря (у каждой команды свои
  // часы). Читается буквально: «Автоматически» в продукте нет, 00:00–24:00 — это сутки целиком. Своей пары у команды нет —
  // наследуется стандарт компании, и строка про это говорит вслух.
  const window = effectiveCalendarWindow(team, s);
  const labelsSub = labelsSubtitle(labels.map((c) => c.name));
  const view = {
    start: window.start.hour,
    end: window.end.hour,
    startMinute: window.start.minute,
    endMinute: window.end.minute,
  };
  const zoomPct = zoomToPct(gridZoom, windowSpanHours(window), readViewportH("week"));

  // ОДИН ДИАЛЕКТ У СТРОКИ ГРАФИКА. Две разные фразы на одной строке (у
  // команды со СВОИМ графиком «Пн–Вс · 10:00–20:00», а у команды БЕЗ него —
  // голые часы компании без единого дня) сделали бы две команды рядом
  // несравнимыми, и вторая не отвечала на главный вопрос строки —
  // «в какие дни».
  //
  // Строки графика может не быть — тогда команда работает общими часами
  // компании все семь дней (так же её красит и сетка: DayView с
  // workBand === undefined). Это ровно тот же график, только унаследованный, —
  // значит и произносится он тем же способом.
  const sched = team ? schedules[team.id] : undefined;
  const schedText = schedulePreview(
    sched ?? {
      start: hourLabel(work.start),
      end: hourLabel(work.end),
      breaks: [],
    },
  );

  return {
    router,
    settingsQuery,
    settings,
    teams,
    teamsLoading,
    tariffForever,
    archiveTeam,
    toast,
    savedTick,
    picker,
    setPicker,
    leaveCalendar,
    canLeave,
    isOwner,
    scheduleOpen,
    setScheduleOpen,
    createOpen,
    setCreateOpen,
    tenantId,
    calendarVisibility,
    saveCalendarOrder,
    gearChips,
    team,
    rows,
    bookingSub,
    patchTeam,
    gridZoom,
    applyZoom,
    timezone,
    window,
    labelsSub,
    view,
    zoomPct,
    schedText,
  };
}

export type CalendarSettingsState = ReturnType<typeof useCalendarSettingsScreen>;
