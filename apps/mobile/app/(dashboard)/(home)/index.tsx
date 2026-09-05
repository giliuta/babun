import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Linking,
  Pressable,
  Text,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { GestureDetector } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
  type Href,
} from "expo-router";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { chooseOption } from "@/lib/choose";
import { confirmAction } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import type { Appointment } from "@babun/shared/local/appointments";
import {
  duplicateAppointment,
  getDebtAmount,
} from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
} from "@babun/shared/local/finance/transaction";
import {
  isColdOfflineCacheMissError,
  randomUuid,
} from "@babun/shared/sync";
import { getStorage } from "@babun/shared/storage";
import { freeSlotsForDay } from "@/features/calendar/free-slots";
import { expandRepeat } from "@babun/shared/common/utils/expand-repeat";
import {
  findBufferClash,
  findOverlap,
} from "@babun/shared/common/utils/appointment-overlap";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { X } from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingBar } from "@/components/ui/LoadingBar";
import { usePullRefresh } from "@/lib/pull-refresh";
import { useThemeColors } from "@/theme/colors";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { AppointmentSheet } from "@/features/appointments/AppointmentSheet";
import { CrewAppointmentSheet } from "@/features/appointments/CrewAppointmentSheet";
import { buildDebtPaidPatch } from "@/features/appointments/payment";
import {
  DayView,
  type FreeSlotRange,
  type WorkBand,
} from "@/features/calendar/DayView";
import { DEFAULT_CALENDAR_SETTINGS } from "@babun/shared/local/calendar-settings";
import {
  effectiveBuffer,
  effectiveWorkHours,
  hourLabel,
} from "@/features/calendar/setting-options";
import { HOUR_H_DEFAULT } from "@/features/calendar/zoom";
import { WeekView } from "@/features/calendar/WeekView";
import { type CalMode } from "@/features/calendar/ViewModeDropdown";
import { CalendarHeader } from "@/features/calendar/CalendarHeader";
import { MiniCalendar } from "@/features/calendar/MiniCalendar";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { FirstRunCalendarChoice } from "@/features/calendar/FirstRunCalendarChoice";
import { CalendarOnboardingCard } from "@/features/calendar/CalendarOnboardingCard";
import {
  CalendarEmptyState,
  suggestFirstSlot,
} from "@/features/calendar/CalendarEmptyState";
import { DayLabelSheet } from "@/features/calendar/DayLabelSheet";
import {
  BookSlotSheet,
  captionFor,
  offStateAt,
  type SlotDraft,
} from "@/features/calendar/BookSlotSheet";
import { CalendarNotice } from "@/features/calendar/CalendarNotice";
import {
  useDayCities,
  useSetDayCity,
} from "@/features/calendar/day-cities";
import { CITY_CLEARED } from "@babun/shared/local/day-cities";
import {
  resolveCalendarDayLabel,
  type DayLabel,
} from "@/features/calendar/day-label";
import { resolveOffDayLabel } from "@/features/calendar/appointment-label";
import { useAutoColorRule } from "@/features/appointments/booking-prefs";
import { MonthView } from "@/features/calendar/MonthView";
import { AgendaView } from "@/features/calendar/AgendaView";
import { PagedStrip, usePeriodPager } from "@/features/calendar/pager";
import { EndOfDayBanner } from "@/features/calendar/EndOfDayBanner";
import { CalendarSkeleton } from "@/features/calendar/CalendarSkeleton";
import { startOfWeek } from "@/features/calendar/week";
import {
  deriveScrollHour,
  deriveWindow,
  effectiveCalendarWindow,
  hmToMinutes,
} from "@/features/calendar/window";
import { DayFinanceModal } from "@/features/calendar/DayFinanceModal";
import { DayFinanceFooter } from "@/features/calendar/DayFinanceFooter";
import { RescheduleSheet } from "@/features/calendar/RescheduleSheet";
import {
  cancelAppointmentReminders,
  reconcileEventAppointmentReminders,
  scheduleAppointmentReminder,
  syncEventAppointmentReminders,
} from "@/features/calendar/reminders";
import {
  appointmentReminderInstant,
  type AppointmentReminderTiming,
} from "@/features/calendar/reminder-time";
import { nextCrewAppointmentStatus } from "@/features/calendar/crew-status";
import {
  canMutateCalendarAppointment,
  isCalendarEvent,
} from "@/features/calendar/event-access";
import { useAppointments } from "@/features/calendar/queries";
import {
  useCreateAppointment,
  useDeleteAppointment,
  useUndoAppointmentPayment,
  useUpdateAppointment,
} from "@/features/calendar/mutations";
import { useToast } from "@/components/ui/Toast";
import { useClients } from "@/features/clients/queries";
import { useAllServices, useServices } from "@/features/services/queries";
import {
  useCities,
  useCreateTeam,
  useTeams,
} from "@/features/reference/queries";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useCurrentRole } from "@/features/settings/tenant";
import { haptics } from "@/lib/haptics";
import {
  useTeamSchedule,
  useUpsertTeamSchedule,
} from "@/features/reference/team-schedule";
import {
  getDayScheduleForDate,
  setDateOverride,
  type TeamSchedule,
} from "@babun/shared/local/schedule";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import { useSession } from "@/providers/SessionProvider";

// Agenda horizon — web AgendaView parity («what's next», not «this month»).
const AGENDA_HORIZON_DAYS = 60;
// Персист выбранного вида и команды (mode/teamId) между запусками.
const CAL_VIEW_KEY = "calendar.view";
// Онбординг-карточка: «✕» переживает перезапуск (web parity: localStorage).
const ONBOARDING_DISMISSED_KEY = "calendar.onboardingDismissed";

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
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
  const services = useMemo(
    () => servicesQuery.data ?? [],
    [servicesQuery.data],
  );
  const {
    data: teams = [],
    isLoading: teamsLoading,
    isFetching: teamsFetching,
    isError: teamsError,
    error: teamsQueryError,
    refetch: refetchTeams,
  } = useTeams();
  // АРХИВНАЯ КОМАНДА НЕ УНОСИТ СВОЮ РАБОТУ С СОБОЙ.
  //
  // Календарь показывает записи только активной команды, а список команд
  // отдаёт лишь `is_active = true`. Значит после архивации ВСЕ записи
  // команды — включая будущие визиты и деньги дня — исчезали из Дня, Недели,
  // Месяца и футера: чипа нет, вернуть в вид нечем. Диалог при этом обещает
  // «история заявок и финансов сохранится». История и правда сохранялась —
  // просто до неё не было дороги.
  //
  // Поэтому архивная команда остаётся ЧИПОМ, пока у неё есть записи, но
  // только для показа: выбор по умолчанию и все пикеры продолжают жить на
  // активных, иначе архивная команда стала бы календарём по умолчанию.
  const { data: allTeamsForCalendar = [] } = useTeams({ includeInactive: true });
  const calSettingsQuery = useCalendarSettings();
  const calSettings = calSettingsQuery.data;
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  const { session } = useSession();
  const isCrew = role === "master";
  const canManageBookings = role === "owner" || role === "dispatcher";
  const canManageDayLabels = canManageBookings;
  const canViewCompanyFinance = role === "owner";
  // Полоса «Доход / Расход» под сеткой: право (владелец) И желание (настройка
  // «Что показывать»). `undefined` — согласие: у тенанта без строки настроек
  // полоса была всегда, и молчание не должно её отбирать.
  const showDayFinance =
    canViewCompanyFinance && calSettings?.showDayFinance !== false;
  const canMutateAppointment = useCallback(
    (appointment: Appointment) =>
      canMutateCalendarAppointment(role, session?.user.id, appointment),
    [role, session?.user.id],
  );
  // «Первый день недели» — общая настройка; правит Неделю, Месяц и мини-
  // календарь одинаково (до этого понедельник был зашит в каждом из трёх).
  const updateAppt = useUpdateAppointment();
  const undoPayment = useUndoAppointmentPayment();
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
    () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["appointments"] }),
        qc.invalidateQueries({ queryKey: ["clients"] }),
        qc.invalidateQueries({ queryKey: ["services"] }),
        qc.invalidateQueries({ queryKey: ["teams"] }),
        qc.invalidateQueries({ queryKey: ["calendar-settings"] }),
        qc.invalidateQueries({ queryKey: ["team-schedules"] }),
        qc.invalidateQueries({ queryKey: ["cities"] }),
        qc.invalidateQueries({ queryKey: ["day-cities"] }),
      ]),
    [qc],
  );
  // Контрол ленты отражает ЖЕСТ: раньше он питался от isRefetching, то есть
  // выезжал сам при каждом возврате на календарь.
  const pull = usePullRefresh(onRefresh);

  const reschedule = (apt: Appointment, newStart: string, newEnd: string) => {
    if (!canMutateAppointment(apt)) {
      toast(
        isCalendarEvent(apt)
          ? "Изменить событие может только его автор"
          : "Недостаточно прав для переноса",
        "info",
      );
      return;
    }
    if (apt.time_start === newStart) return;
    // Виртуальное вхождение повтора двигать нельзя — правится только seed
    // (id виртуала синтетический, мутация по нему невалидна).
    if ((apt as { virtualParentId?: string }).virtualParentId) {
      toast("Повтор события — измените исходную запись");
      return;
    }
    // Дабл-букинг команды — предупреждаем, но НЕ блокируем (web parity:
    // findOverlap перед записью; диспетчер иногда ставит внахлёст сознательно).
    const clash = findOverlap(
      { ...apt, time_start: newStart, time_end: newEnd },
      visibleAppts,
    );
    // Перерыв / нерабочие часы команды — то же «предупредить, не блокировать»:
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
        ? "Нерабочий день команды"
        : band?.breaks?.some((b) => startMin < b.endMin && endMin > b.startMin)
          ? "Попадает на перерыв"
          : band && (startMin < band.startMin || endMin > band.endMin)
            ? "Вне рабочих часов"
            : null;
    // Буфер на дорогу/уборку — самый слабый из трёх сигналов, поэтому
    // последним: пересечение и нерабочие часы важнее.
    const tight = findBufferClash(
      { ...apt, time_start: newStart, time_end: newEnd },
      visibleAppts,
      bufferMinutes,
    );
    const warn = clash
      ? `Пересечение с ${clash.time_start}–${clash.time_end}`
      : (bandWarn ??
        (tight
          ? `Меньше ${bufferMinutes} мин до ${tight.time_start}–${tight.time_end}`
          : null));
    updateAppt.mutate(
      { id: apt.id, patch: { time_start: newStart, time_end: newEnd } },
      {
        onSuccess: () => {
          // Физический «удар» на успешное приземление drag-переноса —
          // блок лёг на слот, рука это чувствует.
          haptics.impact();
          if (isCalendarEvent(apt)) {
            void syncEventAppointmentReminders(
              { ...apt, time_start: newStart, time_end: newEnd },
              (apt.team_id
                ? teams.find((candidate) => candidate.id === apt.team_id)?.timezone
                : null) ??
                calSettings?.timezone ??
                "Europe/Nicosia",
            );
          } else {
            void cancelAppointmentReminders(apt.id);
          }
          toast(warn ? `Перенесено. ${warn}` : `Перенесено на ${newStart}`);
        },
        onError: () => toast("Не удалось перенести"),
      },
    );
  };

  const router = useRouter();
  /** Экран, с которого пришли открывать запись. Ref, а не state: он не влияет
   *  на отрисовку и не должен вызывать лишний рендер календаря. Гасится сразу
   *  после ухода — второе закрытие уже никуда не уводит. */
  const returnToRef = useRef<string | null>(null);
  const returnHome = () => {
    const href = returnToRef.current;
    if (!href) return;
    returnToRef.current = null;
    // Лист уезжает первым: переключить вкладку под открытым модалом значит
    // показать человеку пустой лист поверх нового экрана.
    //
    // Вкладка — push (переход на таб), страница-донор (инвойс, счёт) —
    // replace: push наслаивал бы вторую копию её экрана поверх календаря, и
    // жест «назад» водил бы по кругу.
    setTimeout(() => {
      if (href === "/finances") router.push(href as Href);
      else router.replace(href as Href);
    }, SHEET_EXIT_MS);
  };
  const params = useLocalSearchParams<{
    appointmentId?: string;
    new?: string;
    clientId?: string;
    locationId?: string;
    teamId?: string;
    date?: string;
    services?: string; // CSV service-id — префилл услуг («Повторить», ТО)
    kind?: string; // AppointmentKind черновика
    reminderId?: string; // recurring ТО → mark booked after successful create
    /** Куда вернуться, когда запись закроют. Ставит её тот, кто сюда привёл:
     *  деньги по заявке открывают запись с «Финансов», и закрытие обязано
     *  вернуть человека в ту же ленту, а не оставить в календаре (владелец
     *  2026-08-15: «нажимаю назад — обратно переходит в оплату»). Вкладки не
     *  складываются в стек, поэтому «назад» здесь — это переход на вкладку. */
    from?: string;
    // РЕЖИМ ПОДБОРА ВРЕМЕНИ: «Записать» с карточки/списка открывает ЭТОТ
    // календарь, подсвечивает свободное зелёным и ждёт выбора (владелец
    // 2026-08-07, по образцу Bumpix: «полноценно открывается календарь,
    // который уже существует, и там просто выбираешь»).
    pickClient?: string;
    pickLocation?: string;
    /** Команда/услуги/напоминание того же задания — везём их до формы, а не
     *  теряем на пересадке в календаре. */
    pickTeam?: string;
    pickServices?: string;
    pickReminder?: string;
  }>();
  // РЕЖИМ — СОСТОЯНИЕ ЭКРАНА, А НЕ АДРЕС. Параметр вкладки переживает всё:
  // и уход в форму, и переключение табов — плашка «Записать: Иван» висела
  // после сохранения (того же человека можно было записать второй раз) и
  // встречала при возврате из «Клиентов». Параметр теперь только ДОСТАВЛЯЕТ
  // задание: приняли — и сразу стёрли адрес, дальше режимом владеет экран.
  const [pick, setPick] = useState<{
    clientId: string;
    locationId: string | null;
    teamId: string | null;
    services: string | null;
    reminderId: string | null;
  } | null>(null);
  const pickClientId = pick?.clientId ?? null;
  useEffect(() => {
    if (!params.pickClient) return;
    setPick({
      clientId: params.pickClient,
      locationId: params.pickLocation || null,
      teamId: params.pickTeam || null,
      services: params.pickServices || null,
      reminderId: params.pickReminder || null,
    });
    router.setParams({
      pickClient: "",
      pickLocation: "",
      pickTeam: "",
      pickServices: "",
      pickReminder: "",
    });
  }, [
    params.pickClient,
    params.pickLocation,
    params.pickTeam,
    params.pickServices,
    params.pickReminder,
    router,
  ]);
  // Уход с календаря снимает вопрос «когда?»: он задан один раз.
  useFocusEffect(
    useCallback(() => () => setPick(null), []),
  );

  // Вид и команда переживают перезапуск (MMKV): владелец двух команд в
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
  // «Сегодня» устройства может отличаться от бизнес-таймзоны команды (ночь
  // у владельца ≠ ночь команды): пока пользователь не тронул дату, один раз
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
  // ПЕРСИСТ ТОЛЬКО ПО ВОЛЕ ЧЕЛОВЕКА. Раньше вид и активная команда писались
  // в MMKV эффектом на ЛЮБОЕ изменение — включая переходы ПО ПАРАМЕТРАМ
  // («Прошлый визит» с карточки, вход мастера, напоминание). Человек открывал
  // один визит, а календарь навсегда переключался на «День» и на чужую
  // команду. Теперь параметрический переход показывает нужное, но
  // предпочтения не трогает.
  const prefRef = useRef({ mode, teamId: teamChoice });
  const rememberView = (next: { mode?: CalMode; teamId?: string | null }) => {
    prefRef.current = { ...prefRef.current, ...next };
    getStorage().set(CAL_VIEW_KEY, prefRef.current);
  };
  // Стабильная ссылка для колбэков с пустыми зависимостями.
  const rememberViewRef = useRef(rememberView);
  rememberViewRef.current = rememberView;
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
  const [crewViewing, setCrewViewing] = useState<Appointment | null>(null);
  // «Перенести» из контекстного меню — запись в шите переноса (null = закрыт).
  const [reschedulingApt, setReschedulingApt] = useState<Appointment | null>(
    null,
  );

  // Чипы календаря: активные команды плюс архивные, за которыми осталась
  // работа. Порядок сохраняем — архивные уходят в хвост.
  const calendarTeams = useMemo(() => {
    const active = new Set(teams.map((tm) => tm.id));
    const withWork = new Set(
      appts.map((a) => a.team_id).filter((id): id is string => !!id),
    );
    const retired = allTeamsForCalendar.filter(
      (tm) => !active.has(tm.id) && withWork.has(tm.id),
    );
    return retired.length > 0 ? [...teams, ...retired] : teams;
  }, [teams, allTeamsForCalendar, appts]);

  // Active team calendar. Derived (not stored) so it self-heals: falls back
  // to the first team until the user picks one, and re-anchors if the chosen
  // team disappears. Null only while there are no teams (→ first-run gate).
  const activeTeamId =
    // Выбрать можно и архивную (её чип виден), а вот ПО УМОЛЧАНИЮ открывается
    // всегда активная: иначе архив стал бы стартовым экраном.
    teamChoice && calendarTeams.some((tm) => tm.id === teamChoice)
      ? teamChoice
      : teams[0]?.id ?? calendarTeams[0]?.id ?? null;
  const activeTeam = calendarTeams.find((tm) => tm.id === activeTeamId);

  // ПОДБОР ВРЕМЕНИ ПЕРЕКЛЮЧАЕТ КАЛЕНДАРЬ НА БРИГАДУ КЛИЕНТА. Иначе свободное
  // время считалось по команде, открытой в чипе: постоянного клиента команды
  // Б показывали и записывали к команде А просто потому, что вчера смотрели
  // её календарь.
  const pickTeamId = pick?.teamId ?? null;
  useEffect(() => {
    if (!pickTeamId) return;
    if (!teams.some((tm) => tm.id === pickTeamId)) return;
    setTeamChoice((prev) => (prev === pickTeamId ? prev : pickTeamId));
  }, [pickTeamId, teams]);

  // «Now» in the BUSINESS timezone, ticked every minute so the now-line /
  // past-wash / isToday stay live while the screen is open — including
  // across midnight. Per-brigade timezone wins over the global setting
  // (web parity: activeBrigadeTimezone, dashboard/page.tsx:752-756).
  const timezone = activeTeam?.timezone ?? calSettings?.timezone;
  useEffect(() => {
    if (
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
    void reconcileEventAppointmentReminders(
      appts,
      (appointment) =>
        (appointment.team_id
          ? teamTimezones.get(appointment.team_id)
          : null) ??
        calSettings?.timezone ??
        "Europe/Nicosia",
    ).catch(() => {});
  }, [
    appts,
    calSettings?.timezone,
    calSettingsQuery.isError,
    calSettingsQuery.isLoading,
    error,
    isLoading,
    teams,
    teamsError,
    teamsLoading,
  ]);
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
        reminderId: undefined,
        appointmentId: undefined,
      });
    // Гонка с загрузкой команд: на холодном старте по диплинку teams=[]
    // ещё «не знает» ответа — гасить параметры рано (визит с карточки
    // молча пропадал). Ждём резолва: эффект перезапустится по
    // teamsLoading/teams и обработает параметры уже с данными.
    if (
      teamsLoading ||
      teamsError ||
      (params.appointmentId && (isLoading || error))
    ) {
      return;
    }
    if (params.appointmentId) {
      const target = appts.find(
        (appointment) => appointment.id === params.appointmentId,
      );
      if (target) {
        const requestedDate =
          params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
            ? params.date
            : target.date;
        setDay(startOfDay(parseYMD(requestedDate)));
        setMode("day");
        if (
          target.team_id &&
          teams.some((team) => team.id === target.team_id)
        ) {
          setTeamChoice(target.team_id);
        }
        // Запомнили дорогу назад ДО гашения параметров: сами параметры живут
        // один кадр, а вернуться нужно, когда лист закроют. Словарь дорог:
        // «finances» — вкладка денег; «invoice:<id>» / «account:<id>» —
        // страница, с чьей проводки запись открыли (инвойс, карточка счёта).
        returnToRef.current =
          params.from === "finances"
            ? "/finances"
            : params.from?.startsWith("invoice:")
              ? `/invoices/${params.from.slice("invoice:".length)}`
              : params.from?.startsWith("account:")
                ? `/accounts/${params.from.slice("account:".length)}`
                : null;
        if (isCrew || !canMutateAppointment(target)) setCrewViewing(target);
        else {
          setEditing(target);
          setSheetOpen(true);
        }
      } else {
        toast("Заявка не найдена или больше недоступна");
      }
      clearParams();
    } else if (params.new === "1") {
      // Без единой команды шит бессмысленен (стейл-дефолты), а экран занят
      // first-run гейтом «Создать календарь» — параметры просто гасим.
      if (teams.length === 0) {
        clearParams();
        return;
      }
      // ?date= вместе с new=1 (возвраты: «Записать» на дату ТО) — префилл
      // даты черновика; валидируем формат, мусор не пускаем (web parity).
      const draftDate =
        params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
          ? params.date
          : undefined;
      // Букинг в чужую команду («Записать» с карточки): активируем её
      // календарь, чтобы созданная запись не «пропала» из виду при возврате.
      if (params.teamId && teams.some((tm) => tm.id === params.teamId)) {
        setTeamChoice(params.teamId);
      }
      const draftKind =
        params.kind === "event" ? "event" : params.kind === "work" ? "work" : undefined;
      // Карточка клиента → «Записать» теперь ведёт на отдельный экран /book
      // (тот же маршрут, что тап по слоту), а не открывает шит-модал.
      router.push({
        pathname: "/book",
        params: {
          ...(params.clientId ? { clientId: params.clientId } : {}),
          ...(params.locationId ? { locationId: params.locationId } : {}),
          ...(params.teamId ? { teamId: params.teamId } : {}),
          ...(draftDate ? { date: draftDate } : {}),
          ...(params.services ? { services: params.services } : {}),
          ...(draftKind ? { kind: draftKind } : {}),
          ...(params.reminderId ? { reminderId: params.reminderId } : {}),
        },
      });
      clearParams();
    } else if (params.date) {
      // Переход по дате (карточка клиента, визиты мастера) = «покажи этот
      // день»: открываем именно День (web ?view=day&date= parity).
      const d = parseYMD(params.date);
      setDay(startOfDay(d));
      setMode("day");
      // ?teamId= — команда записи: без переключения визит чужой команды
      // открывал бы пустой день активной команды.
      if (params.teamId && teams.some((tm) => tm.id === params.teamId)) {
        setTeamChoice(params.teamId);
      }
      router.setParams({ date: undefined, teamId: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    params.appointmentId,
    params.new,
    params.clientId,
    params.reminderId,
    params.date,
    params.teamId,
    teamsLoading,
    teamsError,
    teams,
    isLoading,
    error,
    appts,
  ]);

  const nameById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.full_name])),
    [clients],
  );
  const clientName = (a: Appointment) =>
    a.client_id ? nameById.get(a.client_id) ?? "" : "";

  // Лента дня называет услуги ПРОШЕДШИХ записей — по полному справочнику;
  // `services` выше остаётся про живой каталог (онбординг спрашивает им,
  // заведён ли прайс вообще).
  const { data: allServices = [] } = useAllServices();
  const serviceNameById = useMemo(
    () => new Map(allServices.map((s) => [s.id, s.name])),
    [allServices],
  );
  // «Чистка, x2 Диагностика» — web AgendaView service summary.
  const serviceSummaryFor = useCallback(
    (a: Appointment) => {
      // ИМЯ БЕРЁТСЯ ИЗ СНИМКА ЗАПИСИ, И ТОЛЬКО ПОТОМ ИЗ КАТАЛОГА.
      //
      // `services[].serviceName` — имя НА ДЕНЬ ВИЗИТА: его кладут при
      // сохранении именно затем, чтобы прошлая работа продолжала называться
      // так, как её назвали тогда. Каталог отвечает «как называется сейчас»,
      // а на стёртой услуге не отвечает вовсе — и лента печатала «Услуга
      // удалена» поверх работы, которую бригада делала и за которую взяли
      // деньги. Каталог остаётся вторым источником: у записей до 25 августа
      // 2026 снимка ещё нет.
      const snapshot = a.services ?? [];
      if (snapshot.length > 0) {
        return snapshot
          .map((line) => {
            const name =
              line.serviceName?.trim() ||
              serviceNameById.get(line.serviceId) ||
              "Услуга удалена";
            const q = line.quantity > 1 ? line.quantity : 1;
            return q > 1 ? `x${q} ${name}` : name;
          })
          .join(", ");
      }
      const qty = new Map<string, number>();
      for (const id of a.service_ids) qty.set(id, (qty.get(id) ?? 0) + 1);
      return [...qty.entries()]
        .map(([id, q]) => {
          const name = serviceNameById.get(id) ?? "Услуга удалена";
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


  // ─── Метки дней (web parity: city pill в шапке дня) ─────────────────
  // МЕТКИ АКТИВНОГО КАЛЕНДАРЯ, а не всего тенанта. С 2026-08-29 метка
  // принадлежит команде, и у каждой своя копия: без фильтра пикер дня
  // показывал «Лимассол» столько раз, сколько в компании команд.
  const autoColorRule = useAutoColorRule();
  const citiesQuery = useCities({ teamId: activeTeamId });
  const dayCitiesQuery = useDayCities();
  const cities = useMemo(() => citiesQuery.data ?? [], [citiesQuery.data]);
  const dayCities = useMemo(
    () => dayCitiesQuery.data ?? {},
    [dayCitiesQuery.data],
  );
  const setDayCityMut = useSetDayCity();
  // Дата, чью метку правим (null = пикер закрыт): шапка Дня открывает свой
  // день, тап по дате в Неделе — свою (долгое нажатие там открывает день).
  const [cityPickerYmd, setCityPickerYmd] = useState<string | null>(null);
  // Тапнутый пустой слот сетки (null = лист закрыт): лист «Новая запись»
  // уточняет время барабаном и ведёт в /book Клиентом или Событием.
  const [slotDraft, setSlotDraft] = useState<SlotDraft | null>(null);
  /** Вопрос, накрывший шапку: «время нерабочее / уже прошло — всё равно?» */
  const [notice, setNotice] = useState<{
    message: string;
    onAction: () => void;
  } | null>(null);
  // «Временно перекрывает» — значит уходит сама. Пять секунд: столько живёт
  // тост с кнопкой, и месяц с переключателем вида не должны быть закрыты
  // дольше, чем человек читает одну строку.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  // Разбор финансов дня по тапу на футер Доход/Расход (null = закрыт).
  const [finModalYmd, setFinModalYmd] = useState<string | null>(null);
  // МЕТКА ДНЯ — ТОЛЬКО ЯВНАЯ (владелец 2026-08-29: «кнопку „основная" вообще
  // стираем; поставить метку можно исключительно выбором по датам — надо
  // везде, выберу все даты»).
  //
  // Фолбэка на `team.default_city` больше нет. Он был «одна метка на все дни
  // сразу» — невидимая настройка, которая красила календарь из другого
  // экрана: день выглядел помеченным, хотя на нём никто ничего не ставил, и
  // снять это можно было только найдя звезду в справочнике.
  // ПРАВИЛО «КАКАЯ МЕТКА У ДНЯ» ПЕРЕЕХАЛО В `features/calendar/day-label`
  // (2026-08-31). Оно жило здесь и наружу не выводилось — а форма записи
  // обязана показать в шапке ТУ ЖЕ метку, что стоит на дне в календаре.
  // Вторая копия разошлась бы на первой правке, и два экрана заговорили бы о
  // разных метках одного дня. Порядок ступеней и закон «прошлое не
  // переписывается настройкой» теперь под одиннадцатью тестами.
  const labelFor = useCallback(
    (dateYmd: string): DayLabel | null =>
      resolveCalendarDayLabel({
        dayCities,
        cities,
        teamId: activeTeamId,
        dateYmd,
        todayYmd,
        fallbackColor: t.faint,
      }),
    [activeTeamId, dayCities, cities, todayYmd, t.faint],
  );

  // ЦВЕТ ЗАПИСИ В АВТОМАТИЧЕСКОМ РЕЖИМЕ — ПО ПРАВИЛУ ИЗ НАСТРОЙКИ (Кабинет →
  // «Запись», владелец 2026-09-05). Форма записи спрашивает то же правило:
  // иначе один и тот же выезд был бы одного цвета в форме и другого в сетке.
  // «Цвет метки» падает на цвет команды, когда метки нет ни у записи, ни у
  // дня: блок без цвета хуже блока «не той» окраски.
  const teamColorFor = useCallback(
    (a: Appointment) => {
      if (autoColorRule === "label") {
        const name = (a.city ?? "").trim() || labelFor(a.date)?.name;
        const own = name
          ? cities.find((c) => c.name === name)?.color ?? null
          : null;
        if (own) return own;
      }
      return a.team_id ? teamColor.get(a.team_id) ?? null : null;
    },
    [autoColorRule, cities, labelFor, teamColor],
  );
  // ЧУЖАЯ МЕТКА НА БЛОКЕ ЗАПИСИ (владелец 2026-09-04: «можно подсвечивать
  // другим цветом, когда метка другая, окантовку какую-то»). Правило и его
  // границы — в `appointment-label.ts`; здесь только связка с меткой дня,
  // которую календарь уже считает.
  const offLabelFor = useCallback(
    (a: Appointment) =>
      resolveOffDayLabel({
        city: a.city,
        dayLabelName: labelFor(a.date)?.name ?? null,
        cities,
      }),
    [labelFor, cities],
  );
  // Сетке хватает цвета: в колонке дня словам места нет.
  const offLabelColorFor = useCallback(
    (a: Appointment): string | null => offLabelFor(a)?.color ?? null,
    [offLabelFor],
  );

  // Тап по дате всегда открывает метки. Даже если у команды их ещё нет,
  // DayLabelSheet показывает честное пустое состояние и ведёт в настройки.
  // Иначе новый диспетчер нажимал на дату в ожидании метки, а приложение
  // молча переключало вид календаря. Провал в День/Неделю остаётся на долгом
  // нажатии, как и подсказывает accessibilityHint в ячейке даты.
  // Label tint — the label colour washes the day columns very lightly (web
  // DayColumn tintByLabel, Phase I41). The brigade «Метки» setting
  // team.tint_days_by_label (default on) drops the resolver entirely.
  const labelTintFor = useMemo(() => {
    if (!(activeTeam?.tint_days_by_label ?? true)) return undefined;
    // Два уровня, и оба нужны: командный `tint_days_by_label` гасит заливку
    // во всём календаре разом, метка-уровневый `tint_day` — только свою.
    return (dateYmd: string) => {
      const label = labelFor(dateYmd);
      return label?.tint ? label.color : null;
    };
  }, [activeTeam?.tint_days_by_label, labelFor]);
  // Web CityPickerModal pickerList: активные метки справочника, суженные до
  // меток команды, когда они заданы; пустой список команды при заданном
  // default_city → весь активный справочник (web parity).
  const labelOptions = useMemo(
    () =>
      // ПОДБОРА БОЛЬШЕ НЕТ. Здесь стоял фильтр по `teams.cities` — списку
      // имён, подобранных команде из ОБЩЕГО справочника. С 29 августа метка
      // принадлежит команде, и `cities` уже приходят её собственные; старый
      // фильтр стал не сужением, а ПОТЕРЕЙ: у команды со списком из одного
      // имени её же вторая метка исчезала из выбора.
      cities
        .filter((c) => c.is_active && !c.deleted_at)
        .map((c) => ({ name: c.name, color: c.color ?? t.accent })),
    [cities, t.accent],
  );

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
        ? a.team_id === activeTeamId || (a.team_id == null && a.kind !== "work")
        : true,
    [activeTeamId],
  );
  const byTeam = useCallback(
    (a: Appointment) =>
      inTeamCal(a) && (!hideCancelled || a.status !== "cancelled"),
    [inTeamCal, hideCancelled],
  );

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
    [expandedAppts, byTeam],
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
    const first = startOfWeek(day);
    return Array.from({ length: 7 }, (_, i) => addDays(first, i));
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

  // Тап по свободному слоту / действие из агенды / «Записать» с карточки открывает
  // ОТДЕЛЬНЫЙ экран /book (реальный маршрут, а не шит-модал поверх попапа):
  // дата/время/команда едут параметрами, «назад» возвращает на календарь.
  // Тап уже И ЕСТЬ выбор времени — второй попап-«тумблер» больше не нужен.
  // Команда черновика — календарь, который сейчас открыт (activeTeamId).
  const bookAt = (defaults?: {
    date?: string;
    time_start?: string;
    kind?: "work" | "event";
    clientId?: string;
    locationId?: string;
  }) => {
    if (!canManageBookings) {
      toast(
        roleQuery.isPending
          ? "Проверяем права доступа"
          : "Новую запись создаёт владелец или диспетчер",
        "info",
      );
      return;
    }
    router.push({
      pathname: "/book",
      params: {
        ...(activeTeamId ? { teamId: activeTeamId } : {}),
        ...(defaults?.date ? { date: defaults.date } : {}),
        ...(defaults?.time_start ? { time_start: defaults.time_start } : {}),
        ...(defaults?.kind ? { kind: defaults.kind } : {}),
        ...(defaults?.clientId ? { clientId: defaults.clientId } : {}),
        ...(defaults?.locationId ? { locationId: defaults.locationId } : {}),
      },
    });
  };

  // Заводит первый календарь тенанта. Вызывается АВТОМАТИЧЕСКИ эффектом
  // ниже; кнопка осталась только запасным выходом, если автосоздание не
  // прошло (нет связи, отказ базы).
  const createFirstCalendar = () => {
    const used = new Set(
      (teams as { color?: string | null }[]).map((tm) => tm.color).filter(Boolean),
    );
    const color =
      PRESET_COLOR_CYCLE.find((c) => !used.has(c.value))?.value ??
      PRESET_COLOR_CYCLE[0].value;
    createTeam.mutate(
      // «Мой календарь», а не «Команда 1»: у человека, который только что
      // завёл первый календарь, ещё нет никаких «команд» — счётчик в имени
      // это язык базы, а не язык владельца. Переименовать можно из тоста.
      { name: "Мой календарь", color },
      {
        onSuccess: (team) => {
          setTeamChoice(team.id);
          rememberView({ teamId: team.id });
          // Тоста нет намеренно: календарь заводится САМ, человек его не
          // просил — сообщать ему о результате действия, которого он не
          // совершал, значит требовать внимания ни за чем. Имя видно в
          // чипе над сеткой, переименование живёт под шестерёнкой.
        },
        onError: () => {
          // Автосоздание не прошло — показываем кнопку как ручной выход.
          // Молча оставить пустой экран нельзя: человек окажется в
          // календаре, которого нет, без единого способа это исправить.
          setFirstCalendarFailed(true);
          toast("Не удалось создать календарь");
        },
      },
    );
  };

  // КАЛЕНДАРЬ ЗАВОДИТСЯ САМ (владелец 2026-08-27: «когда я впервые захожу
  // в календарь, я хочу, чтобы там уже был создан календарь — не надо было
  // нажимать кнопку, она по сути бессмысленный этап»).
  //
  // Шаг и правда был пустым: единственная кнопка единственного экрана
  // делала ровно одно действие без единого выбора — ни имени, ни цвета, ни
  // типа. Экран, который спрашивает «продолжить?», не спрашивает ничего.
  //
  // Условия строгие, потому что цена ошибки — лишняя команда в базе:
  // только владелец (мастер календарей не заводит), только когда список
  // команд ДОЗАГРУЖЕН и пуст, только один раз за жизнь экрана (ref, а не
  // state — он не должен перезапускать эффект).
  const firstCalendarStarted = useRef(false);
  const [firstCalendarFailed, setFirstCalendarFailed] = useState(false);
  useEffect(() => {
    if (firstCalendarStarted.current) return;
    if (role !== "owner") return;
    if (teamsFetching || teamsError) return;
    if (teams.length > 0) return;
    firstCalendarStarted.current = true;
    createFirstCalendar();
    // createFirstCalendar намеренно не в зависимостях: он пересоздаётся
    // каждый рендер, и его включение превратило бы эффект в цикл.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, teamsFetching, teamsError, teams.length]);
  const openEdit = (apt: Appointment) => {
    // Виртуальное вхождение повтора редактируем через его seed-запись —
    // у виртуала синтетический id, мутации по нему невалидны (web parity).
    const parentId = (apt as { virtualParentId?: string }).virtualParentId;
    const target = parentId ? appts.find((a) => a.id === parentId) ?? apt : apt;
    if (isCrew || !canMutateAppointment(target)) {
      setCrewViewing(target);
      return;
    }
    // ПРАВКА УХОДИТ НА /book (2026-08-31). Форм записи было две — отдельная
    // для создания и отдельная для правки, — и владелец решил свести их в
    // одну: «нам надо одна единая, и чтобы это было сразу создание и
    // редактирование, значит одна из них лишняя».
    //
    // Лишним оказался лист: /book УЖЕ умеет править (STORY-064, «одна
    // страница создаёт и правит»), просто сюда его не звали. Пока обе формы
    // живы, любая правка делается наполовину — вчерашний снос «Источника
    // заявки» вычистил его из создания и оставил в правке.
    router.push({
      pathname: "/book",
      params: { appointmentId: target.id },
    } as Href);
  };

  // ─── Контекстное меню записи (долгое нажатие без движения) ──────────
  // Web parity ActionMenuModal (dashboard/page.tsx:1752): «только действия,
  // которыми реально пользуются». Рисует канонический нижний лист через
  // chooseOption: ActionSheetIOS существует ТОЛЬКО на iOS, в браузере его
  // вызов падал с TypeError и уносил всё меню записи. Необратимое удаление
  // подтверждается отдельно.
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
          // Мастеру «Отменить» не предлагаем: переходы статуса для него
          // односторонние по политике сервера (update_master_appointment_safe
          // пускает только scheduled→in_progress→completed) — кнопка лишь
          // мигала бы блоком и молча откатывалась.
          toast(
            done,
            "success",
            isCrew
              ? undefined
              : {
                  label: "Отменить",
                  onPress: () =>
                    updateAppt.mutate(
                      { id: apt.id, patch: { status: prev } },
                      {
                        onError: () =>
                          toast("Не удалось вернуть статус", "error"),
                      },
                    ),
                },
          );
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
          if (to === "cancelled") void cancelAppointmentReminders(apt.id);
          toast(
            to === "cancelled" ? "Запись отменена" : "Запись восстановлена",
            "info",
            {
              label: "Отменить",
              onPress: () =>
                updateAppt.mutate(
                  { id: apt.id, patch: { status: prev } },
                  {
                    // Без колбэка откат падал молча: options-level onError
                    // хука гасит глобальный алерт MutationCache.
                    onError: () =>
                      toast("Не удалось вернуть запись", "error"),
                  },
                ),
            },
          );
        },
        onError: () => toast("Не удалось изменить запись", "error"),
      },
    );
  };

  const deleteAppointmentConfirmed = (apt: Appointment) => {
    const repeating = apt.event_repeat && apt.event_repeat.kind !== "none";
    const hasRecordedPayment =
      isCalendarEvent(apt) === false &&
      (((apt.payment_status ?? "unpaid") !== "unpaid") ||
        apt.prepaid_amount > 0 ||
        (apt.paid_amount ?? 0) > 0 ||
        apt.payments.length > 0 ||
        apt.payment != null);
    if (hasRecordedPayment) {
      notify(
        "Запись хранится в истории",
        "Запись с оплатой нельзя удалить. Отмените её или оформите возврат, чтобы история расчётов сохранилась.",
      );
      return;
    }
    void confirmAction(
      repeating ? "Удалить всю серию?" : isCalendarEvent(apt) ? "Удалить событие?" : "Удалить запись?",
      {
        message: repeating
          ? "Удалится исходное событие и все его повторы. Действие необратимо."
          : "Действие необратимо; связанные фото также исчезнут из заявки.",
        confirmLabel: repeating ? "Удалить серию" : "Удалить",
        destructive: true,
      },
    ).then((ok) => {
      if (!ok) return;
      deleteAppt.mutate(apt.id, {
        onSuccess: () => {
          void cancelAppointmentReminders(apt.id);
          haptics.warning();
          toast(isCalendarEvent(apt) ? "Событие удалено" : "Запись удалена", "info");
        },
        onError: () => toast("Не удалось удалить", "error"),
      });
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
    const methods = PAYMENT_METHODS;
    void chooseOption(
      `Оплата ${formatEUR(debt)}`,
      methods.map((m) => ({ label: PAYMENT_METHOD_LABEL[m] })),
      { haptic: false },
    ).then((i) => {
      const method = i === null ? undefined : methods[i];
      if (!method) return;
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
              onPress: () =>
                undoPayment.mutate(apt.id, {
                  onSuccess: () => toast("Оплата отменена", "success"),
                  onError: (error) =>
                    toast(error.message || "Не удалось отменить оплату", "error"),
                }),
            });
          },
          onError: (error) =>
            toast(
              error.message.replace(/^updateAppointment:\s*/, "") ||
                "Не удалось отметить оплату",
              "error",
            ),
        },
      );
    });
  };

  const copyAppointment = (apt: Appointment) => {
    const copy = { ...duplicateAppointment(apt), id: randomUuid() };
    createAppt.mutate(copy, {
      onSuccess: () => {
        // Открываем копию на правку сразу — web parity (page.tsx:1786).
        setEditing(copy);
        setSheetOpen(true);
      },
      onError: () => toast("Не удалось скопировать", "error"),
    });
  };

  // «Напомнить…» — локальное уведомление о записи, пресеты вторым листом.
  // Appointment date/time are business wall-clock fields:
  // resolve them in the assigned brigade timezone (global business timezone
  // as fallback), never in the timezone of the dispatcher's current device.
  const openReminderMenu = (apt: Appointment) => {
    const appointmentTimeZone =
      (apt.team_id
        ? teams.find((candidate) => candidate.id === apt.team_id)?.timezone
        : null) ??
      calSettings?.timezone ??
      "Europe/Nicosia";
    const presets: {
      label: string;
      timing: AppointmentReminderTiming;
    }[] = [
      { label: "За 30 минут", timing: "before-30" },
      { label: "За 1 час", timing: "before-60" },
      { label: "Накануне в 20:00", timing: "previous-day-20" },
      { label: "Утром в 8:00", timing: "same-day-08" },
    ];
    void chooseOption(
      `${isCalendarEvent(apt) ? "Напомнить о событии" : "Напомнить о записи"} ${apt.time_start}`,
      presets.map((p) => ({ label: p.label })),
      { haptic: false },
    ).then((i) => {
      const preset = i === null ? undefined : presets[i];
      if (!preset) return;
      let when: Date;
      try {
        when = appointmentReminderInstant(
          apt,
          preset.timing,
          appointmentTimeZone,
        );
      } catch {
        toast("Не удалось определить время напоминания", "error");
        return;
      }
      void scheduleAppointmentReminder(
        apt,
        when,
        preset.label,
        clientName(apt) || undefined,
      ).then((res) => {
        if (res === "scheduled") {
          // «За 30 минут» → «Напомню за 30 минут».
          const l = preset.label;
          toast(`Напомню ${l.charAt(0).toLowerCase()}${l.slice(1)}`);
        } else if (res === "deferred") {
          toast(
            "Напоминание сохранено в очереди и установится, когда на iPhone освободится место",
            "info",
          );
        } else if (res === "capacity") {
          toast(
            "Очередь напоминаний переполнена — удалите ненужные напоминания",
            "error",
          );
        } else if (res === "denied") {
          toast("Разрешите уведомления в Настройках", "error");
        } else if (res === "past") {
          toast("Это время уже прошло", "info");
        } else {
          toast("Появится после обновления приложения", "info");
        }
      });
    });
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
    const event = isCalendarEvent(apt);
    const mutable = canMutateAppointment(apt);

    type Item = { label: string; run: () => void; destructive?: boolean };
    const items: Item[] = [
      {
        label: event ? "Открыть событие" : "Открыть заявку",
        run: () => openEdit(apt),
      },
    ];
    if (isCrew) {
      // Мастер может двигать статус только вперёд на один шаг. Это ровно
      // совпадает с серверной политикой и не оставляет кнопок, которые после
      // тапа всё равно закончатся отказом. Team events are read-only.
      if (!event) {
        const nextStatus = nextCrewAppointmentStatus(apt.status);
        if (nextStatus) {
          items.push({
            label: nextStatus === "in_progress" ? "В работу" : "Выполнена",
            run: () => quickStatus(apt, nextStatus),
          });
        }
      }
    } else if (!event) {
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
    } else if (mutable) {
      // У событий нет рабочего lifecycle «В работу / Выполнена / Отменена».
      // Автор может перенести/удалить seed; другой оператор получает только
      // просмотр и копирование — ровно как creator-only RLS.
      items.push({ label: "Перенести", run: () => setReschedulingApt(apt) });
    }
    // Локальное напоминание доступно и для командного события в режиме
    // просмотра: это настройка устройства, она не изменяет чужую запись.
    if (apt.status !== "cancelled" && apt.date >= todayYmd)
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
    if (!isCrew) {
      items.push({ label: "Копировать", run: () => copyAppointment(apt) });
      if (!event) {
        items.push({
          label: apt.status === "cancelled" ? "Восстановить" : "Отменить запись",
          run: () => cancelToggle(apt),
        });
      }
      if (mutable) {
        items.push({
          // Явный null-чек: у одиночного события event_repeat = null, и
          // «undefined !== "none"» обещал бы удаление несуществующей серии.
          label:
            event && apt.event_repeat && apt.event_repeat.kind !== "none"
              ? "Удалить серию"
              : "Удалить",
          destructive: true,
          run: () => deleteAppointmentConfirmed(apt),
        });
      }
    }

    void chooseOption(
      `${apt.time_start}–${apt.time_end} · ${
        clientName(apt) || apt.comment || "Запись"
      }`,
      items.map((i) => ({ label: i.label, destructive: i.destructive })),
      // Хаптик уже был на долгом нажатии — второй подряд читается как сбой.
      { haptic: false },
    ).then((i) => {
      if (i === null) return;
      // Меню — тоже нижний лист: почти каждый пункт открывает СВОЁ окно
      // (второй лист, подтверждение, карточка записи), а оно не появится, пока
      // этот не уедет.
      setTimeout(() => items[i]?.run(), SHEET_EXIT_MS);
    });
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
  }, []);

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
  const workBandFor = useMemo(() => {
    if (!teamSchedule) return undefined;
    return (dateYmd: string): WorkBand | null | undefined => {
      const sched = getDayScheduleForDate(teamSchedule, parseYMD(dateYmd));
      if (!sched.is_working) return null;
      const start = parseHourHM(sched.start);
      const end = parseHourHM(sched.end);
      if (start == null || end == null || end <= start) return undefined;
      // Перерывы команды (обед и т.п.) — серые полосы на сетке, чтобы
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
      (ymd: string): WorkBand | null | undefined => {
        const band = workBandFor?.(ymd);
        // null (выходной) проходит как есть; undefined → настройка часов.
        if (band !== undefined) return band;
        const ws = calSettings?.workStartHour;
        const we = calSettings?.workEndHour;
        if (ws == null || we == null) return undefined;
        return { startMin: ws * 60, endMin: we * 60 };
      },
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
  const freeSlotsFor = useMemo(() => {
    if (!pickClientId) return undefined;
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
      }).map((slot) => ({
        startMin: slot.startMin,
        endMin: slot.startMin + step,
      }));
    }
  }, [
    pickClientId,
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

  const pickClientName = pickClientId
    ? clients.find((c) => c.id === pickClientId)?.full_name ?? ""
    : "";

  /** В ПРОШЛОЕ ЗАПИСЫВАЮТ ТОЛЬКО ЧЕРЕЗ ПЛАШКУ (владелец 2026-08-24: «в
   *  прошлом чёрная плашка вылазит сверху — нельзя заполнить в прошлом, — и
   *  там кнопочка: нажимаю, и тогда оно даёт возможность записи»). До этого
   *  дня запрет был глухим (2026-08-07: «как можно записать то, что уже
   *  было»), и он мешал ровно там, где выезд состоялся, а завести его забыли.
   *  Теперь правило осталось правилом — но у него есть дверь, и человек
   *  открывает её осознанно, одним тапом по кнопке на плашке (см. createAt).
   *  Перенос существующей записи это не трогает: у него свои правила. */
  const isPastSlot = (dateYmd: string, timeStart: string): boolean => {
    if (dateYmd > todayYmd) return false;
    if (dateYmd < todayYmd) return true;
    const [h, m] = timeStart.split(":").map(Number);
    const startMin = (h || 0) * 60 + (m || 0);
    return nowMinutes != null && startMin < nowMinutes;
  };

  /** В режиме подбора запись ставится ТОЛЬКО в кубик. Зелень обещает «здесь
   *  у команды свободно»; тап мимо неё (обед, нерабочий час, щель между
   *  визитами) уходил в форму молча — и обещание оказывалось краской. */
  const rejectOutsideFreeSlots = (
    dateYmd: string,
    timeStart: string,
  ): boolean => {
    if (!pickClientId) return false;
    const [h, m] = timeStart.split(":").map(Number);
    const startMin = (h || 0) * 60 + (m || 0);
    if ((freeSlotsFor?.(dateYmd) ?? []).some((s) => s.startMin === startMin)) {
      return false;
    }
    haptics.warning();
    toast("Выберите зелёное время — там команда свободна", "info");
    return true;
  };

  /** Выбрали время в режиме подбора — уходим в форму записи с ним. */
  const pickSlotForClient = (dateYmd: string, timeStart: string) => {
    if (!pickClientId) return;
    router.push({
      pathname: "/book",
      params: {
        clientId: pickClientId,
        ...(pick?.locationId ? { locationId: pick.locationId } : {}),
        ...(activeTeamId ? { teamId: activeTeamId } : {}),
        // Услуги прошлого визита («Повторить») и гашение напоминания о ТО
        // доезжают до формы вместе с выбранным временем.
        ...(pick?.services ? { services: pick.services } : {}),
        ...(pick?.reminderId ? { reminderId: pick.reminderId } : {}),
        date: dateYmd,
        // Форма ждёт именно `time_start` — под именем `time` выбранный кубик
        // молча терялся и запись открывалась на дефолтные 10:00.
        time_start: timeStart,
      },
    });
  };

  /** Тап по пустому времени — одна дорога для Недели и Дня. */
  const createAt = (dateYmd: string, timeStart: string) => {
    // Кнопка на плашке зовёт ровно тот же путь, минуя проверки: на них уже
    // ответили тапом по кнопке.
    const open = () => {
      haptics.tap();
      if (pickClientId) {
        pickSlotForClient(dateYmd, timeStart);
        return;
      }
      setSlotDraft({ date: dateYmd, time: timeStart });
    };
    if (rejectOutsideFreeSlots(dateYmd, timeStart)) return;
    // ПЛАШКА ВЫЕЗЖАЕТ НА ТАП ПО СЕТКЕ, И РОВНО ОДИН РАЗ (владелец 2026-08-24:
    // «при тапе на свободное место сверху выезжает плашка и кнопка; топаю на
    // кнопку — тогда открывается меню, чтоб указать время… не надо триггерить
    // несколько раз»). Поэтому причина считается ЗДЕСЬ, до листа, и она одна:
    // прошлое сильнее нерабочего часа — в позавчерашний выходной незачем
    // говорить дважды. Дальше по дороге не спрашивает никто: ни лист выбора
    // времени, ни сама форма записи.
    const [hh, mm] = timeStart.split(":").map(Number);
    const off = offStateAt(workBandFor?.(dateYmd), (hh || 0) * 60 + (mm || 0));
    const reason = isPastSlot(dateYmd, timeStart)
      ? "Это время уже прошло"
      : off
        ? captionFor(off)
        : null;
    if (reason) {
      haptics.warning();
      setNotice({
        message: reason,
        onAction: () => {
          setNotice(null);
          open();
        },
      });
      return;
    }
    setNotice(null);
    open();
  };

  const gridProps = {
    clientName,
    serviceLabel,
    teamColorFor,
    onEdit: openEdit,
    onReschedule: canManageBookings ? reschedule : undefined,
    canReschedule: canMutateAppointment,
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
    // Коммит зума — низким приоритетом: полный ре-рендер сетки на отпускании
    // щипка давал видимый «прыжок» кадра (жалоба владельца). Живая геометрия
    // и так на UI-потоке; здесь догоняют только «холодные» слои (текст-фит).
    onZoom: (v: number) => startTransition(() => setHourH(v)),
  };

  const calendarLoading =
    isLoading ||
    clientsQuery.isLoading ||
    servicesQuery.isLoading ||
    calSettingsQuery.isLoading ||
    citiesQuery.isLoading ||
    dayCitiesQuery.isLoading ||
    teamScheduleQuery.isLoading;
  const calendarError =
    error ||
    teamsQueryError ||
    clientsQuery.error ||
    servicesQuery.error ||
    calSettingsQuery.error ||
    citiesQuery.error ||
    dayCitiesQuery.error ||
    teamScheduleQuery.error;

  // Долгий тап по дате в Неделе — провалиться в День (см. WeekHeaderRow).
  const pickDay = (d: Date) => {
    haptics.tap();
    setDay(startOfDay(d));
    setMode("day");
    rememberView({ mode: "day" });
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
          // Скелет, а не голый спиннер: один экран — один язык ожидания.
          // Полосы чипов в скелете нет — команд ещё нет.
          <CalendarSkeleton mode="week" />
        ) : teamsError ? (
          <EmptyState
            state="error"
            fill
            title="Не удалось загрузить календарь"
            subtitle="Проверьте связь и попробуйте ещё раз"
            action={{ label: "Повторить", onPress: () => void refetchTeams() }}
          />
        ) : role !== "owner" ? (
          <EmptyState
            fill
            title={
              role === "master"
                ? "Календарь ещё не назначен"
                : "В компании ещё нет календарей"
            }
            subtitle={
              role === "master"
                ? "Попросите владельца добавить вас в команду. После назначения заявки появятся здесь."
                : "Первый календарь создаёт владелец компании."
            }
          />
        ) : firstCalendarFailed ? (
          // Запасной выход. В обычной жизни сюда не попадают: календарь
          // заводится сам эффектом выше.
          <FirstRunCalendarChoice
            onCreate={() => {
              setFirstCalendarFailed(false);
              createFirstCalendar();
            }}
            creating={createTeam.isPending}
          />
        ) : (
          // Календарь уже создаётся — показываем скелет сетки, а не кнопку:
          // человек пришёл в календарь, и ждать он должен календарь.
          <CalendarSkeleton mode="week" />
        )}
      </Screen>
    );
  }

  return (
    // No bottom safe-area edge here: inside expo-router Tabs the tab bar
    // already consumes it, so a bottom inset double-counts and floats the
    // Доход/Расход footer ~34pt above the tab bar. Drop it → footer sits flush.
    <Screen edges={["top", "left", "right"]}>
      <View>
      <CalendarHeader
        monthTitle={headerTitle}
        mode={mode}
        todayNumber={now.getDate()}
        isOnToday={isOnToday}
        onModeChange={changeMode}
        // Шестерёнка настраивает ТО, НА ЧТО СМОТРИШЬ: календарь открытой
        // команды. Раньше вела в хаб команды — экран про мастеров, услуги и
        // удаление, где настройки календаря лежали под аккордеоном.
        // activeTeamId здесь всегда есть: без команд экран занят first-run
        // гейтом выше.
        onGear={
          role === "owner"
            ? () => router.push(`/calendar?team=${activeTeamId}`)
            : undefined
        }
        onTitlePress={() => setMiniCalOpen(true)}
        onToday={goToday}
      />
      {notice ? (
        <CalendarNotice
          message={notice.message}
          actionLabel="Записать"
          onAction={notice.onAction}
        />
      ) : null}
      </View>

      {/* ПЛАШКА ПОДБОРА — «кого записываем». Пока она висит, свободное время
          подсвечено зелёным, а тап по сетке ведёт сразу в форму записи.
          Крестик выходит из режима, оставляя календарь там же, где стоите. */}
      {pickClientId ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            marginHorizontal: 12,
            marginTop: 8,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: t.radius.input,
            backgroundColor: `${t.success}1f`,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
            >
              {`Записать: ${pickClientName || "клиент"}`}
            </Text>
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ fontSize: 13, color: t.sub }}
            >
              {`Выберите зелёное время · ${activeTeam?.default_slot_minutes ?? 30} мин`}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              haptics.tap();
              setPick(null);
            }}
            accessibilityRole="button"
            accessibilityLabel="Отменить выбор времени"
            hitSlop={10}
            style={({ pressed }) => ({
              width: 32,
              height: 32,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <X color={t.sub} size={18} strokeWidth={2.4} />
          </Pressable>
        </View>
      ) : null}

      <ScopeChips
        items={calendarTeams}
        activeId={activeTeamId}
        onSelect={(id) => {
          setTeamChoice(id);
          rememberView({ teamId: id });
        }}
      />

      {/* Фоновое дообновление календаря: полоса под шапкой вместо контрола,
          который сам выезжал и сдвигал ленту. */}
      <LoadingBar visible={isRefetching && !pull.refreshing} />

      {calendarLoading ? (
        // mode известен синхронно (MMKV) — скелет обязан обещать ту же
        // геометрию, что придёт после загрузки (день ≠ 7 колонок недели,
        // месяц ≠ сетка часов).
        <CalendarSkeleton mode={mode} />
      ) : calendarError ? (
        // Тот же шаблон, что у ошибки команд выше, и обязательно с
        // «Повторить»: без кнопки экран был тупиком — выйти можно было
        // только убив приложение. Сырой error.message на экран не выводим
        // (он для Sentry, а не для диспетчера на объекте).
        <EmptyState
          state="error"
          fill
          title={
            isColdOfflineCacheMissError(calendarError)
              ? "Календарь недоступен офлайн"
              : "Не удалось загрузить календарь"
          }
          subtitle={
            isColdOfflineCacheMissError(calendarError)
              ? "На этом устройстве ещё нет сохранённой копии. Подключитесь к интернету, чтобы увидеть занятое время и создавать записи."
              : "Проверьте связь и попробуйте ещё раз"
          }
          action={{ label: "Повторить", onPress: () => void onRefresh() }}
        />
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
          labelFor={labelFor}
          offLabelFor={offLabelFor}
          onCreateNew={canManageBookings ? () => bookAt() : undefined}
          showAmounts={!isCrew}
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
        />
      ) : mode === "week" ? (
        <>
          <View className="flex-1">
            <WeekView
              days={weekDays}
              apptsFor={apptsFor}
              today={now}
              labelFor={labelFor}
              offLabelColorFor={offLabelColorFor}
              onCreateAt={canManageBookings ? createAt : undefined}
              onMenu={openActionMenu}
              onPickDay={pickDay}
              onPickLabelDay={
                canManageDayLabels && activeTeamId
                  ? (ymd) => {
                      haptics.tap();
                      setCityPickerYmd(ymd);
                    }
                  : undefined
              }
              onCommitPage={(dir) => setDay((d) => addDays(d, dir * 7))}
              {...gridProps}
            />
          </View>
          {showDayFinance ? (
            <DayFinanceFooter
              days={weekDays}
              appointments={financeWeekAppts}
              teamId={activeTeamId}
              todayYmd={todayYmd}
              onTapDay={(d) => setFinModalYmd(formatYMD(d))}
            />
          ) : null}
        </>
      ) : mode === "day" ? (
        <>
          {/* ПОЛОСЫ-СВОДКИ ДНЯ ЗДЕСЬ НЕТ (владелец 2026-08-15). «N записей ·
              €X · N без оплаты» пересказывала то, что и так стоит на экране:
              записи видно в сетке, деньги дня — в футере под ней, долги — на
              «Финансах». Ряд пиллов только отжимал сетку вниз. */}
          <View className="flex-1">
            <DayView
              dateYmd={dayYmd}
              apptsFor={apptsFor}
              todayYmd={todayYmd}
              labelFor={labelFor}
              offLabelColorFor={offLabelColorFor}
              onDayLabelTap={
                canManageDayLabels && activeTeamId
                  ? () => {
                      haptics.tap();
                      setCityPickerYmd(dayYmd);
                    }
                  : undefined
              }
              onMenu={openActionMenu}
              onCreateAt={canManageBookings ? createAt : undefined}
              onCommitPage={(dir) => setDay((d) => addDays(d, dir))}
              {...gridProps}
            />
          </View>
          {showDayFinance ? (
            <DayFinanceFooter
              days={[day]}
              appointments={financeFor(dayYmd)}
              teamId={activeTeamId}
              todayYmd={todayYmd}
              onTapDay={(d) => setFinModalYmd(formatYMD(d))}
            />
          ) : null}
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
                  showFinance={canViewCompanyFinance}
                  labelFor={labelFor}
                  onPickDay={openWeekFromMonth}
                  onPickLabelDay={
                    canManageDayLabels && activeTeamId
                      ? (ymd) => {
                          haptics.tap();
                          setCityPickerYmd(ymd);
                        }
                      : undefined
                  }
                />
              )}
            />
          </View>
        </GestureDetector>
      )}

      {/* Первый запуск. Гейт по ЗАПИСЯМ: пока в системе нет ни одной записи,
          онбординг ведёт человека по шагам и помечает пройденное галочкой.
          Прежний гейт «0 клиентов И 0 услуг И 0 записей» гасил карточку сразу
          после первого шага — вместе с невыполненным вторым.
          Когда шаги пройдены или карточка закрыта, эстафету принимает тихая
          строка «Пока нет записей» — дыры между состояниями нет. */}
      {canManageBookings && !calendarLoading && !calendarError && appts.length === 0 ? (
        !onboardingDismissed ? (
          <CalendarOnboardingCard
            hasClients={clients.length > 0}
            hasServices={services.length > 0}
            onCreate={() => {
              const slot = suggestFirstSlot(new Date());
              bookAt({ date: formatYMD(slot.date), time_start: slot.time });
            }}
            onDismiss={dismissOnboarding}
          />
        ) : (
          <CalendarEmptyState
            onCreate={() => {
              const slot = suggestFirstSlot(new Date());
              bookAt({ date: formatYMD(slot.date), time_start: slot.time });
            }}
          />
        )
      ) : null}

      {/* Вечерний контроль денег: после 18:00 выполненные СЕГОДНЯ с долгом
          (web EndOfDayBanner) — плавающая карточка над футером. CTA ведёт
          в «Закрыть день» (web parity) — экран ровно этих записей;
          /cabinet/unclosed показывал только просроченные «Запланирован». */}
      {canViewCompanyFinance ? (
        <EndOfDayBanner
          appointments={todayAppts}
          todayYmd={todayYmd}
          nowHour={now.getHours()}
          onOpenUnpaid={() => router.push("/cabinet/close-day")}
        />
      ) : null}

      {/* Разбор финансов дня — тап по футеру Доход/Расход. */}
      {canViewCompanyFinance ? (
        <DayFinanceModal
          dateYmd={finModalYmd}
          appointments={finModalYmd ? financeFor(finModalYmd) : []}
          teamId={activeTeamId}
          onClose={() => setFinModalYmd(null)}
          // Тап по строке «Ожидается» открывает запись — контракт с волной
          // day-extras (проп появляется там же).
          onEditAppointment={openEdit}
        />
      ) : null}

      {/* Тап по пустому слоту — лист «когда и кого записать»: барабан
          даты/времени (шаг 5 минут) + две дороги создания. /book
          открывается уже с выбранными временем и типом. */}
      <BookSlotSheet
        slot={slotDraft}
        bandFor={sheetBandFor}
        onClose={() => setSlotDraft(null)}
        onPick={(kind, s) => {
          setSlotDraft(null);
          bookAt({ date: s.date, time_start: s.time, kind });
        }}
      />

      {/* Метка дня — нижний лист (web parity CityPickerModal); тап по
          активной строке снимает метку. Целевую дату задаёт открывшая
          шапка (День — свой день, Неделя/Месяц — тапнутая дата). */}
      <DayLabelSheet
        visible={cityPickerYmd != null}
        // ВЫХОДНОЙ НА ЭТУ ДАТУ — date-override графика команды: только эта
        // дата, недельный график цел. Строки расписания может не быть вовсе —
        // тогда она РОЖДАЕТСЯ из действующих общих часов, ровно как в редакторе
        // графика, поэтому после сохранения на сетке ничего не «прыгает».
        dayOff={
          cityPickerYmd
            ? teamSchedule?.date_overrides?.[cityPickerYmd]?.is_working === false
            : false
        }
        onToggleDayOff={
          activeTeamId && cityPickerYmd
            ? (next) => {
                const base: TeamSchedule = teamSchedule ?? {
                  start: hourLabel(globalWork.start),
                  end: hourLabel(globalWork.end),
                  breaks: [],
                };
                const day = getDayScheduleForDate(base, parseYMD(cityPickerYmd));
                upsertSchedule.mutate(
                  {
                    teamId: activeTeamId,
                    schedule: setDateOverride(
                      base,
                      cityPickerYmd,
                      next
                        ? { ...day, is_working: false }
                        : // Снятый выходной убирает оверрайд целиком: день
                          // возвращается под недельный график, а не застывает
                          // копией его сегодняшних часов.
                          null,
                    ),
                  },
                  {
                    onError: () =>
                      toast("Не удалось изменить день", "error"),
                  },
                );
              }
            : undefined
        }
        dateKey={cityPickerYmd ?? todayYmd}
        options={labelOptions}
        // Активная строка = разрешённая метка дня (labelFor: явная →
        // default_city, сентинел CITY_CLEARED = ничего) — web parity:
        // current={cityForDate(...)}, дефолт команды показан выбранным.
        selected={cityPickerYmd ? labelFor(cityPickerYmd)?.name ?? "" : ""}
        onPick={(name) => {
          if (activeTeamId && cityPickerYmd) {
            setDayCityMut.mutate({
              teamId: activeTeamId,
              date: cityPickerYmd,
              city: name,
            }, {
              onError: () => toast("Не удалось сохранить метку дня", "error"),
            });
          }
          setCityPickerYmd(null);
        }}
        onClear={() => {
          if (activeTeamId && cityPickerYmd) {
            // Сентинел, не пустая строка: "" удаляет override, и день тут же
            // перекрашивал бы default_city команды (web v693 handleCityReset).
            setDayCityMut.mutate({
              teamId: activeTeamId,
              date: cityPickerYmd,
              city: CITY_CLEARED,
            }, {
              onError: () => toast("Не удалось снять метку дня", "error"),
            });
          }
          setCityPickerYmd(null);
        }}
        onClose={() => setCityPickerYmd(null)}
        // «Настроить» ведёт в БИБЛИОТЕКУ меток — туда, где пишут любое своё
        // слово и красят его (владелец 2026-08-17: «туда можно писать что
        // угодно, это всё метки»). Раньше кнопка открывала НАБОР меток команды
        // и вдобавок уводила в таб «Кабинет»: таб-бар переключался, и «назад»
        // выбрасывало не туда, откуда пришли (закон DS §5). Набор команды —
        // другой вопрос, он живёт в Кабинет → Команды.
        onSettings={
          role === "owner"
            ? () => {
                setCityPickerYmd(null);
                router.push("/calendar/labels");
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

      {/* AppointmentSheet теперь только РЕДАКТИРУЕТ существующую запись —
          создание живёт на отдельном экране /book (тап по слоту, агенда,
          «Записать» с карточки). Поэтому нет ни defaults, ни пре-попапа. */}
      <AppointmentSheet
        visible={sheetOpen && !isCrew && !calendarLoading && !calendarError}
        onClose={() => {
          setSheetOpen(false);
          returnHome();
        }}
        appointment={editing}
      />

      <CrewAppointmentSheet
        appointment={calendarLoading || calendarError ? null : crewViewing}
        onClose={() => {
          setCrewViewing(null);
          returnHome();
        }}
      />

      {/* «Перенести» из контекстного меню — дата + время одним шитом,
          длительность сохраняется. */}
      <RescheduleSheet
        appointment={isCrew || calendarLoading || calendarError ? null : reschedulingApt}
        appointments={visibleAppts}
        workBandFor={workBandFor}
        bufferMinutes={bufferMinutes}
        timeZone={timezone ?? "Europe/Nicosia"}
        onClose={() => setReschedulingApt(null)}
      />
    </Screen>
  );
}
