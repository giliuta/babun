import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { GestureDetector } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import { getStorage } from "@babun/shared/storage";
import { expandRepeat } from "@babun/shared/common/utils/expand-repeat";
import { findOverlap } from "@babun/shared/common/utils/appointment-overlap";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { Screen } from "@/components/ui/Screen";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { AppointmentSheet } from "@/features/appointments/AppointmentSheet";
import { DayView, type WorkBand } from "@/features/calendar/DayView";
import { HOUR_H_DEFAULT } from "@/features/calendar/zoom";
import { WeekView } from "@/features/calendar/WeekView";
import { type CalMode } from "@/features/calendar/ViewModeDropdown";
import { CalendarHeader } from "@/features/calendar/CalendarHeader";
import { MiniCalendar } from "@/features/calendar/MiniCalendar";
import { TeamChips } from "@/features/calendar/TeamChips";
import { FirstRunCalendarChoice } from "@/features/calendar/FirstRunCalendarChoice";
import { CalendarOnboardingCard } from "@/features/calendar/CalendarOnboardingCard";
import { CityPickerModal } from "@/features/calendar/CityPickerModal";
import {
  dayCityKey,
  useDayCities,
  useSetDayCity,
} from "@/features/calendar/day-cities";
import { MonthView } from "@/features/calendar/MonthView";
import { AgendaView } from "@/features/calendar/AgendaView";
import { PagedStrip, usePeriodPager } from "@/features/calendar/pager";
import { DaySummaryStrip } from "@/features/calendar/DaySummaryStrip";
import { EndOfDayBanner } from "@/features/calendar/EndOfDayBanner";
import { CalendarSkeleton } from "@/features/calendar/CalendarSkeleton";
import { DayFinanceModal } from "@/features/calendar/DayFinanceModal";
import { DayFinanceFooter } from "@/features/calendar/DayFinanceFooter";
import { useAppointments } from "@/features/calendar/queries";
import { useUpdateAppointment } from "@/features/calendar/mutations";
import { useToast } from "@/components/ui/Toast";
import { useClients } from "@/features/clients/queries";
import { useServices } from "@/features/services/queries";
import {
  teamCities,
  useCities,
  useCreateTeam,
  useTeams,
} from "@/features/reference/queries";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useTeamSchedule } from "@/features/reference/team-schedule";
import { getDayScheduleForDate } from "@babun/shared/local/schedule";
import { TEAM_COLORS } from "@babun/shared/local/masters";

// Agenda horizon — web AgendaView parity («what's next», not «this month»).
const AGENDA_HORIZON_DAYS = 60;
// Персист выбранного вида и команды (mode/teamId) между запусками.
const CAL_VIEW_KEY = "calendar.view";

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function mondayOf(d: Date) {
  const x = startOfDay(d);
  const wd = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - wd);
  return x;
}
function addDays(d: Date, n: number) {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}
function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
// "HH:MM" → fractional hours, null on garbage (web dashboard/page.tsx
// parseHour, :570-575). The team-hub TimeField can persist free text, so
// every read here falls back to the global setting instead of breaking
// the grid.
function parseHourHM(s: string | null | undefined): number | null {
  if (!s || !/^\d{1,2}:\d{2}$/.test(s)) return null;
  const [h, m] = s.split(":").map(Number);
  const val = h + m / 60;
  return val >= 0 && val <= 24 ? val : null;
}

export default function CalendarTab() {
  const {
    data: appts = [],
    isLoading,
    isRefetching,
    refetch,
    error,
  } = useAppointments();
  const qc = useQueryClient();
  const { data: clients = [] } = useClients();
  const { data: services = [] } = useServices();
  const {
    data: teams = [],
    isLoading: teamsLoading,
    isFetching: teamsFetching,
    isError: teamsError,
    refetch: refetchTeams,
  } = useTeams();
  const { data: calSettings } = useCalendarSettings();
  const updateAppt = useUpdateAppointment();
  const createTeam = useCreateTeam();
  const toast = useToast();
  const t = useThemeColors();

  // Pull-to-refresh (agenda list). Invalidates the shared ['appointments']
  // key so the query refetches from the repo (authoritative, network-fresh —
  // reads bypass the SWR warm-cache branch, so this actually updates the UI);
  // the per-client appointment hooks share that key and refresh in lockstep.
  const onRefresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["appointments"] });
  }, [qc]);

  const reschedule = (apt: Appointment, newStart: string, newEnd: string) => {
    if (apt.time_start === newStart) return;
    // Виртуальное вхождение повтора двигать нельзя — правится только seed
    // (id виртуала синтетический, мутация по нему невалидна).
    if ((apt as { virtualParentId?: string }).virtualParentId) {
      toast("Повтор события — измените исходную запись");
      return;
    }
    // Дабл-букинг бригады — предупреждаем, но НЕ блокируем (web parity:
    // findOverlap перед записью; диспетчер иногда ставит внахлёст сознательно).
    const clash = findOverlap(
      { ...apt, time_start: newStart, time_end: newEnd },
      visibleAppts,
    );
    updateAppt.mutate(
      { id: apt.id, patch: { time_start: newStart, time_end: newEnd } },
      {
        onSuccess: () =>
          toast(
            clash
              ? `Перенесено. Пересечение с ${clash.time_start}–${clash.time_end}`
              : `Перенесено на ${newStart}`,
          ),
        onError: () => toast("Не удалось перенести"),
      },
    );
  };

  const router = useRouter();
  const params = useLocalSearchParams<{
    new?: string;
    clientId?: string;
    locationId?: string;
    teamId?: string;
    date?: string;
  }>();

  // Вид и команда переживают перезапуск (MMKV): владелец двух бригад в
  // «Неделе» не должен каждый старт возвращаться в «День» первой команды.
  // Дата сознательно НЕ персистится — холодный старт всегда «сегодня».
  // Дефолт для нового пользователя — «Неделя» (стандарт по решению
  // владельца 2026-07-13; дальше вид запоминается за пользователем).
  const [mode, setMode] = useState<CalMode>(() => {
    const saved = getStorage().get<{ mode?: CalMode }>(CAL_VIEW_KEY)?.mode;
    return saved === "day" || saved === "month" || saved === "agenda"
      ? saved
      : "week";
  });
  // «Сегодня» устройства может отличаться от бизнес-таймзоны бригады (ночь
  // у владельца ≠ ночь бригады): пока пользователь не тронул дату, один раз
  // перепривязываем якорь к бизнес-сегодня, как только таймзона резолвится.
  const seedYmdRef = useRef<string | null>(null);
  // ЕДИНЫЙ якорь даты для всех видов (web parity: один currentMonday).
  // Раньше было два стейта (day + cursor месяца) — они рассинхронивались:
  // свайп месяца двигал только cursor, выбор дня — только day, и переход
  // Месяц↔День «прыгал» на устаревшую дату. Месяц теперь ДЕРИВАТ от day.
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const monthAnchor = useMemo(() => startOfMonth(day), [day]);
  // Pixels-per-hour for the time grid — pinch-to-zoom (session-only, web
  // parity: web resets zoom on reload too). Shared by Day + Week grids.
  // The LIVE value is the shared value (mutated on the UI thread by the
  // pinch, zero re-renders mid-gesture); the state mirror commits once per
  // gesture so render-time derivations (block text fit) catch up.
  const hourHSv = useSharedValue(HOUR_H_DEFAULT);
  const [hourH, setHourH] = useState(HOUR_H_DEFAULT);
  // Web parity (Header.tsx): exactly one team calendar is active at a time —
  // no «all teams» view. `teamChoice` remembers the user's pick; the derived
  // `activeTeamId` falls back to the first team until they choose and
  // re-anchors if the chosen team is deleted / deactivated.
  const [teamChoice, setTeamChoice] = useState<string | null>(
    () => getStorage().get<{ teamId?: string | null }>(CAL_VIEW_KEY)?.teamId ?? null,
  );
  useEffect(() => {
    getStorage().set(CAL_VIEW_KEY, { mode, teamId: teamChoice });
  }, [mode, teamChoice]);
  const [miniCalOpen, setMiniCalOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // First-run onboarding card — session-only dismissal (web persists to
  // localStorage, STORY-060 §F1.1; the card self-clears once data appears).
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [bookDefaults, setBookDefaults] = useState<
    {
      date?: string;
      time_start?: string;
      client_id?: string | null;
      location_id?: string | null;
      team_id?: string | null;
    } | undefined
  >(undefined);

  // Active team calendar. Derived (not stored) so it self-heals: falls back
  // to the first team until the user picks one, and re-anchors if the chosen
  // team disappears. Null only while there are no teams (→ first-run gate).
  const activeTeamId =
    teamChoice && teams.some((tm) => tm.id === teamChoice)
      ? teamChoice
      : teams[0]?.id ?? null;
  const activeTeam = teams.find((tm) => tm.id === activeTeamId);

  // «Now» in the BUSINESS timezone, ticked every minute so the now-line /
  // past-wash / isToday stay live while the screen is open — including
  // across midnight. Per-brigade timezone wins over the global setting
  // (web parity: activeBrigadeTimezone, dashboard/page.tsx:752-756).
  const timezone = activeTeam?.timezone ?? calSettings?.timezone;
  const readNow = useCallback(
    () => (timezone ? getCurrentTimeInZone(timezone) : getCurrentCyprusTime()),
    [timezone],
  );
  const [now, setNow] = useState(readNow);
  useEffect(() => {
    setNow(readNow());
    const id = setInterval(() => setNow(readNow()), 60000);
    return () => clearInterval(id);
  }, [readNow]);
  const todayYmd = formatYMD(now);
  const tomorrowYmd = formatYMD(addDays(now, 1));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // Перепривязка стартового дня к бизнес-сегодня (см. seedYmdRef выше).
  // Ждём, пока таймзона резолвится (todayYmd разойдётся с сидом), но
  // отключаемся навсегда, как только пользователь сам ушёл с сида.
  if (seedYmdRef.current === null) seedYmdRef.current = formatYMD(day);
  useEffect(() => {
    const seed = seedYmdRef.current;
    if (!seed) return;
    if (formatYMD(day) !== seed) {
      seedYmdRef.current = "";
      return;
    }
    if (todayYmd !== seed) {
      seedYmdRef.current = "";
      setDay(startOfDay(parseYMD(todayYmd)));
    }
  }, [todayYmd, day]);

  useEffect(() => {
    if (params.new === "1") {
      setEditing(null);
      // ?date= вместе с new=1 (возвраты: «Записать» на дату ТО) — префилл
      // даты черновика; валидируем формат, мусор не пускаем (web parity).
      const draftDate =
        params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
          ? params.date
          : undefined;
      setBookDefaults({
        client_id: params.clientId ?? null,
        // «Записать сюда» / «Записать ТО» с карточки клиента шлют объект —
        // предвыбираем его в шите (LOCKED «Карта-диспетчер»: букинг в 2 тапа).
        location_id: params.locationId ?? null,
        team_id: params.teamId ?? null,
        ...(draftDate ? { date: draftDate } : {}),
      });
      setSheetOpen(true);
      router.setParams({
        new: undefined,
        clientId: undefined,
        locationId: undefined,
        teamId: undefined,
        date: undefined,
      });
    } else if (params.date) {
      // Переход по дате (карточка клиента, визиты мастера) = «покажи этот
      // день»: открываем именно День (web ?view=day&date= parity).
      const d = parseYMD(params.date);
      setDay(startOfDay(d));
      setMode("day");
      router.setParams({ date: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.new, params.clientId, params.date]);

  const nameById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.full_name])),
    [clients],
  );
  const clientName = (a: Appointment) =>
    a.client_id ? nameById.get(a.client_id) ?? "" : "";

  const serviceNameById = useMemo(
    () => new Map(services.map((s) => [s.id, s.name])),
    [services],
  );
  // «Чистка, x2 Диагностика» — web AgendaView service summary.
  const serviceSummaryFor = useCallback(
    (a: Appointment) => {
      const qty = new Map<string, number>();
      for (const id of a.service_ids) qty.set(id, (qty.get(id) ?? 0) + 1);
      return [...qty.entries()]
        .map(([id, q]) => {
          const name = serviceNameById.get(id) ?? "Услуга";
          return q > 1 ? `x${q} ${name}` : name;
        })
        .join(", ");
    },
    [serviceNameById],
  );
  const serviceLabel = useCallback(
    (a: Appointment) => serviceSummaryFor(a) || a.comment || null,
    [serviceSummaryFor],
  );

  const teamColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const tm of teams as { id: string; color?: string | null }[]) {
      if (tm.color) m.set(tm.id, tm.color);
    }
    return m;
  }, [teams]);
  const teamColorFor = useCallback(
    (a: Appointment) => (a.team_id ? teamColor.get(a.team_id) ?? null : null),
    [teamColor],
  );

  // ─── Метки дней (web parity: city pill в шапке дня) ─────────────────
  const { data: cities = [] } = useCities();
  const { data: dayCities = {} } = useDayCities();
  const setDayCityMut = useSetDayCity();
  // Дата, чью метку правим (null = пикер закрыт): шапка Дня открывает свой
  // день, тап по дате в Неделе — свою (долгое нажатие там открывает день).
  const [cityPickerYmd, setCityPickerYmd] = useState<string | null>(null);
  // Разбор финансов дня по тапу на футер Доход/Расход (null = закрыт).
  const [finModalYmd, setFinModalYmd] = useState<string | null>(null);
  // Date-label resolver: explicit (day_cities) → team default_city (web
  // getCityFor parity). Shared by the day-header pill, the week header
  // pills and the label-tint column wash below.
  const labelFor = useCallback(
    (dateYmd: string): { name: string; color: string } | null => {
      if (!activeTeamId) return null;
      const name =
        dayCities[dayCityKey(activeTeamId, dateYmd)] ??
        activeTeam?.default_city ??
        "";
      if (!name) return null;
      return {
        name,
        color: cities.find((c) => c.name === name)?.color ?? t.accent,
      };
    },
    [activeTeamId, activeTeam?.default_city, dayCities, cities, t.accent],
  );
  // Phase I38 web parity — есть ли у бригады вообще метки (default_city или
  // список меток). Нет → чип и тап по шапке скрыты полностью, никаких
  // «+ метка»; метки заводятся в настройках команды.
  const hasLabels = Boolean(
    activeTeam?.default_city?.trim() ||
      (activeTeam ? teamCities(activeTeam).length > 0 : false),
  );
  // Label tint — the label colour washes the day columns very lightly (web
  // DayColumn tintByLabel, Phase I41). The brigade «Метки» setting
  // team.tint_days_by_label (default on) drops the resolver entirely.
  const labelTintFor = useMemo(() => {
    if (!(activeTeam?.tint_days_by_label ?? true)) return undefined;
    return (dateYmd: string) => labelFor(dateYmd)?.color ?? null;
  }, [activeTeam?.tint_days_by_label, labelFor]);
  // Web CityPickerModal pickerList: активные метки справочника, суженные до
  // меток бригады, когда они заданы; пустой список бригады при заданном
  // default_city → весь активный справочник (web parity).
  const labelOptions = useMemo(() => {
    const source = cities
      .filter((c) => c.is_active)
      .map((c) => ({ name: c.name, color: c.color ?? t.accent }));
    const brigade = activeTeam ? teamCities(activeTeam) : [];
    return brigade.length > 0
      ? source.filter((c) => brigade.includes(c.name))
      : source;
  }, [activeTeam, cities, t.accent]);

  // Скрывать отменённые: настройка бригады побеждает глобальную (web
  // parity: dashboard/page.tsx:1613 `activeTeam?.hide_cancelled ?? …`).
  const hideCancelled =
    activeTeam?.hide_cancelled ?? !!calSettings?.hideCancelled;
  const byTeam = (a: Appointment) =>
    (activeTeamId ? a.team_id === activeTeamId : true) &&
    (!hideCancelled || a.status !== "cancelled");

  // Web parity (dashboard/page.tsx, STORY-091): recurring seeds expand into
  // virtual occurrences inside a −30/+60-day window around the visible
  // anchor (month cursor in month mode, focused day otherwise). Virtuals
  // carry virtualParentId — openEdit routes their tap back to the seed.
  const expandAnchor = day;
  const expandedAppts = useMemo(() => {
    const fromKey = formatYMD(addDays(expandAnchor, -30));
    const toKey = formatYMD(addDays(expandAnchor, 60));
    const out: Appointment[] = [];
    for (const a of appts) {
      const rule = a.event_repeat;
      if (!rule || rule.kind === "none") out.push(a);
      else out.push(...expandRepeat(a, fromKey, toKey));
    }
    return out;
  }, [appts, expandAnchor]);

  // Team-scoped set — MonthView counts every visible cell (incl. the
  // prev/next-month tails) and the MiniCalendar dots from this.
  const visibleAppts = useMemo(
    () => expandedAppts.filter(byTeam),
    [expandedAppts, activeTeamId, hideCancelled],
  );

  const dayYmd = formatYMD(day);
  const dayAppts = useMemo(
    () => visibleAppts.filter((a) => a.date === dayYmd),
    [visibleAppts, dayYmd],
  );
  // Резолвер «записи дня» для страниц пейджера (prev/cur/next день или
  // неделя) — окно visibleAppts (−30/+60д вокруг якоря) покрывает соседей.
  const apptsByDate = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of visibleAppts) {
      const arr = m.get(a.date) ?? [];
      arr.push(a);
      m.set(a.date, arr);
    }
    return m;
  }, [visibleAppts]);
  const apptsFor = useCallback(
    (ymd: string) => apptsByDate.get(ymd) ?? [],
    [apptsByDate],
  );
  // Записи бизнес-СЕГОДНЯ (не просматриваемого дня) — вечерний баннер долгов.
  const todayAppts = useMemo(
    () => apptsByDate.get(todayYmd) ?? [],
    [apptsByDate, todayYmd],
  );

  const weekDays = useMemo(() => {
    const mon = mondayOf(day);
    return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  }, [day]);
  const weekYmds = useMemo(() => weekDays.map(formatYMD), [weekDays]);
  const weekAppts = useMemo(
    () => visibleAppts.filter((a) => weekYmds.includes(a.date)),
    [visibleAppts, weekYmds],
  );

  // Agenda — «what's next»: from the selected day forward 60 days
  // (web AgendaView HORIZON_DAYS), not the cursor month.
  const agendaSections = useMemo(() => {
    const startKey = formatYMD(day);
    const endKey = formatYMD(addDays(day, AGENDA_HORIZON_DAYS));
    const filtered = visibleAppts
      .filter((a) => a.date >= startKey && a.date <= endKey)
      .sort((a, b) =>
        a.date !== b.date
          ? a.date.localeCompare(b.date)
          : a.time_start.localeCompare(b.time_start),
      );
    const byDate = new Map<string, Appointment[]>();
    for (const a of filtered) {
      const arr = byDate.get(a.date) ?? [];
      arr.push(a);
      byDate.set(a.date, arr);
    }
    return [...byDate.entries()].map(([d, data]) => ({ title: d, data }));
  }, [visibleAppts, day]);

  const openCreate = (defaults?: typeof bookDefaults) => {
    setEditing(null);
    // New records belong to the team calendar currently open (web parity:
    // creating in team X's calendar sets team_id = X). An explicit team from
    // a card booking still wins via the spread.
    setBookDefaults({ team_id: activeTeamId, ...defaults });
    setSheetOpen(true);
  };

  // First-run gate CTA — spins up the first team calendar (web parity:
  // /dashboard/teams?new=1 immediately creates a team). Default name +
  // first unused palette colour; the gear → team hub renames / configures.
  const createFirstCalendar = () => {
    const used = new Set(
      (teams as { color?: string | null }[]).map((tm) => tm.color).filter(Boolean),
    );
    const color =
      TEAM_COLORS.find((c) => !used.has(c.value))?.value ?? TEAM_COLORS[0].value;
    createTeam.mutate(
      { name: "Команда 1", color },
      {
        onSuccess: (team) => {
          setTeamChoice(team.id);
          toast("Календарь создан");
        },
        onError: () => toast("Не удалось создать календарь"),
      },
    );
  };
  const openEdit = (apt: Appointment) => {
    // Виртуальное вхождение повтора редактируем через его seed-запись —
    // у виртуала синтетический id, мутации по нему невалидны (web parity).
    const parentId = (apt as { virtualParentId?: string }).virtualParentId;
    setEditing(parentId ? appts.find((a) => a.id === parentId) ?? apt : apt);
    setBookDefaults(undefined);
    setSheetOpen(true);
  };

  const headerTitle = (
    mode === "week" ? weekDays[3] : mode === "month" ? monthAnchor : day
  )
    .toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
    .replace(/\s*г\.?\s*$/i, "");

  const isOnToday =
    mode === "month"
      ? monthAnchor.getFullYear() === now.getFullYear() &&
        monthAnchor.getMonth() === now.getMonth()
      : mode === "week"
        ? weekYmds.includes(todayYmd)
        : dayYmd === todayYmd;

  const goToday = () => setDay(startOfDay(now));
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
  const openDayFromMonth = useCallback((d: Date) => {
    setDay(startOfDay(d));
    setMode("day");
  }, []);

  // Visible grid window: the active team's calendar_window_start/end wins,
  // else global settings.startHour/endHour (web parity: windowBounds,
  // dashboard/page.tsx:562-581). The mobile rail is integer-hour, so a
  // «06:30» window widens outward to whole hours (floor/ceil) — a safe
  // superset of web's fractional window. workStartHour/EndHour (or the
  // team schedule below) only paint the grey off-hours wash.
  const visStartHour = Math.max(
    0,
    Math.min(
      23,
      Math.floor(
        parseHourHM(activeTeam?.calendar_window_start) ??
          calSettings?.startHour ??
          0,
      ),
    ),
  );
  const visEndHour = Math.max(
    visStartHour + 1,
    Math.min(
      24,
      Math.ceil(
        parseHourHM(activeTeam?.calendar_window_end) ??
          calSettings?.endHour ??
          24,
      ),
    ),
  );
  // «Открывать на»: командное default_scroll_time побеждает глобальный
  // scrollOpenHour → workStartHour (web parity: dashboard/page.tsx:807-829,
  // brigade override wins unconditionally).
  const scrollToHour =
    parseHourHM(activeTeam?.default_scroll_time) ??
    calSettings?.scrollOpenHour ??
    calSettings?.workStartHour ??
    9;
  // Буфер после каждой записи (дорога/уборка): team ?? global ?? 0 (web
  // parity: dashboard/page.tsx:1615), лента рисуется в DayColumn.
  const bufferMinutes =
    activeTeam?.buffer_minutes ?? calSettings?.bufferMinutes ?? 0;

  // Рабочие часы бригады по датам (team_schedules: weekday/date overrides,
  // vacations) — web DayColumn.tsx:231 resolves per date via the shared
  // getDayScheduleForDate. null = нерабочий день → колонка без wash (web
  // v473: day-off body stays plain); undefined (нет строки расписания /
  // мусор в HH:MM) → фолбэк на глобальные workStartHour/EndHour в колонке.
  const { data: teamSchedule } = useTeamSchedule(activeTeamId ?? undefined);
  const workBandFor = useMemo(() => {
    if (!teamSchedule) return undefined;
    return (dateYmd: string): WorkBand | null | undefined => {
      const sched = getDayScheduleForDate(teamSchedule, parseYMD(dateYmd));
      if (!sched.is_working) return null;
      const start = parseHourHM(sched.start);
      const end = parseHourHM(sched.end);
      if (start == null || end == null || end <= start) return undefined;
      // Перерывы бригады (обед и т.п.) — серые полосы на сетке, чтобы
      // диспетчер не записывал клиента на обед (web DayColumn breaks).
      const breaks = sched.breaks
        .map((b) => {
          const bs = parseHourHM(b.start);
          const be = parseHourHM(b.end);
          return bs != null && be != null && be > bs
            ? { startMin: Math.round(bs * 60), endMin: Math.round(be * 60) }
            : null;
        })
        .filter((b): b is { startMin: number; endMin: number } => b !== null);
      return {
        startMin: Math.round(start * 60),
        endMin: Math.round(end * 60),
        breaks,
      };
    };
  }, [teamSchedule]);

  const gridProps = {
    clientName,
    serviceLabel,
    teamColorFor,
    onEdit: openEdit,
    onReschedule: reschedule,
    startHour: visStartHour,
    endHour: visEndHour,
    // «Шаг сетки» (15/30/60) — drives drag snapping and empty-slot taps,
    // like the web DayColumn snapMinutes.
    stepMinutes: calSettings?.gridStep ?? 30,
    workStartHour: calSettings?.workStartHour,
    workEndHour: calSettings?.workEndHour,
    workBandFor,
    labelTintFor,
    bufferMinutes,
    nowMinutes,
    scrollToHour,
    hourH,
    hourHSv,
    // Коммит зума — низким приоритетом: полный ре-рендер сетки на отпускании
    // щипка давал видимый «прыжок» кадра (жалоба владельца). Живая геометрия
    // и так на UI-потоке; здесь догоняют только «холодные» слои (текст-фит).
    onZoom: (v: number) => startTransition(() => setHourH(v)),
  };

  const pickDay = (d: Date) => {
    setDay(startOfDay(d));
    setMode("day");
  };

  // First-run gate (web parity: dashboard/page.tsx). No team calendar yet →
  // show the «Создать календарь» screen instead of an empty grid. Hold on a
  // spinner while teams load / the just-created team round-trips so the CTA
  // never flashes back after a successful create.
  if (teams.length === 0) {
    // Сетевой сбой ≠ «команд нет»: настроенному тенанту нельзя показывать
    // «Создать календарь» из-за упавшего запроса (риск дубля команды).
    return (
      <Screen>
        {teamsLoading ? (
          <EmptyState state="loading" fill />
        ) : teamsError ? (
          <EmptyState
            state="error"
            fill
            action={{ label: "Повторить", onPress: () => void refetchTeams() }}
          />
        ) : (
          <FirstRunCalendarChoice
            onCreate={createFirstCalendar}
            creating={createTeam.isPending || teamsFetching}
          />
        )}
      </Screen>
    );
  }

  return (
    // No bottom safe-area edge here: inside expo-router Tabs the tab bar
    // already consumes it, so a bottom inset double-counts and floats the
    // Доход/Расход footer ~34pt above the tab bar. Drop it → footer sits flush.
    <Screen edges={["top", "left", "right"]}>
      <CalendarHeader
        monthTitle={headerTitle}
        mode={mode}
        todayNumber={now.getDate()}
        isOnToday={isOnToday}
        onModeChange={setMode}
        // Web parity (Header.tsx): календарь = команда, шестерёнка ведёт в
        // полноценные настройки открытой команды; без команд — в список.
        onGear={() =>
          router.push(
            activeTeamId ? `/cabinet/teams/${activeTeamId}` : "/cabinet/teams",
          )
        }
        onTitlePress={() => setMiniCalOpen(true)}
        onToday={goToday}
      />
      <TeamChips teams={teams} activeId={activeTeamId} onSelect={setTeamChoice} />

      {isLoading ? (
        <CalendarSkeleton />
      ) : error ? (
        <EmptyState state="error" fill subtitle={(error as Error).message} />
      ) : mode === "agenda" ? (
        <AgendaView
          sections={agendaSections}
          todayYmd={todayYmd}
          tomorrowYmd={tomorrowYmd}
          horizonDays={AGENDA_HORIZON_DAYS}
          clientName={clientName}
          serviceSummary={serviceSummaryFor}
          onEdit={openEdit}
          onCreateNew={() => openCreate()}
          refreshing={isRefetching}
          onRefresh={onRefresh}
        />
      ) : mode === "week" ? (
        <>
          <View className="flex-1">
            <WeekView
              days={weekDays}
              apptsFor={apptsFor}
              today={now}
              labelFor={hasLabels ? labelFor : undefined}
              onCreateAt={(d, timeStart) =>
                openCreate({ date: d, time_start: timeStart })
              }
              onPickDay={pickDay}
              onPickLabelDay={
                hasLabels && activeTeamId
                  ? (ymd) => setCityPickerYmd(ymd)
                  : undefined
              }
              onCommitPage={(dir) => setDay((d) => addDays(d, dir * 7))}
              {...gridProps}
            />
          </View>
          <DayFinanceFooter
            days={weekDays}
            appointments={weekAppts}
            teamId={activeTeamId}
            todayYmd={todayYmd}
            onTapDay={(d) => setFinModalYmd(formatYMD(d))}
          />
        </>
      ) : mode === "day" ? (
        <>
          {/* «Утренний взгляд» — сводка просматриваемого дня (web parity). */}
          <DaySummaryStrip
            appointments={dayAppts}
            onUnpaidTap={() => router.push("/cabinet/unclosed")}
          />
          <View className="flex-1">
            <DayView
              dateYmd={dayYmd}
              apptsFor={apptsFor}
              todayYmd={todayYmd}
              labelFor={hasLabels ? labelFor : undefined}
              onDayLabelTap={
                hasLabels && activeTeamId
                  ? () => setCityPickerYmd(dayYmd)
                  : undefined
              }
              onCreateAt={(d, timeStart) =>
                openCreate({ date: d, time_start: timeStart })
              }
              onCommitPage={(dir) => setDay((d) => addDays(d, dir))}
              {...gridProps}
            />
          </View>
          <DayFinanceFooter
            days={[day]}
            appointments={dayAppts}
            teamId={activeTeamId}
            todayYmd={todayYmd}
            onTapDay={(d) => setFinModalYmd(formatYMD(d))}
          />
        </>
      ) : (
        <GestureDetector gesture={monthPager.pan}>
          <View className="flex-1">
            <PagedStrip
              pager={monthPager}
              renderPage={(off) => (
                <MonthView
                  month={monthPages[off + 1]}
                  appointments={visibleAppts}
                  teamId={activeTeamId}
                  todayYmd={todayYmd}
                  onPickDay={openDayFromMonth}
                />
              )}
            />
          </View>
        </GestureDetector>
      )}

      {/* First-run onboarding — web CalendarOnboardingCard (STORY-060 §F1.1):
          floats over the grid for a truly fresh tenant (0 clients, 0 services,
          0 appointments); box-none overlay keeps everything around tappable. */}
      {!onboardingDismissed &&
      !isLoading &&
      !error &&
      clients.length === 0 &&
      services.length === 0 &&
      appts.length === 0 ? (
        <CalendarOnboardingCard
          onDismiss={() => setOnboardingDismissed(true)}
        />
      ) : null}

      {/* Вечерний контроль денег: после 18:00 выполненные СЕГОДНЯ с долгом
          (web EndOfDayBanner) — плавающая карточка над футером. */}
      <EndOfDayBanner
        appointments={todayAppts}
        todayYmd={todayYmd}
        nowHour={now.getHours()}
        onOpenUnpaid={() => router.push("/cabinet/unclosed")}
      />

      {/* Разбор финансов дня — тап по футеру Доход/Расход. */}
      <DayFinanceModal
        dateYmd={finModalYmd}
        appointments={finModalYmd ? apptsFor(finModalYmd) : []}
        teamId={activeTeamId}
        onClose={() => setFinModalYmd(null)}
      />

      {/* Пикер метки дня — центрированная карточка (web CityPickerModal);
          тап по активной строке снимает метку. Целевую дату задаёт
          открывшая шапка (День — свой день, Неделя — тапнутая дата). */}
      <CityPickerModal
        visible={cityPickerYmd != null}
        dateKey={cityPickerYmd ?? todayYmd}
        options={labelOptions}
        selected={
          activeTeamId && cityPickerYmd
            ? dayCities[dayCityKey(activeTeamId, cityPickerYmd)] ?? ""
            : ""
        }
        onPick={(name) => {
          if (activeTeamId && cityPickerYmd) {
            setDayCityMut.mutate({
              teamId: activeTeamId,
              date: cityPickerYmd,
              city: name,
            });
          }
          setCityPickerYmd(null);
        }}
        onClear={() => {
          if (activeTeamId && cityPickerYmd) {
            setDayCityMut.mutate({
              teamId: activeTeamId,
              date: cityPickerYmd,
              city: "",
            });
          }
          setCityPickerYmd(null);
        }}
        onClose={() => setCityPickerYmd(null)}
        onSettings={
          activeTeamId
            ? () => {
                setCityPickerYmd(null);
                router.push(`/cabinet/teams/${activeTeamId}/cities`);
              }
            : undefined
        }
      />

      <MiniCalendar
        visible={miniCalOpen}
        currentDate={day}
        todayYmd={todayYmd}
        appointments={visibleAppts}
        onSelectDate={jumpToDate}
        onClose={() => setMiniCalOpen(false)}
      />

      <AppointmentSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        appointment={editing}
        defaults={bookDefaults}
      />
    </Screen>
  );
}
