import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActionSheetIOS, Linking, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { GestureDetector } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { useLocalSearchParams, useRouter } from "expo-router";
import type {
  Appointment,
  AppointmentKind,
} from "@babun/shared/local/appointments";
import {
  duplicateAppointment,
  getDebtAmount,
} from "@babun/shared/local/appointments";
import { deleteAutoIncomeForAppointment } from "@babun/shared/db/repositories/finance-transactions";
import { supabase } from "@/lib/supabase";
import { formatEUR } from "@babun/shared/common/utils/money";
import { randomUuid } from "@babun/shared/sync";
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
import {
  buildDebtPaidPatch,
  PAY_METHOD_LABELS,
  type PayMethod,
} from "@/features/appointments/payment";
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
import { RescheduleSheet } from "@/features/calendar/RescheduleSheet";
import { SlotConfirmPopup } from "@/features/calendar/SlotConfirmPopup";
import { scheduleAppointmentReminder } from "@/features/calendar/reminders";
import { useAppointments } from "@/features/calendar/queries";
import {
  useCreateAppointment,
  useDeleteAppointment,
  useUpdateAppointment,
} from "@/features/calendar/mutations";
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
import { haptics } from "@/lib/haptics";
import { useTeamSchedule } from "@/features/reference/team-schedule";
import { getDayScheduleForDate } from "@babun/shared/local/schedule";
import { TEAM_COLORS } from "@babun/shared/local/masters";

// Agenda horizon — web AgendaView parity («what's next», not «this month»).
const AGENDA_HORIZON_DAYS = 60;
// Персист выбранного вида и команды (mode/teamId) между запусками.
const CAL_VIEW_KEY = "calendar.view";
// Онбординг-карточка: «✕» переживает перезапуск (web parity: localStorage).
const ONBOARDING_DISMISSED_KEY = "calendar.onboardingDismissed";
// Сентинел «метка явно снята» в day_cities (web v693): день с ним НЕ падает
// обратно на default_city бригады — пустая строка удалила бы override, и
// дефолт перекрасил бы день на следующем рендере.
const CITY_CLEARED = "__NONE__";

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
  // key so the query refetches from the repo; the per-client appointment
  // hooks share that key and refresh in lockstep. The promise is returned
  // so RefreshControl keeps spinning until the refetch actually settles —
  // a fire-and-forget invalidate dropped the spinner on a warm cache
  // before fresh data arrived.
  const onRefresh = useCallback(
    () => qc.invalidateQueries({ queryKey: ["appointments"] }),
    [qc],
  );

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
    // Перерыв / нерабочие часы бригады — то же «предупредить, не блокировать»:
    // диспетчер иногда сознательно ставит до открытия или в обед.
    const toMin = (s: string) => {
      const [h, m] = s.split(":").map(Number);
      return h * 60 + m;
    };
    const startMin = toMin(newStart);
    const endMin = toMin(newEnd);
    const band = workBandFor?.(apt.date);
    const bandWarn =
      band === null
        ? "Нерабочий день бригады"
        : band?.breaks?.some((b) => startMin < b.endMin && endMin > b.startMin)
          ? "Попадает на перерыв"
          : band && (startMin < band.startMin || endMin > band.endMin)
            ? "Вне рабочих часов"
            : null;
    const warn = clash
      ? `Пересечение с ${clash.time_start}–${clash.time_end}`
      : bandWarn;
    updateAppt.mutate(
      { id: apt.id, patch: { time_start: newStart, time_end: newEnd } },
      {
        onSuccess: () => {
          // Физический «удар» на успешное приземление drag-переноса —
          // блок лёг на слот, рука это чувствует.
          haptics.impact();
          toast(warn ? `Перенесено. ${warn}` : `Перенесено на ${newStart}`);
        },
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
    services?: string; // CSV service-id — префилл услуг («Повторить», ТО)
    kind?: string; // AppointmentKind черновика
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
  // First-run onboarding card — «✕» persists across restarts in MMKV
  // (web parity: localStorage, STORY-060 §F1.1; the card also self-clears
  // once data appears).
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => getStorage().get<boolean>(ONBOARDING_DISMISSED_KEY) ?? false,
  );
  const dismissOnboarding = () => {
    getStorage().set(ONBOARDING_DISMISSED_KEY, true);
    setOnboardingDismissed(true);
  };
  const [editing, setEditing] = useState<Appointment | null>(null);
  // «Перенести» из контекстного меню — запись в шите переноса (null = закрыт).
  const [reschedulingApt, setReschedulingApt] = useState<Appointment | null>(
    null,
  );
  const [bookDefaults, setBookDefaults] = useState<
    {
      date?: string;
      time_start?: string;
      client_id?: string | null;
      location_id?: string | null;
      team_id?: string | null;
      service_ids?: string[];
      kind?: AppointmentKind;
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
    const clearParams = () =>
      router.setParams({
        new: undefined,
        clientId: undefined,
        locationId: undefined,
        teamId: undefined,
        date: undefined,
        services: undefined,
        kind: undefined,
      });
    // Гонка с загрузкой команд: на холодном старте по диплинку teams=[]
    // ещё «не знает» ответа — гасить параметры рано (визит с карточки
    // молча пропадал). Ждём резолва: эффект перезапустится по
    // teamsLoading/teams и обработает параметры уже с данными.
    if (teamsLoading || teamsError) return;
    if (params.new === "1") {
      // Без единой команды шит бессмысленен (стейл-дефолты), а экран занят
      // first-run гейтом «Создать календарь» — параметры просто гасим.
      if (teams.length === 0) {
        clearParams();
        return;
      }
      setEditing(null);
      // ?date= вместе с new=1 (возвраты: «Записать» на дату ТО) — префилл
      // даты черновика; валидируем формат, мусор не пускаем (web parity).
      const draftDate =
        params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
          ? params.date
          : undefined;
      // Букинг в чужую бригаду («Записать» с карточки): активируем её
      // календарь, чтобы созданная запись не «пропала» из виду.
      if (params.teamId && teams.some((tm) => tm.id === params.teamId)) {
        setTeamChoice(params.teamId);
      }
      // ?services= (CSV id) / ?kind= — префилл услуг и типа черновика
      // («Повторить визит», «Записать ТО» шлют состав прошлой записи).
      const serviceIds = params.services?.split(",").filter(Boolean);
      const draftKind: AppointmentKind | undefined =
        params.kind === "work" ||
        params.kind === "event" ||
        params.kind === "personal"
          ? params.kind
          : undefined;
      setBookDefaults({
        client_id: params.clientId ?? null,
        // «Записать сюда» / «Записать ТО» с карточки клиента шлют объект —
        // предвыбираем его в шите (LOCKED «Карта-диспетчер»: букинг в 2 тапа).
        location_id: params.locationId ?? null,
        team_id: params.teamId ?? null,
        ...(draftDate ? { date: draftDate } : {}),
        ...(serviceIds?.length ? { service_ids: serviceIds } : {}),
        ...(draftKind ? { kind: draftKind } : {}),
      });
      setSheetOpen(true);
      clearParams();
    } else if (params.date) {
      // Переход по дате (карточка клиента, визиты мастера) = «покажи этот
      // день»: открываем именно День (web ?view=day&date= parity).
      const d = parseYMD(params.date);
      setDay(startOfDay(d));
      setMode("day");
      // ?teamId= — бригада записи: без переключения визит чужой бригады
      // открывал бы пустой день активной команды.
      if (params.teamId && teams.some((tm) => tm.id === params.teamId)) {
        setTeamChoice(params.teamId);
      }
      router.setParams({ date: undefined, teamId: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.new, params.clientId, params.date, params.teamId, teamsLoading, teamsError, teams]);

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
      const assigned = dayCities[dayCityKey(activeTeamId, dateYmd)];
      // Сентинел CITY_CLEARED = «метка явно снята» — БЕЗ отката на
      // default_city (web getCityFor, DashboardClientLayout v693).
      if (assigned === CITY_CLEARED) return null;
      const name = assigned ?? activeTeam?.default_city ?? "";
      if (!name) return null;
      // Фолбэк цвета — нейтральный серый, НЕ accent: кобальтовая кромка
      // метки сливалась с кругом «сегодня» и читалась как второй маркер.
      return {
        name,
        color: cities.find((c) => c.name === name)?.color ?? t.faint,
      };
    },
    [activeTeamId, activeTeam?.default_city, dayCities, cities, t.faint],
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
  // Записи активного календаря. Личные события без бригады (team_id null,
  // kind ≠ work) видны в ЛЮБОМ календаре: у мобильного нет веб-таба «Мой
  // календарь» (web page.tsx:914-936 — personal tab = «mine, by exclusion»),
  // и без этого правила они не были бы видны нигде.
  const inTeamCal = useCallback(
    (a: Appointment) =>
      activeTeamId
        ? a.team_id === activeTeamId || (a.team_id == null && a.kind !== "work")
        : true,
    [activeTeamId],
  );
  const byTeam = (a: Appointment) =>
    inTeamCal(a) && (!hideCancelled || a.status !== "cancelled");

  // Web parity (dashboard/page.tsx, STORY-091): recurring seeds expand into
  // virtual occurrences inside a window around the visible anchor. В режиме
  // «Месяц» пейджер держит соседние страницы целиком, поэтому окно покрывает
  // prev/next месяцы (+ недельные хвосты их сеток); в остальных видах —
  // −30/+60 дней вокруг якоря. includeCancelled: отменённая серия остаётся
  // видимой при выключенном «Скрывать отменённые» (byTeam выше сам фильтрует
  // по hideCancelled). Virtuals carry virtualParentId — openEdit routes
  // their tap back to the seed.
  const expandedAppts = useMemo(() => {
    const monthWindow = mode === "month";
    const fromKey = formatYMD(
      monthWindow
        ? addDays(new Date(day.getFullYear(), day.getMonth() - 1, 1), -7)
        : addDays(day, -30),
    );
    const toKey = formatYMD(
      monthWindow
        ? addDays(new Date(day.getFullYear(), day.getMonth() + 2, 0), 7)
        : addDays(day, 60),
    );
    const out: Appointment[] = [];
    for (const a of appts) {
      const rule = a.event_repeat;
      if (!rule || rule.kind === "none") out.push(a);
      else
        out.push(...expandRepeat(a, fromKey, toKey, { includeCancelled: true }));
    }
    return out;
  }, [appts, day, mode]);

  // Team-scoped set — MonthView counts every visible cell (incl. the
  // prev/next-month tails) and the MiniCalendar dots from this.
  const visibleAppts = useMemo(
    () => expandedAppts.filter(byTeam),
    [expandedAppts, inTeamCal, hideCancelled],
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
  const financeByDate = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of financeAppts) {
      const arr = m.get(a.date) ?? [];
      arr.push(a);
      m.set(a.date, arr);
    }
    return m;
  }, [financeAppts]);
  const financeFor = useCallback(
    (ymd: string) => financeByDate.get(ymd) ?? [],
    [financeByDate],
  );

  const dayYmd = formatYMD(day);
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
  // Финансы недельного футера — денежный набор (см. financeAppts выше).
  const financeWeekAppts = useMemo(
    () => financeAppts.filter((a) => weekYmds.includes(a.date)),
    [financeAppts, weekYmds],
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
  // Тап по свободному слоту идёт через пре-попап (web SlotConfirmPopup):
  // уточнить дату/время «тумблерами» и выбрать Клиент/Событие — полная
  // форма открывается уже с верным черновиком. Пути ?new=/агенды попап
  // обходят (web parity: FAB-путь без попапа).
  const [slotConfirm, setSlotConfirm] = useState<
    { date: string; time_start: string } | null
  >(null);

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

  // ─── Контекстное меню записи (долгое нажатие без движения) ──────────
  // Web parity ActionMenuModal (dashboard/page.tsx:1752): «только действия,
  // которыми реально пользуются». Нативный ActionSheetIOS — HIG-вид без
  // кастомного UI. Разрушаемые действия обратимы Undo-тостом.
  const createAppt = useCreateAppointment();
  const deleteAppt = useDeleteAppointment();

  const quickStatus = (apt: Appointment, status: Appointment["status"]) => {
    const prev = apt.status;
    const done =
      status === "completed"
        ? "Выполнена"
        : status === "in_progress"
          ? "В работе"
          : "Возвращена в план";
    updateAppt.mutate(
      { id: apt.id, patch: { status } },
      {
        onSuccess: () => {
          haptics.success();
          toast(done, "success", {
            label: "Отменить",
            onPress: () =>
              updateAppt.mutate({ id: apt.id, patch: { status: prev } }),
          });
        },
        onError: () => toast("Не удалось изменить статус", "error"),
      },
    );
  };

  const cancelToggle = (apt: Appointment) => {
    const to = apt.status === "cancelled" ? "scheduled" : "cancelled";
    const prev = apt.status;
    updateAppt.mutate(
      { id: apt.id, patch: { status: to } },
      {
        onSuccess: () => {
          haptics.success();
          toast(
            to === "cancelled" ? "Запись отменена" : "Запись восстановлена",
            "info",
            {
              label: "Отменить",
              onPress: () =>
                updateAppt.mutate({ id: apt.id, patch: { status: prev } }),
            },
          );
        },
        onError: () => toast("Не удалось изменить запись", "error"),
      },
    );
  };

  const deleteWithUndo = (apt: Appointment) => {
    // Снапшот до удаления: «Вернуть» ре-инсертит ту же запись с тем же id.
    const snapshot = { ...apt };
    deleteAppt.mutate(apt.id, {
      onSuccess: () => {
        // Warning, не success: удаление — разрушаемое действие, отклик
        // должен отличаться от «операция удалась».
        haptics.warning();
        toast("Запись удалена", "info", {
          label: "Вернуть",
          onPress: () =>
            createAppt.mutate(snapshot, {
              onError: () => toast("Не удалось вернуть", "error"),
            }),
        });
      },
      onError: () => toast("Не удалось удалить", "error"),
    });
  };

  // Быстрая оплата ОСТАТКА из контекстного меню — тот же полный платёжный
  // патч, что у карточки записи (buildDebtPaidPatch): пять зеркальных полей
  // сразу, иначе payment_status оставался "unpaid" (income в финансах не
  // создавался), а сумма брала полный total_amount, считая предоплату
  // второй раз. «Перевод» не предлагается: способ должны понимать все три
  // платёжных енума модели (см. payment.ts) — тот же выбор, что в шите.
  const openPaymentMenu = (apt: Appointment) => {
    const debt = getDebtAmount(apt);
    const methods = Object.keys(PAY_METHOD_LABELS) as PayMethod[];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: `Оплата ${formatEUR(debt)}`,
        options: [...methods.map((m) => PAY_METHOD_LABELS[m]), "Отмена"],
        cancelButtonIndex: methods.length,
      },
      (i) => {
        const method = methods[i];
        if (!method) return;
        // Undo возвращает ВСЕ платёжные поля, не только payments[] —
        // иначе «Отменить» оставлял запись «оплаченной» в зеркалах.
        // Значения-«до» коалесцируются к явным null/базам: patchToRow
        // отбрасывает undefined-ключи, и снапшот с undefined не очищал
        // бы paid_amount/payment на сервере — запись выглядела бы
        // оплаченной через фолбэк getPaidAmount. payment_method не
        // очищаем: тип патча null не выражает, а при payment_status
        // "unpaid" это инертная метка «последний способ».
        const prev = {
          status: apt.status,
          payments: apt.payments,
          payment: apt.payment ?? null,
          payment_status: apt.payment_status ?? ("unpaid" as const),
          ...(apt.payment_method ? { payment_method: apt.payment_method } : {}),
          paid_amount: apt.paid_amount ?? 0,
        };
        updateAppt.mutate(
          {
            id: apt.id,
            patch: {
              ...buildDebtPaidPatch(apt, { method, amount: debt }),
              status: "completed",
            },
          },
          {
            onSuccess: () => {
              haptics.success();
              toast(`Оплата ${formatEUR(debt)} принята`, "success", {
                label: "Отменить",
                onPress: () => {
                  updateAppt.mutate({ id: apt.id, patch: prev });
                  // Серверный триггер уже вставил auto-income, а ветки
                  // paid→unpaid у него нет — прибираем строку сами,
                  // иначе в финансах остаётся фантомный доход (и
                  // повторная оплата упёрлась бы в on-conflict).
                  void deleteAutoIncomeForAppointment(supabase, apt.id)
                    .then(() =>
                      qc.invalidateQueries({ queryKey: ["transactions"] }),
                    )
                    .catch(() =>
                      toast("Доход в финансах не снят — проверьте раздел «Финансы»", "error"),
                    );
                },
              });
            },
            onError: () => toast("Не удалось отметить оплату", "error"),
          },
        );
      },
    );
  };

  const copyAppointment = (apt: Appointment) => {
    const copy = { ...duplicateAppointment(apt), id: randomUuid() };
    createAppt.mutate(copy, {
      onSuccess: () => {
        // Открываем копию на правку сразу — web parity (page.tsx:1786).
        setEditing(copy);
        setBookDefaults(undefined);
        setSheetOpen(true);
      },
      onError: () => toast("Не удалось скопировать", "error"),
    });
  };

  // «Напомнить…» — локальное уведомление о записи, пресеты вторым
  // ActionSheetIOS. Ограничение v1: время записи — «настенные» часы
  // бизнеса, а Date строится в таймзоне устройства; владелец живёт в
  // бизнес-таймзоне (см. решение по бизнес-часам), уехавший в другой пояс
  // получит напоминание по своим настенным часам.
  const openReminderMenu = (apt: Appointment) => {
    const atStartMinus = (offsetMin: number) => {
      const d = parseYMD(apt.date);
      const [h, m] = apt.time_start.split(":").map(Number);
      d.setHours(h || 0, (m || 0) - offsetMin, 0, 0);
      return d;
    };
    const presets: { label: string; when: () => Date }[] = [
      { label: "За 30 минут", when: () => atStartMinus(30) },
      { label: "За 1 час", when: () => atStartMinus(60) },
      {
        label: "Накануне в 20:00",
        when: () => {
          const d = parseYMD(apt.date);
          d.setDate(d.getDate() - 1);
          d.setHours(20, 0, 0, 0);
          return d;
        },
      },
      {
        label: "Утром в 8:00",
        when: () => {
          const d = parseYMD(apt.date);
          d.setHours(8, 0, 0, 0);
          return d;
        },
      },
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: `Напомнить о записи ${apt.time_start}`,
        options: [...presets.map((p) => p.label), "Отмена"],
        cancelButtonIndex: presets.length,
      },
      (i) => {
        const preset = presets[i];
        if (!preset) return;
        void scheduleAppointmentReminder(
          apt,
          preset.when(),
          preset.label,
          clientName(apt) || undefined,
        ).then((res) => {
          if (res === "scheduled") {
            // «За 30 минут» → «Напомню за 30 минут».
            const l = preset.label;
            toast(`Напомню ${l.charAt(0).toLowerCase()}${l.slice(1)}`);
          } else if (res === "denied") {
            toast("Разрешите уведомления в Настройках", "error");
          } else if (res === "past") {
            toast("Это время уже прошло", "info");
          } else {
            toast("Появится после обновления приложения", "info");
          }
        });
      },
    );
  };

  const openActionMenu = (apt: Appointment) => {
    // Виртуальное вхождение повтора: быстрые действия валидны только для
    // seed — открываем карточку (openEdit сам маршрутизирует на исходную).
    if ((apt as { virtualParentId?: string }).virtualParentId) {
      openEdit(apt);
      return;
    }
    haptics.tap();
    const client = apt.client_id
      ? clients.find((c) => c.id === apt.client_id)
      : undefined;
    const phone = (client?.phone ?? "").trim();
    const address = (apt.address || client?.address || "").trim();

    type Item = { label: string; run: () => void; destructive?: boolean };
    const items: Item[] = [];
    // Оплата уместна, пока есть остаток — в т.ч. у «Выполнена» и «В работе»
    // (раньше пункт видели только «Запланирован», а долги висят как раз на
    // выполненных).
    if (
      apt.kind === "work" &&
      apt.status !== "cancelled" &&
      getDebtAmount(apt) > 0
    )
      items.push({ label: "Отметить оплату", run: () => openPaymentMenu(apt) });
    if (apt.status !== "completed")
      items.push({ label: "Выполнена", run: () => quickStatus(apt, "completed") });
    if (apt.status !== "in_progress")
      items.push({ label: "В работе", run: () => quickStatus(apt, "in_progress") });
    if (apt.status !== "scheduled" && apt.status !== "cancelled")
      items.push({
        label: "Вернуть в план",
        run: () => quickStatus(apt, "scheduled"),
      });
    // Перенос отменённой бессмыслен — сначала «Восстановить».
    if (apt.status !== "cancelled")
      items.push({ label: "Перенести", run: () => setReschedulingApt(apt) });
    // Напоминание — только про предстоящую работу: прошедшие даты, личные
    // события и отменённые пресетам нечего предложить.
    if (apt.kind === "work" && apt.status !== "cancelled" && apt.date >= todayYmd)
      items.push({ label: "Напомнить…", run: () => openReminderMenu(apt) });
    if (phone)
      items.push({
        label: "Позвонить",
        run: () => Linking.openURL(`tel:${phone.replace(/[^+\d]/g, "")}`),
      });
    if (address)
      items.push({
        label: "Маршрут",
        run: () =>
          Linking.openURL(
            `https://maps.apple.com/?daddr=${encodeURIComponent(address)}`,
          ),
      });
    items.push({ label: "Копировать", run: () => copyAppointment(apt) });
    items.push({
      label: apt.status === "cancelled" ? "Восстановить" : "Отменить запись",
      run: () => cancelToggle(apt),
    });
    items.push({
      label: "Удалить",
      destructive: true,
      run: () => deleteWithUndo(apt),
    });

    const destructiveIdx = items.findIndex((i) => i.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: `${apt.time_start}–${apt.time_end} · ${
          clientName(apt) || apt.comment || "Запись"
        }`,
        options: [...items.map((i) => i.label), "Отмена"],
        cancelButtonIndex: items.length,
        destructiveButtonIndex: destructiveIdx >= 0 ? destructiveIdx : undefined,
      },
      (i) => items[i]?.run(),
    );
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
    setMode(m);
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

  // Долгий тап по дате в Неделе — провалиться в День (см. WeekHeaderRow).
  const pickDay = (d: Date) => {
    haptics.tap();
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
        onModeChange={changeMode}
        // Web parity (Header.tsx): календарь = команда, шестерёнка ведёт в
        // полноценные настройки открытой команды (activeTeamId здесь всегда
        // есть: без команд экран занят first-run гейтом выше).
        onGear={() => router.push(`/cabinet/teams/${activeTeamId}`)}
        onTitlePress={() => setMiniCalOpen(true)}
        onToday={goToday}
      />
      <TeamChips teams={teams} activeId={activeTeamId} onSelect={setTeamChoice} />

      {isLoading ? (
        // mode известен синхронно (MMKV) — скелет обязан обещать ту же
        // геометрию, что придёт после загрузки (день ≠ 7 колонок недели).
        <CalendarSkeleton mode={mode === "day" ? "day" : "week"} />
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
          onMenu={openActionMenu}
          labelFor={hasLabels ? labelFor : undefined}
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
                setSlotConfirm({ date: d, time_start: timeStart })
              }
              onMenu={openActionMenu}
              onPickDay={pickDay}
              onJumpToNow={goToday}
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
            appointments={financeWeekAppts}
            teamId={activeTeamId}
            todayYmd={todayYmd}
            onTapDay={(d) => setFinModalYmd(formatYMD(d))}
          />
        </>
      ) : mode === "day" ? (
        <>
          {/* «Утренний взгляд» — сводка просматриваемого дня (web parity).
              CTA ведёт в «Закрыть день» — там живут выполненные с долгом,
              которые пилл и считает (/cabinet/unclosed показывал только
              просроченные «Запланирован» — тупик). */}
          <DaySummaryStrip
            appointments={financeFor(dayYmd)}
            teamId={activeTeamId}
            dateYmd={dayYmd}
            todayYmd={todayYmd}
            onUnpaidTap={() => router.push("/cabinet/close-day")}
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
              onJumpToNow={goToday}
              onMenu={openActionMenu}
              onCreateAt={(d, timeStart) =>
                setSlotConfirm({ date: d, time_start: timeStart })
              }
              onCommitPage={(dir) => setDay((d) => addDays(d, dir))}
              {...gridProps}
            />
          </View>
          <DayFinanceFooter
            days={[day]}
            appointments={financeFor(dayYmd)}
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
                  financeAppointments={financeAppts}
                  teamId={activeTeamId}
                  todayYmd={todayYmd}
                  labelFor={hasLabels ? labelFor : undefined}
                  onPickDay={openWeekFromMonth}
                  onPickLabelDay={
                    hasLabels && activeTeamId
                      ? (ymd) => setCityPickerYmd(ymd)
                      : undefined
                  }
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
        <CalendarOnboardingCard onDismiss={dismissOnboarding} />
      ) : null}

      {/* Вечерний контроль денег: после 18:00 выполненные СЕГОДНЯ с долгом
          (web EndOfDayBanner) — плавающая карточка над футером. CTA ведёт
          в «Закрыть день» (web parity) — экран ровно этих записей;
          /cabinet/unclosed показывал только просроченные «Запланирован». */}
      <EndOfDayBanner
        appointments={todayAppts}
        todayYmd={todayYmd}
        nowHour={now.getHours()}
        onOpenUnpaid={() => router.push("/cabinet/close-day")}
      />

      {/* Разбор финансов дня — тап по футеру Доход/Расход. */}
      <DayFinanceModal
        dateYmd={finModalYmd}
        appointments={finModalYmd ? financeFor(finModalYmd) : []}
        teamId={activeTeamId}
        onClose={() => setFinModalYmd(null)}
        // Тап по строке «Ожидается» открывает запись — контракт с волной
        // day-extras (проп появляется там же).
        onEditAppointment={openEdit}
      />

      {/* Пикер метки дня — центрированная карточка (web CityPickerModal);
          тап по активной строке снимает метку. Целевую дату задаёт
          открывшая шапка (День — свой день, Неделя — тапнутая дата). */}
      <CityPickerModal
        visible={cityPickerYmd != null}
        dateKey={cityPickerYmd ?? todayYmd}
        options={labelOptions}
        // Активная строка = разрешённая метка дня (labelFor: явная →
        // default_city, сентинел CITY_CLEARED = ничего) — web parity:
        // current={cityForDate(...)}, дефолт бригады показан выбранным.
        selected={cityPickerYmd ? labelFor(cityPickerYmd)?.name ?? "" : ""}
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
            // Сентинел, не пустая строка: "" удаляет override, и день тут же
            // перекрашивал бы default_city бригады (web v693 handleCityReset).
            setDayCityMut.mutate({
              teamId: activeTeamId,
              date: cityPickerYmd,
              city: CITY_CLEARED,
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

      {/* «Перенести» из контекстного меню — дата + время одним шитом,
          длительность сохраняется. */}
      <RescheduleSheet
        appointment={reschedulingApt}
        appointments={visibleAppts}
        onClose={() => setReschedulingApt(null)}
      />

      {/* Пре-попап тапа по слоту: дата/время «тумблерами» + выбор
          Клиент/Событие, полная форма открывается уже с верным черновиком.
          Тип в форме остаётся переключаемым сегментом Работа/Событие. */}
      <SlotConfirmPopup
        slot={slotConfirm}
        // Полный видимый набор: дату в попапе можно сдвигать стрелками,
        // findOverlap сам сопоставляет по дате черновика.
        appointments={visibleAppts}
        durationMin={calSettings?.gridStep ?? 60}
        onClose={() => setSlotConfirm(null)}
        onConfirm={(kind, next) => {
          setSlotConfirm(null);
          openCreate({ date: next.date, time_start: next.time_start, kind });
        }}
      />
    </Screen>
  );
}
