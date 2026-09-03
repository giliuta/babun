import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text as NativeText,
  TextInput as NativeTextInput,
  View,
  type TextInputProps,
  type TextProps,
} from "react-native";
import { DateTimeInput } from "@/components/ui/DateTimeInput";
import {
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Navigation,
  Palette,
  Phone,
  UserRound,
} from "lucide-react-native";
import type {
  Appointment,
  AppointmentStatus,
  Discount,
  PersonalEventRepeat,
} from "@babun/shared/local/appointments";
import {
} from "@babun/shared/local/appointments";
import {
  locationAddressForBooking,
  type Client,
  type Location,
} from "@babun/shared/local/clients";
import { Spinner } from "@/components/ui/Spinner";
import { ObjectSheet } from "@/features/clients/ObjectSheet";
import { useLocationWriter } from "@/features/clients/use-location-writer";
import { globalDiscountAmount } from "@babun/shared/local/finance/appointment-calc";
import {
  findBufferClash,
  findOverlap,
} from "@babun/shared/common/utils/appointment-overlap";
import { getDayScheduleForDate } from "@babun/shared/local/schedule";
import { tierForVisits } from "@babun/shared/local/loyalty";
import { formatEUR, formatEURExact } from "@babun/shared/common/utils/money";
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
} from "@babun/shared/local/finance/transaction";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";

import { useThemeColors } from "@/theme/colors";
import { ICON } from "@/components/ui/tokens";
import { Screen } from "@/components/ui/Screen";
import { Halo } from "@/components/ui/Halo";
import { tintOver } from "@/components/ui/color-contrast";
import { GradientButton } from "@/components/ui/GradientButton";
import { SectionCard } from "@/components/ui/SectionCard";
import { Chip } from "@/components/ui/Chip";
import { ValueRow } from "@/components/ui/ValueRow";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { AddRow } from "@/components/ui/AddRow";
import { useToast } from "@/components/ui/Toast";
import { resolveDayLabel } from "@babun/shared/local/day-cities";
import { useDayCities } from "@/features/calendar/day-cities";
import { haptics } from "@/lib/haptics";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { directRouteUrl, openDirect, routeTarget } from "@/lib/route-menu";
import { RouteSheet } from "@/features/clients/RouteSheet";
import { useEnabledMapServices } from "@/lib/map-services";

import {
  useClients,
  useUpdateClientById,
} from "@/features/clients/queries";
import {
  useAllServices,
  useServices,
  type Service,
} from "@/features/services/queries";
import { useMasters, useTeams } from "@/features/reference/queries";
import { effectiveBuffer } from "@/features/calendar/setting-options";
import { useTeamSchedule } from "@/features/reference/team-schedule";
import { useAppointments } from "@/features/calendar/queries";
import { useUpdateAppointment } from "@/features/calendar/mutations";
import { useBookingSave } from "@/features/appointments/useBookingSave";
import {
  useCalendarSettings,
  useLoyalty,
  usePersonalEventTypes,
} from "@/features/settings/local-settings";
import { useTeamPaymentAccounts } from "@/features/appointments/payment-accounts";
import {
  buildDebtPaidPatch,
  paymentMethodForAccountKind,
  type PayMethod,
} from "@/features/appointments/payment";
import { UnifiedTimePopup } from "@/features/appointments/UnifiedTimePopup";
import {
  resolveBookingClientPrefill,
  resolveBookingTeamId,
} from "@/features/appointments/booking-prefill";
import { ObjectRow } from "@/features/clients/blocks/ObjectsBlock";
import { servicePlan } from "@/features/clients/service-plan";
import { stashBookingReturn } from "@/features/appointments/pending-client";
import { buildStats } from "@babun/shared/local/selectors/client-stats";
import { buildServiceDue } from "@babun/shared/local/selectors/service-due";
import {
  DocketRow,
  MoneyRow,
  Stepper,
  TotalEditor,
} from "@/features/appointments/BookingSummary";
import {
  ColorSheet,
  TeamMasterSheet,
} from "@/features/appointments/BookingSheets";
import {
  ClientPicker,
  ServicePicker,
} from "@/features/appointments/BookingPickers";
import { formatShortDateRu, visitsWord } from "@/features/clients/format";
import {
  addMinutesHM,
  buildServices,
  formatYMD,
  humanDay,
  minutesBetweenHM,
  parseYMD,
  parseMoneyInput,
  type ServiceOverride,
} from "@/features/appointments/helpers";
import {
  isMasterAllowedForTeam,
  reconcileBookingSelection,
} from "@/features/appointments/booking-selection";
import { durationLabel } from "@/features/services/format";

// Booking is information-dense. Dynamic Type stays enabled, but a bounded
// multiplier prevents headers, totals and calendar controls from colliding at
// accessibility sizes; VoiceOver still reads the full native text.
function Text({ maxFontSizeMultiplier = 1.3, ...props }: TextProps) {
  return (
    <NativeText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />
  );
}

function TextInput({
  maxFontSizeMultiplier = 1.3,
  ...props
}: TextInputProps) {
  return (
    <NativeTextInput
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      {...props}
    />
  );
}

// СПИСКА СТАТУСОВ ЗДЕСЬ БОЛЬШЕ НЕТ (2026-08-30). Руками статус не ставят:
// он выводится из состояния записи и говорит ЦВЕТОМ — «не хватает данных»,
// «готова», «денег нет», «закрыто» (решение владельца о светофоре). Само
// поле `status` живёт как жило: его пишет продукт, а не человек.

const REPEAT_OPTIONS: readonly {
  value: Exclude<PersonalEventRepeat["kind"], "custom_weekdays">;
  label: string;
}[] = [
  { value: "none", label: "Не повторять" },
  { value: "daily", label: "Ежедневно" },
  { value: "weekdays", label: "По будням" },
  { value: "weekly", label: "Каждую неделю" },
  { value: "biweekly", label: "Каждые 2 недели" },
  { value: "monthly", label: "Каждый месяц" },
  { value: "yearly", label: "Каждый год" },
];

const EVENT_REMINDER_OPTIONS = [
  { value: null, label: "Нет" },
  { value: 15, label: "За 15 мин" },
  { value: 60, label: "За 1 час" },
  { value: 1440, label: "За день" },
] as const;

// ИСТОЧНИК ЗАЯВКИ УБРАН ИЗ ЭТОГО ЭКРАНА (владелец 2026-08-30: «убрать
// совсем»). Он жил внутри «Дополнительно».
//
// ПОПРАВКА 2026-08-31, найдено проверкой: сказать «убран из продукта» было
// НЕВЕРНО. Форм записи в продукте ДВЕ, и во второй — `AppointmentSheet`,
// которой правят существующую запись с календаря и из истории визитов, —
// строка «Источник заявки» стоит на виду и полностью работает
// (AppointmentSheet.tsx:2144 и :2590, сохранение в патч на :1128).
//
// Это и есть цена двух форм: любое удаление на одном экране делает работу
// наполовину. Гасить поле во втором файле незачем — он идёт под снос целиком,
// когда этот экран научится править запись; до тех пор источник ЖИВ.

// У цифровой клавиатуры нет клавиши возврата — даём панель «Готово» (iOS).
const EMPTY_LOCATIONS: Location[] = [];
/** Пауза перед первым листом цепочки: столько уезжает попап слота, из
 *  которого сюда пришли. Меньше — и лист подаётся поверх закрывающегося окна,
 *  то есть не появляется вовсе. */
const CHAIN_START_MS = 420;

const KBD_ACCESSORY_ID = "bookKbdDone";
const kbdAccessory = Platform.OS === "ios" ? KBD_ACCESSORY_ID : undefined;

const absoluteMinutes = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    hours < 0 ||
    hours > 24 ||
    minutes < 0 ||
    minutes > 59 ||
    (hours === 24 && minutes !== 0)
  ) {
    return null;
  }
  return hours * 60 + minutes;
};

const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v;

/** СЛОТ = БУФЕРЫ + РАБОТА. Буферы берутся МАКСИМАЛЬНЫЕ по выбранным услугам,
 *  а не суммируются: дорога до адреса одна, и две работы в одном визите не
 *  удваивают её. Без этого календарь показывал свободное время, которого нет,
 *  — бригада в нём едет. */
function serviceBuffersMinutes(
  ids: readonly string[],
  catalog: Map<string, Service>,
): number {
  const before = Math.max(
    0,
    ...ids.map((id) => catalog.get(id)?.buffer_before_min ?? 0),
    0,
  );
  const after = Math.max(
    0,
    ...ids.map((id) => catalog.get(id)?.buffer_after_min ?? 0),
    0,
  );
  return before + after;
}

export default function BookScreen() {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  // Пропуск гварда для программного ухода (сохранение / подтверждённое «Закрыть»),
  // чтобы back-свайп-защита не показывала второй Alert поверх нашего.
  const bypassGuardRef = useRef(false);
  const toast = useToast();
  const { data: dayCities = {} } = useDayCities();
  const params = useLocalSearchParams<{
    date?: string;
    time_start?: string;
    kind?: string;
    teamId?: string;
    clientId?: string;
    locationId?: string;
    services?: string;
    reminderId?: string;
    /** Правка существующей записи. Та же страница, тот же порядок полей —
     *  других форм записи в продукте нет (STORY-064). */
    appointmentId?: string;
  }>();

  // ── справочные данные (кеш уже тёплый — календарь грузит те же ключи) ──
  const teamsQuery = useTeams();
  const mastersQuery = useMasters();
  const servicesQuery = useServices();
  // Услуга типа «варианты» продаётся выбором объёма работ, а не количеством:
  // трёхкомнатная квартира — это не «три раза комната».
  const clientsQuery = useClients();
  const appointmentsQuery = useAppointments();
  const loyaltyQuery = useLoyalty();
  const calendarSettingsQuery = useCalendarSettings();
  const eventTypesQuery = usePersonalEventTypes();
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const masters = useMemo(() => mastersQuery.data ?? [], [mastersQuery.data]);
  const services = useMemo(() => servicesQuery.data ?? [], [servicesQuery.data]);
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);
  const allAppts = useMemo(
    () => appointmentsQuery.data ?? [],
    [appointmentsQuery.data],
  );
  const loyalty = loyaltyQuery.data;
  const calendarSettings = calendarSettingsQuery.data;
  const eventTypes = useMemo(
    () => eventTypesQuery.data ?? [],
    [eventTypesQuery.data],
  );
  // Создание заявки и весь его хвост (закрытие напоминания, синхронизация
  // push события, тосты, хаптика) живут в общем хуке — на нём же строится
  // шторка «Записать» с карточки клиента, чтобы путь создания остался один.
  const booking = useBookingSave();
  const rawReminderId = first(params.reminderId);
  const reminderId =
    rawReminderId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      rawReminderId,
    )
      ? rawReminderId
      : null;
  const teamsLoading = teamsQuery.isLoading;
  const clientsLoading = clientsQuery.isLoading;

  const catalog = useMemo(
    () => new Map(services.map((s) => [s.id, s])),
    [services],
  );
  // ИМЯ РАБОТЫ ЖИВЁТ ДОЛЬШЕ САМОЙ УСЛУГИ. `catalog` — про выбор и цену новых
  // строк, и он справедливо не знает убранных из прайса; но запись, в которой
  // услуга стоит с мая, обязана называть её по имени. Тот же справочник, что
  // держала карточка записи.
  const { data: allServices = [] } = useAllServices();
  const nameById = useMemo(
    () => new Map(allServices.map((s) => [s.id, s.name])),
    [allServices],
  );

  // ── ПРАВКА СУЩЕСТВУЮЩЕЙ ЗАПИСИ (STORY-064) ──
  // Одна страница создаёт и правит. Запись берём из того же списка, что
  // рисует календарь: кеш уже тёплый, отдельный запрос завёл бы вторую
  // правду о той же записи.
  const editId = first(params.appointmentId) ?? null;
  const isEdit = editId != null;
  const editing = useMemo(
    () => (editId ? allAppts.find((a) => a.id === editId) ?? null : null),
    [allAppts, editId],
  );
  const updateMut = useUpdateAppointment();

  // ── роли на этой странице пока нет (владелец 2026-08-30: «сейчас мы делаем
  //    как для одного, для директора… а потом уже, когда сделаем страницу
  //    мастера и будем добавлять сотрудников, тогда уже будем делать под
  //    каждый блок разрешения»). Скидка поэтому открыта всем, кто дошёл до
  //    формы; прежний owner-only гейт снят, а не расширен на правку —
  //    иначе правило существовало бы в одной дороге из двух (находка Б2). ──

  // ── состояние ──
  const initialKind = first(params.kind) === "event" ? "event" : "work";
  const [kind, setKind] = useState<"work" | "event">(initialKind);
  const [clientId, setClientId] = useState<string | null>(
    first(params.clientId) ?? null,
  );
  const [date, setDate] = useState<string>(
    first(params.date) ?? formatYMD(getCurrentCyprusTime()),
  );
  const dateSeedRef = useRef(date);
  const dateTouchedRef = useRef(false);
  const [timeStart, setTimeStart] = useState<string>(
    first(params.time_start) ?? "10:00",
  );
  const [timeEnd, setTimeEnd] = useState<string>(() =>
    addMinutesHM(first(params.time_start) ?? "10:00", 60),
  );
  const [durationTouched, setDurationTouched] = useState(false);
  const [serviceIds, setServiceIds] = useState<string[]>(
    first(params.services)?.split(",").filter(Boolean) ?? [],
  );
  const [overrides, setOverrides] = useState<Record<string, ServiceOverride>>(
    {},
  );
  const [teamId, setTeamId] = useState<string | null>(
    first(params.teamId) ?? null,
  );
  const teamScheduleQuery = useTeamSchedule(teamId ?? undefined);
  const [masterId, setMasterId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(
    first(params.locationId) ?? null,
  );
  const [address, setAddress] = useState("");
  const [customTotal, setCustomTotal] = useState(false);
  const [totalDraft, setTotalDraft] = useState("");
  const [discountType, setDiscountType] = useState<Discount["type"] | null>(
    null,
  );
  const [discountValue, setDiscountValue] = useState("");
  const [discountReason, setDiscountReason] = useState<string | null>(null);
  const [status, setStatus] = useState<AppointmentStatus>("scheduled");
  const [comment, setComment] = useState("");
  // Название события — отдельное состояние от заметки команде: раньше общий
  // `comment` перетекал между режимами Клиент/Событие.
  const [eventTitle, setEventTitle] = useState("");
  const [eventColor, setEventColor] = useState<string | null>(null);
  const [eventTypeId, setEventTypeId] = useState<string | null>(null);
  const [eventNotes, setEventNotes] = useState("");
  const [eventAddress, setEventAddress] = useState("");
  const [eventUrl, setEventUrl] = useState("");
  const [eventReminderOffset, setEventReminderOffset] = useState<number | null>(
    null,
  );
  const [repeat, setRepeat] = useState<PersonalEventRepeat>({ kind: "none" });
  const [allDay, setAllDay] = useState(false);
  const [prepayDraft, setPrepayDraft] = useState("");
  const [payMethod, setPayMethod] = useState<PayMethod | null>(null);
  // Куда кладут деньги. Как в карточке записи: тапают кассу, способ
  // выводится из её вида. Без счёта сервер угадывает — и промахивается.
  const [payAccountId, setPayAccountId] = useState<string | null>(null);
  const { data: payAccounts = [] } = useTeamPaymentAccounts(teamId);
  const [reminderOn, setReminderOn] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const [whenOpen, setWhenOpen] = useState(false);
  const [teamSheetOpen, setTeamSheetOpen] = useState(false);
  const [colorSheetOpen, setColorSheetOpen] = useState(false);
  const [colorOverride, setColorOverride] = useState<string | null>(null);
  const [objectSheet, setObjectSheet] = useState(false);
  const updateClient = useUpdateClientById();

  // ── умные дефолты из истории (как старый шит) ──
  const lastTeamId = useMemo(() => {
    let best: string | null = null;
    let bestTs = "";
    for (const a of allAppts) {
      if (a.team_id && a.created_at > bestTs && teams.some((tm) => tm.id === a.team_id)) {
        bestTs = a.created_at;
        best = a.team_id;
      }
    }
    return best;
  }, [allAppts, teams]);

  const recentClientIds = useMemo(() => {
    const sorted = [...allAppts]
      .filter((a) => a.client_id)
      .sort((a, b) =>
        a.date !== b.date
          ? b.date.localeCompare(a.date)
          : b.time_start.localeCompare(a.time_start),
      );
    const out: string[] = [];
    for (const a of sorted) {
      const id = a.client_id as string;
      if (!out.includes(id)) {
        out.push(id);
        if (out.length >= 5) break;
      }
    }
    return out;
  }, [allAppts]);

  const frequentServices = useMemo(() => {
    const freq = new Map<string, number>();
    for (const a of allAppts)
      for (const id of a.service_ids) freq.set(id, (freq.get(id) ?? 0) + 1);
    return [...freq.entries()]
      .filter(([id]) => catalog.has(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([id]) => catalog.get(id) as Service);
  }, [allAppts, catalog]);

  // Прайс ВЫБРАННОЙ команды: услуга принадлежит ровно одной команде
  // (2026-08-17). Пока команда не выбрана, каталог пуст — см.
  // `isServiceAllowedForTeam`.
  const teamServices = useMemo(
    () => services.filter((s) => teamId != null && s.team_id === teamId),
    [services, teamId],
  );
  const allowedServiceIds = useMemo(
    () => new Set(teamServices.map((service) => service.id)),
    [teamServices],
  );
  const frequentTeamServices = useMemo(
    () => frequentServices.filter((service) => allowedServiceIds.has(service.id)),
    [allowedServiceIds, frequentServices],
  );

  const selectTeam = (nextTeamId: string | null) => {
    const next = reconcileBookingSelection({
      teamId: nextTeamId,
      serviceIds,
      masterId,
      services,
      masters,
    });
    setTeamId(nextTeamId);
    setServiceIds(next.serviceIds);
    setMasterId(next.masterId);
    const keep = new Set(next.serviceIds);
    setOverrides((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([serviceId]) => keep.has(serviceId)),
      ),
    );
  };

  const client = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  );
  const clientLocations = client?.locations ?? [];

  // ═══ МЕТКА КЛИЕНТА ПРОТИВ МЕТКИ ДНЯ ═══
  //
  // Владелец 2026-08-29: «вы записываете клиента, у которого уже была метка
  // такая-то — просто предупреждение».
  //
  // Метка у клиента появляется сама: рабочая запись в день с явной меткой
  // переносит её на клиента (`autoAssignClientLabel`, решение 2026-07-22).
  // То есть метка клиента — это «где его обслуживали в прошлый раз», а метка
  // дня — «где команда работает в этот день». Их расхождение и есть тот
  // случай, ради которого метки заводились: бригада едет в Лимассол, а в
  // день просунули клиента из Пафоса — крюк на полдня, о котором узнают
  // утром на выезде.
  //
  // ПРЕДУПРЕЖДЕНИЕ, А НЕ ЗАПРЕТ. Причин записать «не туда» полно: клиент сам
  // приедет, работа срочная, по пути. Продукт называет факт и уходит с
  // дороги.
  //
  // МОЛЧИТ, КОГДА МЕТКИ СОВПАЛИ: сообщать «вы записываете клиента туда же,
  // куда и всегда» — это шум, который научит не читать плашки вовсе.
  const clientLabel = (client?.city ?? "").trim();
  const dayLabel = resolveDayLabel(dayCities, teamId, date);
  const labelClash = useMemo(
    () =>
      clientLabel !== "" && dayLabel !== null && dayLabel !== clientLabel
        ? { client: clientLabel, day: dayLabel }
        : null,
    [clientLabel, dayLabel],
  );
  // Показываем ОДИН раз на пару «клиент + день», а не на каждый рендер:
  // плашка, выезжающая от каждого касания формы, читается как поломка.
  const clashShown = useRef<string | null>(null);
  useEffect(() => {
    if (!labelClash || !clientId) {
      clashShown.current = null;
      return;
    }
    const key = `${clientId}|${date}|${labelClash.day}`;
    if (clashShown.current === key) return;
    clashShown.current = key;
    toast(
      `Клиент из «${labelClash.client}», а день — «${labelClash.day}»`,
      "warn",
    );
  }, [labelClash, clientId, date, toast]);
  const team = teams.find((tm) => tm.id === teamId) ?? null;
  const slotFallback = team?.default_slot_minutes ?? 30;

  // A direct /book open has no calendar date parameter. Resolve that default
  // in the selected brigade's wall clock (or the company timezone), so a
  // dispatcher working around midnight does not create a job on the device's
  // date by accident. Never overwrite a date the operator already touched.
  useEffect(() => {
    if (first(params.date) || dateTouchedRef.current) return;
    const timeZone = team?.timezone ?? calendarSettings?.timezone;
    if (!timeZone || date !== dateSeedRef.current) return;
    const next = formatYMD(getCurrentTimeInZone(timeZone));
    dateSeedRef.current = next;
    if (next !== date) setDate(next);
  }, [calendarSettings?.timezone, date, params.date, team?.timezone]);

  // Богатая строка истории клиента (web parity: «6 визитов · €600 · был 30 мая»).
  const clientHistory = useMemo(() => {
    if (!client) return null;
    const s = buildStats(client, allAppts);
    const segs = [
      s.visits > 0 ? `${s.visits} ${visitsWord(s.visits)}` : null,
      s.totalSpent > 0 ? formatEUR(s.totalSpent) : null,
      // Без «был» — не угадываем пол клиента.
      s.lastVisitDate ? `визит ${formatShortDateRu(s.lastVisitDate)}` : null,
    ].filter(Boolean) as string[];
    return segs.length > 0 ? segs.join(" · ") : null;
  }, [client, allAppts]);

  // Оборудование объекта → визит в сервисном бизнесе часто ТО-driven:
  // подсвечиваем просроченное/скорое обслуживание прямо в герое.
  const serviceDue = useMemo(
    () => (client ? buildServiceDue(client) : null),
    [client],
  );
  const serviceDueCount = serviceDue
    ? serviceDue.overdue.length + serviceDue.soon.length
    : 0;

  // ═══ ГИДРАЦИЯ ПРАВКИ ═══
  //
  // Один раз, когда запись доехала из кеша. Дальше страница живёт обычной
  // жизнью: все умные дефолты ниже (команда, префилл клиента, лояльность,
  // авто-конец) выключены в режиме правки — им нечего доопределять, а
  // затереть сохранённое они могут.
  //
  // ЗАМОК СТРОК ОБЯЗАТЕЛЕН. Сохранённая строка отдаёт числа того дня, когда
  // её записали, а не сегодняшний прайс. Без `locked` открытие майской
  // записи пересобирало бы её из нынешнего каталога: подняли цену «Чистки» —
  // и любой, кто просто заглянул в запись, переписал её деньги и долг
  // клиента. Тот же снимок, что держит карточка записи.
  // ФЛАГ ГОТОВНОСТИ, А НЕ REF. Эффекты «авто-конец» и «сумма по услугам»
  // объявлены НИЖЕ гидрации, поэтому в том же коммите отрабатывают следом за
  // ней — но со СТАРЫМ состоянием: конец записи становился 10:30 от дефолтных
  // 10:00, а итог обнулялся. Ref здесь не спасает: он выставляется синхронно и
  // к моменту их запуска уже истинен. Флаг состояния переключается только со
  // следующим рендером — то есть ровно тогда, когда гидрация УЖЕ легла.
  // Создание готово сразу: доопределять там нечего.
  const [hydrated, setHydrated] = useState(!isEdit);
  const editHydrated = useRef(false);
  useEffect(() => {
    if (!isEdit || editHydrated.current || !editing) return;
    editHydrated.current = true;
    setKind(editing.kind === "work" ? "work" : "event");
    setClientId(editing.client_id);
    setDate(editing.date);
    setTimeStart(editing.time_start);
    setTimeEnd(editing.time_end);
    setServiceIds(
      editing.service_ids?.length
        ? editing.service_ids
        : (editing.services ?? []).map((s) => s.serviceId),
    );
    setOverrides(
      Object.fromEntries(
        (editing.services ?? []).map((s) => {
          const byHand = s.pricePerUnit !== s.originalPrice;
          return [
            s.serviceId,
            {
              qty: s.quantity,
              ...(byHand ? { price: s.pricePerUnit } : {}),
              locked: {
                pricePerUnit: s.pricePerUnit,
                originalPrice: s.originalPrice,
                duration: s.duration,
                serviceName: s.serviceName,
                unit: s.unit,
              },
            },
          ];
        }),
      ),
    );
    setTeamId(editing.team_id);
    setMasterId(editing.master_id ?? null);
    setLocationId(editing.location_id ?? null);
    setAddress(editing.address ?? "");
    setCustomTotal(!!editing.custom_total);
    setTotalDraft(String(editing.total_amount ?? 0));
    setDiscountType(editing.global_discount?.type ?? null);
    setDiscountValue(
      editing.global_discount ? String(editing.global_discount.value) : "",
    );
    setDiscountReason(editing.global_discount?.reason ?? null);
    setStatus(editing.status);
    setReminderOn(editing.reminder_enabled);
    setColorOverride(editing.color_override ?? null);
    setPrepayDraft(
      (editing.prepaid_amount ?? 0) > 0 ? String(editing.prepaid_amount) : "",
    );
    setPayMethod(editing.payment_method ?? null);
    setPayAccountId(editing.payment_account_id ?? null);
    if (editing.kind === "work") {
      setComment(editing.comment ?? "");
    } else {
      setEventTitle(editing.comment ?? "");
      setEventColor(editing.color_override ?? null);
      setEventNotes(editing.event_notes ?? "");
      setEventAddress(editing.address ?? "");
      setEventUrl(editing.event_url ?? "");
      setEventReminderOffset(
        editing.event_push_enabled
          ? editing.event_push_offsets?.[0] ?? null
          : null,
      );
      setAllDay(editing.event_all_day ?? false);
      setRepeat(editing.event_repeat ?? { kind: "none" });
    }
    // Дата и конец записи заданы самой записью — эффекты «умного» роста и
    // резолва таймзоны обязаны молчать.
    dateTouchedRef.current = true;
    setDurationTouched(true);
    setHydrated(true);
  }, [isEdit, editing]);

  // ── дефолт команды при первом рендере (params → последняя → первая) ──
  const teamSeeded = useRef(false);
  const clientPrefillHydrated = useRef(false);
  useEffect(() => {
    if (isEdit) return;
    if (teamSeeded.current || teamsLoading) return;
    const resolved = resolveBookingTeamId(
      first(params.teamId),
      teams,
      lastTeamId,
    );
    if (teamId !== resolved) setTeamId(resolved);
    teamSeeded.current = true;
  }, [isEdit, teams, teamsLoading, lastTeamId, teamId, params.teamId]);

  // Reference data can arrive in a different order. Reconcile URL/client
  // prefills after every successful catalog refresh so stale selections can
  // never be submitted under the wrong brigade.
  //
  // ПРАВКУ НЕ СВЕРЯЕМ. У сохранённой записи услуга могла уехать из каталога
  // или сменить команду — и тогда сверка молча вычистила бы оплаченные
  // строки из чужой записи. Их держит замок снимка, а не сегодняшний прайс.
  useEffect(() => {
    if (isEdit) return;
    if (!teamsQuery.isSuccess || !servicesQuery.isSuccess || !mastersQuery.isSuccess) {
      return;
    }
    const next = reconcileBookingSelection({
      teamId,
      serviceIds,
      masterId,
      services,
      masters,
    });
    if (next.serviceIds.join("\u0000") !== serviceIds.join("\u0000")) {
      setServiceIds(next.serviceIds);
      const keep = new Set(next.serviceIds);
      setOverrides((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([serviceId]) => keep.has(serviceId)),
        ),
      );
    }
    if (next.masterId !== masterId) setMasterId(next.masterId);
  }, [
    isEdit,
    masterId,
    masters,
    mastersQuery.isSuccess,
    serviceIds,
    services,
    servicesQuery.isSuccess,
    teamId,
    teamsQuery.isSuccess,
  ]);

  // Карточка клиента открывает /book уже с clientId/locationId. Это должно
  // заполнить ТОТ ЖЕ snapshot адреса, что ручной выбор ниже; иначе запись
  // сохраняла location_id с пустыми address/address_note. Гидратируем ровно
  // один раз после загрузки клиентов, чтобы не перетирать ручной ввод адреса.
  useEffect(() => {
    if (isEdit) return;
    if (clientPrefillHydrated.current || clientsLoading) return;
    const requestedClientId = first(params.clientId);
    if (!requestedClientId) {
      clientPrefillHydrated.current = true;
      return;
    }
    const requestedClient = clients.find(
      (item) => item.id === requestedClientId,
    );
    if (!requestedClient) {
      setClientId(null);
      setLocationId(null);
      clientPrefillHydrated.current = true;
      return;
    }
    const prefill = resolveBookingClientPrefill(
      requestedClient,
      first(params.locationId),
    );
    setClientId(prefill.clientId);
    setLocationId(prefill.locationId);
    setAddress(prefill.address);
    if (prefill.masterId) setMasterId(prefill.masterId);
    clientPrefillHydrated.current = true;
  }, [isEdit, clients, clientsLoading, params.clientId, params.locationId]);

  // ── производные суммы ──
  const selectedServices = useMemo(
    () => buildServices(serviceIds, catalog, overrides),
    [serviceIds, catalog, overrides],
  );
  const computedTotal = useMemo(
    () => selectedServices.reduce((s, x) => s + x.totalPrice, 0),
    [selectedServices],
  );
  const computedDuration = useMemo(
    () =>
      selectedServices.reduce((s, x) => s + x.duration, 0) +
      serviceBuffersMinutes(serviceIds, catalog),
    [selectedServices, serviceIds, catalog],
  );

  const globalDiscount: Discount | null = useMemo(() => {
    if (!discountType) return null;
    const value = parseMoneyInput(discountValue);
    if (!value) return null;
    return { type: discountType, value, reason: discountReason ?? undefined };
  }, [discountType, discountValue, discountReason]);

  const discountAmount = globalDiscountAmount(selectedServices, globalDiscount);
  const automaticTotal = Math.max(0, computedTotal - discountAmount);
  const effectiveTotal = customTotal
    ? parseMoneyInput(totalDraft)
    : automaticTotal;
  const prepay = parseMoneyInput(prepayDraft);
  const prepayExceedsTotal = prepay > effectiveTotal;
  const debtAfter = Math.max(0, effectiveTotal - prepay);

  // Keep the editable total in sync with catalog pricing until the operator
  // explicitly changes it. A manual amount then stays stable while services
  // are adjusted; «По услугам» reconnects it to the automatic calculation.
  useEffect(() => {
    if (!hydrated) return;
    if (customTotal) return;
    // Копейки не отбрасываем: «49.5» в поле рядом с «€49,50» в строке
    // услуги читались как две разные суммы за одну работу.
    setTotalDraft(
      Number.isInteger(automaticTotal)
        ? String(automaticTotal)
        : automaticTotal.toFixed(2),
    );
  }, [automaticTotal, customTotal, hydrated]);

  // ── авто-конец = старт + Σ длительности (растёт, не трогали руками) ──
  useEffect(() => {
    if (!hydrated) return;
    if (durationTouched) return;
    const grow = computedDuration > 0 ? computedDuration : slotFallback;
    setTimeEnd(addMinutesHM(timeStart, grow));
  }, [timeStart, computedDuration, durationTouched, slotFallback, hydrated]);

  // ── лояльность показана, не спрятана: авто-скидка по числу визитов ──
  //
  // ТОЛЬКО ПРИ СОЗДАНИИ. В сохранённой записи скидка — уже принятое решение,
  // о котором договорились с клиентом. Пересчитать её при открытии значит
  // молча уценить чужую запись и включить ложное «есть несохранённое».
  const loyaltyAppliedRef = useRef(false);
  useEffect(() => {
    if (isEdit) return;
    if (kind !== "work" || !client || !loyalty) return;
    // ручная скидка всегда побеждает; авто-скидка заменяет только себя.
    if (discountType && !loyaltyAppliedRef.current) return;
    const visits = allAppts.filter(
      (a) => a.client_id === client.id && a.status === "completed",
    ).length;
    const tier = tierForVisits(visits, loyalty);
    if (tier) {
      setDiscountType("percent");
      setDiscountValue(String(tier.percent));
      setDiscountReason(tier.label);
      loyaltyAppliedRef.current = true;
    } else if (loyaltyAppliedRef.current) {
      setDiscountType(null);
      setDiscountValue("");
      setDiscountReason(null);
      loyaltyAppliedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, loyalty, kind]);

  // ── пересечение по команде на выбранный день (warn, not block) ──
  const dayTeamAppts = useMemo(
    () =>
      allAppts.filter((a) => a.date === date && a.team_id === teamId),
    [allAppts, date, teamId],
  );
  const overlap = useMemo(() => {
    if (kind !== "work" || !teamId) return null;
    return findOverlap(
      {
        id: "book-draft",
        date,
        time_start: timeStart,
        time_end: timeEnd,
        kind: "work",
        status: "scheduled",
      } as unknown as Appointment,
      dayTeamAppts,
    );
  }, [kind, teamId, date, timeStart, timeEnd, dayTeamAppts]);
  const timeWarning = useMemo(() => {
    if (kind !== "work" || !teamId) return null;
    const startMinutes = absoluteMinutes(timeStart) ?? 0;
    const endMinutes = absoluteMinutes(timeEnd) ?? 0;
    const schedule = teamScheduleQuery.data;

    if (schedule) {
      const daySchedule = getDayScheduleForDate(schedule, parseYMD(date));
      if (!daySchedule.is_working) return "У команды нерабочий день";
      const scheduleStart = absoluteMinutes(daySchedule.start);
      const scheduleEnd = absoluteMinutes(daySchedule.end);
      if (
        scheduleStart != null &&
        scheduleEnd != null &&
        (startMinutes < scheduleStart || endMinutes > scheduleEnd)
      ) {
        return `Вне графика команды ${daySchedule.start}–${daySchedule.end}`;
      }
      if (
        daySchedule.breaks.some((pause) => {
          const pauseStart = absoluteMinutes(pause.start);
          const pauseEnd = absoluteMinutes(pause.end);
          return (
            pauseStart != null &&
            pauseEnd != null &&
            startMinutes < pauseEnd &&
            endMinutes > pauseStart
          );
        })
      ) {
        return "Время попадает на перерыв команды";
      }
    } else {
      const scheduleStart = Math.round(
        (calendarSettings?.workStartHour ?? calendarSettings?.startHour ?? 6) *
          60,
      );
      const scheduleEnd = Math.round(
        (calendarSettings?.workEndHour ?? calendarSettings?.endHour ?? 22) *
          60,
      );
      if (startMinutes < scheduleStart || endMinutes > scheduleEnd) {
        return "Вне общих рабочих часов";
      }
    }

    // Буфер команды сильнее компанейского (тот же резолвер, что у сетки):
    // предупреждение «между записями меньше N мин» обязано считать по той
    // команде, на которую записывают.
    const bufferMinutes = effectiveBuffer(
      teams.find((x) => x.id === teamId),
      calendarSettings,
    );
    const tight = findBufferClash(
      {
        id: "book-draft",
        date,
        time_start: timeStart,
        time_end: timeEnd,
        kind: "work",
        status: "scheduled",
      } as unknown as Appointment,
      dayTeamAppts,
      bufferMinutes,
    );
    return tight && bufferMinutes > 0
      ? `Между записями меньше ${bufferMinutes} мин на дорогу`
      : null;
  }, [
    calendarSettings,
    teams,
    date,
    dayTeamAppts,
    kind,
    teamId,
    teamScheduleQuery.data,
    timeEnd,
    timeStart,
  ]);

  // ── выбор клиента: подставить объект + адрес + любимого мастера ──
  // ЦЕПОЧКА «СЛОТ → КЛИЕНТ → УСЛУГА» (владелец 2026-08-31: «нажимаю клиент —
  // открывается страница и сразу же ещё одна, с выбором клиента; после этого
  // сразу появляется страница выбора услуги… и можно закрыть, не выбирая»).
  //
  // Половина заявок начинается одинаково: время уже названо в попапе слота, а
  // дальше человек всё равно идёт в клиента и в услуги. Два тапа, которые он
  // сделает в любом случае, продукт делает за него — но НИЧЕГО НЕ ТРЕБУЕТ:
  // каждый лист закрывается, и под ним обычная форма.
  //
  // ТОЛЬКО НА СОЗДАНИИ. У правки клиент и услуги уже выбраны, и всплывший
  // поверх лист был бы помехой, а не помощью.
  //
  // ОДИН РАЗ ЗА ЖИЗНЬ ЭКРАНА: `ref`, а не состояние. Закрыл лист — цепочка
  // кончилась и сама не воскреснет; иначе закрытие выглядело бы сломанным.
  const chainRef = useRef<"idle" | "client" | "done">("idle");
  const pickClient = (c: Client) => {
    // НЕ сбрасываем loyaltyAppliedRef здесь: сброс заставлял эффект принять
    // авто-скидку прошлого клиента за ручную (discountType && !ref → return) и
    // перенести её на нового. Эффект сам пересчитает лояльность по clientId.
    const prefill = resolveBookingClientPrefill(c);
    // Continuity: команда по ПОСЛЕДНЕМУ визиту клиента, а не глобально-последняя.
    // Иначе любимый мастер клиента отсеивается как «не из той команды».
    const lastTeamForClient =
      [...allAppts]
        .filter(
          (a) =>
            a.client_id === c.id &&
            a.team_id &&
            teams.some((tm) => tm.id === a.team_id),
        )
        .sort((a, b) =>
          a.date !== b.date
            ? b.date.localeCompare(a.date)
            : b.time_start.localeCompare(a.time_start),
        )[0]?.team_id ?? null;
    const targetTeam = lastTeamForClient ?? teamId;
    if (lastTeamForClient && lastTeamForClient !== teamId) {
      selectTeam(lastTeamForClient);
    }
    setClientId(prefill.clientId);
    setLocationId(prefill.locationId);
    setAddress(prefill.address);
    if (
      prefill.masterId &&
      isMasterAllowedForTeam(
        masters.find((candidate) => candidate.id === prefill.masterId),
        targetTeam,
      )
    ) {
      setMasterId(prefill.masterId);
    }
    haptics.tap();
    // ЗА КЛИЕНТОМ СРАЗУ ИДУТ УСЛУГИ — второе звено цепочки (владелец
    // 2026-08-31: «когда я выбираю клиента или создаю, сразу появляется
    // страница выбора услуги»). Только на СВЕЖЕЙ записи и ровно один раз:
    // человек, который вернулся сменить клиента у собранной записи, не должен
    // получать поверх неё лист услуг.
    if (chainRef.current === "client" && serviceIds.length === 0) {
      chainRef.current = "done";
      setServicePickerOpen(true);
    }
  };

  const pickLocation = (id: string) => {
    setLocationId(id);
    const loc = clientLocations.find((l) => l.id === id);
    if (loc) {
      setAddress(locationAddressForBooking(loc));
    }
    haptics.tap();
  };

  // Объект пишется ТОЛЬКО каноническим листом (ObjectSheet) — тем же, что на
  // карточке клиента. Своя форма здесь собирала массив locations снимком
  // рендера (взаимное затирание одной jsonb-колонки), знала свой список меток
  // и в крайнем случае писала мусорный тип «Объект».
  const updateClientPatch = async (patch: Partial<Client>) => {
    if (!clientId) return false;
    try {
      await updateClient.mutateAsync({ id: clientId, patch });
      return true;
    } catch {
      // useUpdateClientById показывает причину; правку не считаем записанной.
      return false;
    }
  };

  // Писатель объектов для листа добавления: на этом экране он единственный,
  // но живёт снаружи листа — как на карточке, где писатель общий для всех
  // листов сразу.
  const locationWriter = useLocationWriter(
    client?.locations ?? EMPTY_LOCATIONS,
    updateClientPatch,
  );

  const toggleService = (id: string) => {
    setServiceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    haptics.tap();
  };
  const setQty = (id: string, qty: number) => {
    if (qty < 1) {
      setServiceIds((p) => p.filter((x) => x !== id));
      return;
    }
    setOverrides((p) => ({ ...p, [id]: { ...p[id], qty } }));
  };

  // «Закрыть на месте» — главное действие полевого сервиса (приехал-сделал-
  // закрыл): статус Выполнено + полная оплата сейчас + способ (по умолчанию
  // нал). Раньше это было 4–5 тапов по двум свёрнутым секциям.
  const closeOnSite = () => {
    setStatus("completed");
    setPrepayDraft(String(Number(effectiveTotal.toFixed(2))));
    if (!payMethod) setPayMethod("cash");
    setShowPay(true);
    haptics.tap();
  };

  const applyEventType = (id: string) => {
    const preset = eventTypes.find((candidate) => candidate.id === id);
    if (!preset) return;
    setEventTypeId(preset.id);
    // Не затираем уже введённое название — подставляем метку типа только в
    // пустое поле (раньше тап по типу после ввода терял текст).
    if (!eventTitle.trim()) setEventTitle(preset.label);
    setEventColor(preset.color);
    setAllDay(preset.allDay);
    if (preset.allDay) {
      setTimeStart("00:00");
      setTimeEnd("23:59");
    } else {
      const start = allDay || timeStart === "00:00" ? "10:00" : timeStart;
      setTimeStart(start);
      setTimeEnd(addMinutesHM(start, preset.defaultDuration));
    }
    setDurationTouched(true);
    haptics.tap();
  };

  const repeatUntil = repeat.kind === "none" ? undefined : repeat.until;
  const setRepeatKind = (
    nextKind: Exclude<PersonalEventRepeat["kind"], "custom_weekdays">,
  ) => {
    if (nextKind === "none") {
      setRepeat({ kind: "none" });
      return;
    }
    setRepeat({
      kind: nextKind,
      ...(repeatUntil ? { until: repeatUntil } : {}),
    } as PersonalEventRepeat);
  };

  // ── сохранение (тот же контракт, что старый шит) ──
  const buildPatch = (): Partial<Appointment> => {
    if (kind === "event") {
      return {
        kind: "event",
        date,
        time_start: timeStart,
        time_end: timeEnd,
        event_all_day: allDay,
        event_repeat: repeat,
        event_notes: eventNotes.trim(),
        event_url: eventUrl.trim(),
        event_push_enabled: eventReminderOffset != null,
        event_push_offsets:
          eventReminderOffset == null ? [] : [eventReminderOffset],
        event_push_at: null,
        team_id: teamId,
        // Team events belong to the team; personal events belong to their
        // creator through RLS. A hidden stale work-master must not leak in.
        master_id: null,
        status: "scheduled",
        comment: eventTitle.trim(),
        address: eventAddress.trim(),
        color_override: eventColor,
        client_id: null,
        location_id: null,
        service_ids: [],
        services: [],
        total_amount: 0,
        custom_total: false,
        global_discount: null,
        discount_amount: 0,
      };
    }
    const patch: Partial<Appointment> = {
      kind: "work",
      client_id: clientId,
      date,
      time_start: timeStart,
      time_end: timeEnd,
      team_id: teamId,
      master_id: masterId,
      service_ids: serviceIds,
      services: selectedServices,
      total_amount: effectiveTotal,
      custom_total: customTotal,
      // A job without a catalog service still has the duration selected in
      // the time picker. Persist the actual slot instead of a misleading 0.
      total_duration:
        computedDuration > 0
          ? computedDuration
          : minutesBetweenHM(timeStart, timeEnd),
      comment: comment.trim(),
      status,
      location_id: locationId,
      address: address.trim(),
      color_override: colorOverride,
      global_discount: globalDiscount,
      discount_amount: discountAmount,
      prepaid_amount: prepay,
      // Предоплата — уже полученные деньги, поэтому способ должен жить на
      // самой записи независимо от её статуса. Раньше он записывался только
      // при completed: запланированная заявка с авансом теряла «нал/карта»,
      // а полностью предоплаченная затем могла упасть в серверном резолвере
      // с payment_method=null.
      payment_method: prepay > 0 ? (payMethod ?? undefined) : undefined,
      // Предоплата ложится на ту же кассу, что выбрана чипом.
      payment_account_id: prepay > 0 ? payAccountId : null,
      reminder_enabled: reminderOn && Boolean(client?.phone),
    };
    // Оплата остатка на месте («приехал — сделал — закрыл»): тот же
    // buildDebtPaidPatch, что тап «Оплачено» на визите — пять полей из
    // одного места, а не по одному.
    if (status === "completed" && payMethod && debtAfter > 0) {
      Object.assign(
        patch,
        buildDebtPaidPatch(null, {
          method: payMethod,
          amount: debtAfter,
          accountId: payAccountId,
        }),
      );
    } else if (prepay > 0 && debtAfter === 0) {
      // A fully prepaid visit is paid as soon as the money is received,
      // including when the work itself is still scheduled. There is no
      // balance payment to append to the ledger; this status keeps invoices,
      // debt surfaces and the server receipt journal on the same truth.
      patch.payment_status = "paid";
      patch.payment_method = payMethod ?? undefined;
      patch.paid_amount = 0;
    }
    return patch;
  };

  const hasValidTeam =
    teamId != null && teams.some((candidate) => candidate.id === teamId);
  const reconciledSelection = reconcileBookingSelection({
    teamId,
    serviceIds,
    masterId,
    services,
    masters,
  });
  // Сверка держит СОЗДАНИЕ: пока черновик собирается, услуга чужой команды в
  // него попасть не должна. Сохранённую запись она не судит — там строки
  // держит замок снимка, и услуга, убранная из каталога полгода назад, не
  // повод запретить правку комментария.
  const workSelectionValid =
    isEdit ||
    (reconciledSelection.masterId === masterId &&
      reconciledSelection.serviceIds.join("\u0000") ===
        serviceIds.join("\u0000"));
  const referenceQueries =
    kind === "event"
      ? ([
          // Винительный падеж: «Не удалось загрузить команды/календарь…».
          { label: "команды", query: teamsQuery },
          { label: "календарь", query: appointmentsQuery },
          { label: "настройки календаря", query: calendarSettingsQuery },
          { label: "типы событий", query: eventTypesQuery },
        ] as const)
      : ([
          { label: "команды", query: teamsQuery },
          { label: "сотрудников", query: mastersQuery },
          { label: "услуги", query: servicesQuery },
          { label: "клиентов", query: clientsQuery },
          { label: "календарь", query: appointmentsQuery },
          { label: "программу лояльности", query: loyaltyQuery },
          { label: "настройки календаря", query: calendarSettingsQuery },
          ...(teamId
            ? [{ label: "график команды", query: teamScheduleQuery }]
            : []),
        ] as const);
  // Только БАЗОВЫЕ справочники гейтят экран: без них нельзя собрать валидную
  // запись (команды; для работы ещё клиенты). Всё остальное (услуги/лояльность/
  // график/настройки/типы/календарь) — необязательное: его сбой не блокирует
  // создание простой записи, а лишь даёт деградацию (пустой список/без
  // лояльности/без предупреждения о наложении).
  const essentialQueries =
    kind === "event"
      ? ([
          { label: "команды", query: teamsQuery },
          // Правка ждёт сам список записей: без него страница показала бы
          // пустой черновик вместо той записи, которую открыли.
          ...(isEdit
            ? ([{ label: "запись", query: appointmentsQuery }] as const)
            : ([] as const)),
        ] as const)
      : ([
          { label: "команды", query: teamsQuery },
          { label: "клиентов", query: clientsQuery },
          ...(isEdit
            ? ([{ label: "запись", query: appointmentsQuery }] as const)
            : ([] as const)),
          // Если услуги пришли параметром (deep-link), а каталог не грузится —
          // гейтим экраном-ретраем, иначе фантомный service_id навсегда держит
          // canSave=false без способа его убрать (soft-lock).
          ...(first(params.services)
            ? ([{ label: "услуги", query: servicesQuery }] as const)
            : ([] as const)),
        ] as const);
  const failedReference = essentialQueries.find(({ query }) => query.isError);
  const referencesPending = essentialQueries.some(
    ({ query }) => query.isPending,
  );

  useEffect(() => {
    if (chainRef.current !== "idle") return;
    if (isEdit || kind !== "work") return;
    // Ждём, пока справочники доедут: лист поверх скелета показал бы пустоту.
    if (referencesPending) return;
    // ЖДЁМ, ПОКА УЕДЕТ ПОПАП СЛОТА, А НЕ ОТКРЫВАЕМ СРАЗУ.
    //
    // Цепочку начинает попап слота на КАЛЕНДАРЕ — он тоже `Modal`. Пока он
    // закрывается, форма уже смонтирована и просит показать свой лист; окно,
    // поданное поверх ещё закрывающегося, на iOS не появляется вовсе и об
    // этом не сообщает. Это записанный закон продукта (SHEET_EXIT_MS,
    // MODAL_EXIT_MS) — и я всё равно на него наступил: эффект отрабатывал,
    // `visible` становился true, а на экране не было ничего.
    //
    // `InteractionManager` здесь НЕ ПОМОГАЕТ, и это стоит помнить: он ждёт
    // взаимодействий и анимаций React Native, а уход модалки — анимация
    // UIKit, о которой он не знает. Проверено следом в журнале: цепочка
    // доходила до конца, лист не показывался.
    const timer = setTimeout(() => {
      if (clientId) {
        // Клиент уже известен — пришли с карточки клиента или вернулись,
        // заведя нового. Первое звено пройдено, показываем второе.
        chainRef.current = "done";
        if (serviceIds.length === 0) setServicePickerOpen(true);
        return;
      }
      chainRef.current = "client";
      setClientPickerOpen(true);
    }, CHAIN_START_MS);
    return () => clearTimeout(timer);
  }, [isEdit, kind, referencesPending, clientId, serviceIds.length]);

  const failedOptional = referenceQueries.find(
    ({ query }) =>
      query.isError && !essentialQueries.some((e) => e.query === query),
  );
  const canSave =
    timeEnd > timeStart &&
    !failedReference &&
    !referencesPending &&
    (kind === "event"
      ? eventTitle.trim().length > 0 && (teamId == null || hasValidTeam)
      : !prepayExceedsTotal &&
        (prepay <= 0 || payMethod != null) &&
        clientId != null &&
        hasValidTeam &&
        workSelectionValid);
  const bookingBusy = booking.isPending || updateMut.isPending;
  const missingHint = bookingBusy
    ? "Сохраняем…"
    : failedReference
      ? `Не удалось загрузить ${failedReference.label}`
    : referencesPending
      ? "Загружаем данные…"
    : timeEnd <= timeStart
      ? "Время окончания должно быть позже начала"
    : kind === "event"
      ? eventTitle.trim().length === 0
        ? "Введите название события"
        : "Выберите доступный календарь"
      : // Порядок = естественный порядок заполнения: сначала называем самое
        // раннее незаполненное (клиент → команда → услуги), и только потом
        // ошибки оплаты — иначе предоплата-ошибка маскирует «Выберите клиента».
        clientId == null
        ? "Выберите клиента"
      : !hasValidTeam
        ? "Выберите команду"
      : !workSelectionValid
        ? "Проверьте услуги и мастера для этой команды"
      : prepayExceedsTotal
        ? "Предоплата больше итоговой суммы"
      : prepay > 0 && payMethod == null
        ? "Выберите способ предоплаты"
        : "Проверьте услуги и мастера для этой команды";

  // accessibilityLiveRegion — Android-only. На iOS-приложении причина под CTA,
  // предупреждение докета и ошибки оплаты озвучиваем сами, иначе весь
  // динамический фид-бек нем для VoiceOver. Объявляем при СМЕНЕ текста.
  // ОДНО ПРЕДУПРЕЖДЕНИЕ НА ОДНУ ДОРОГУ (владелец 2026-08-24: «тут плашки не
  // должно быть, не надо триггерить несколько раз»). Про нерабочее время уже
  // сказала плашка над календарём — там же человек и ответил на неё кнопкой
  // «Записать». Повторять это в форме значит спорить с его собственным
  // решением, принятым десять секунд назад.
  //
  // Но молчать совсем нельзя: время правят и ЗДЕСЬ. Поэтому график команды
  // подаёт голос ровно тогда, когда дату или время сдвинули внутри формы, —
  // это уже НОВЫЙ выбор, о котором никто не предупреждал. Пересечение с
  // другой записью не гасится никогда: о нём в календаре не говорили вовсе.
  const openedAtRef = useRef<{ date: string; time: string } | null>(null);
  if (openedAtRef.current === null && date && timeStart) {
    openedAtRef.current = { date, time: timeStart };
  }
  const timeMovedHere =
    openedAtRef.current != null &&
    (openedAtRef.current.date !== date || openedAtRef.current.time !== timeStart);
  const workWarning =
    kind === "work"
      ? overlap != null
        ? "Пересекается с записью этой команды"
        : timeMovedHere
          ? timeWarning
          : null
      : null;
  useEffect(() => {
    if (!canSave && !bookingBusy && !referencesPending) {
      AccessibilityInfo.announceForAccessibility(missingHint);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingHint]);
  useEffect(() => {
    if (workWarning) AccessibilityInfo.announceForAccessibility(workWarning);
  }, [workWarning]);

  // A notification/deep link can open /book without a navigation history.
  // In that case router.back() is a dead action; return to the calendar tab.
  const leaveBook = () => {
    bypassGuardRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const save = async () => {
    if (!canSave || bookingBusy) {
      toast(missingHint, "info");
      return;
    }
    try {
      if (isEdit && editId) {
        // Правка идёт мимо useBookingSave: тот хук — про РОЖДЕНИЕ заявки и
        // её хвост (гашение напоминания ТО, постановка push события). У
        // существующей записи этот хвост уже отработал в день создания.
        await updateMut.mutateAsync({ id: editId, patch: buildPatch() });
        toast("Изменения сохранены", "success");
        haptics.success();
      } else {
        await booking.save({
          patch: buildPatch(),
          kind,
          reminderId,
          eventReminderOffset,
          timezone:
            team?.timezone ?? calendarSettings?.timezone ?? "Europe/Nicosia",
        });
      }
      leaveBook();
    } catch (e) {
      haptics.error();
      notify("Ошибка", (e as Error).message);
    }
  };

  // ── «есть несохранённое» ──
  //
  // У СОЗДАНИЯ это «человек что-то ввёл»: сравнивать не с чем, пустой
  // черновик закрывается молча. У ПРАВКИ вопрос другой — «отличается ли
  // форма от того, что лежит в базе», поэтому сравниваем собранный патч со
  // снимком, снятым сразу после гидрации. Снимок берётся эффектом, а не в
  // самой гидрации: сеты состояния к тому моменту ещё не легли.
  const editSignature = isEdit ? JSON.stringify(buildPatch()) : "";
  const editBaselineRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isEdit || !editHydrated.current || editBaselineRef.current != null) {
      return;
    }
    editBaselineRef.current = editSignature;
  }, [isEdit, editSignature]);

  const dirty = isEdit
    ? editBaselineRef.current != null && editSignature !== editBaselineRef.current
    // Сравнение вида с исходным ушло вместе с переключателем: менять вид
    // внутри формы больше нечем, и при создании `kind !== initialKind`
    // ложно всегда.
    : (kind === "event"
      ? eventTitle.trim().length > 0 ||
        eventNotes.trim().length > 0 ||
        eventAddress.trim().length > 0 ||
        eventUrl.trim().length > 0 ||
        eventReminderOffset != null ||
        eventColor != null ||
        repeat.kind !== "none" ||
        allDay ||
        dateTouchedRef.current ||
        durationTouched
      : clientId != null ||
        serviceIds.length > 0 ||
        comment.trim().length > 0 ||
        address.trim().length > 0 ||
        customTotal ||
        discountType != null ||
        status !== "scheduled" ||
        reminderOn ||
        prepay > 0 ||
        colorOverride != null ||
        dateTouchedRef.current ||
        durationTouched);
  const confirmDiscard = (onDiscard: () => void) => {
    confirmThen(
      "Закрыть без сохранения?",
      {
        message: "Введённое не сохранится.",
        confirmLabel: "Закрыть",
        destructive: true,
      },
      onDiscard,
    );
  };
  const requestClose = () => {
    if (!dirty) {
      leaveBook();
      return;
    }
    confirmDiscard(leaveBook);
  };

  // Back-свайп и аппаратная «назад» теряли заполненную запись без спроса —
  // теперь перехватываем POP тем же подтверждением, что и кнопка «Отмена».
  usePreventRemove(dirty, ({ data }) => {
    if (bypassGuardRef.current) {
      bypassGuardRef.current = false;
      navigation.dispatch(data.action);
      return;
    }
    confirmDiscard(() => navigation.dispatch(data.action));
  });

  const title = isEdit
    ? kind === "event"
      ? "Событие"
      : "Запись"
    : kind === "event"
      ? "Событие"
      : "Новая запись";

  // ── identity-цвет записи → живая подсветка всего экрана ──
  // Выбранный цвет — это цвет ЭТОЙ записи (тот же, что станет блоком в
  // календаре). Он владеет только ХРОМОМ (подложка, шапка-halo, градиент CTA,
  // корешок докета); семантические токены (зелёный/красный/янтарь) и белые
  // карточки не трогает. Без выбора — hasColor=false и экран идентичен прежнему.
  const picked = kind === "event" ? eventColor : colorOverride;
  const hasColor = picked != null;
  const accentC = picked ?? t.accent;
  // Докет всегда несёт реальный смысл: выбранный цвет → цвет команды → кобальт.
  const identityC = picked ?? team?.color ?? t.accent;
  const groundBg = hasColor ? tintOver(accentC, t.canvas, 0.06) : t.canvas;
  const headerBg = hasColor ? tintOver(accentC, t.canvas, 0.1) : t.canvas;
  const headerBorder = hasColor
    ? tintOver(accentC, t.canvas, 0.28)
    : t.separator;

  // «Маршрут» — реальное действие (его не было): открыть адрес в картах.
  // Выбор карты — общий openRouteMenu (тот же шит у строки объекта и на
  // странице объекта). Присланный клиентом пин (mapUrl) важнее текстового
  // адреса: на кипрских виллах текстовый адрес часто не прокладывается.
  // Маршрут — тот же лист со значками, что у строки объекта.
  const enabledMaps = useEnabledMapServices();
  const [routeOpen, setRouteOpen] = useState(false);
  const routeAim = routeTarget(
    clientLocations.find((l) => l.id === locationId)?.mapUrl,
    address,
  );
  const openRoute = () => {
    if (!routeAim) return;
    const direct = directRouteUrl(routeAim, enabledMaps);
    if (direct) {
      openDirect(direct);
      return;
    }
    haptics.tap();
    setRouteOpen(true);
  };

  // Запись открыли по ссылке, справочники доехали, а её самой нет: удалили с
  // другого устройства или ссылка протухла. Пустой черновик на этом месте
  // читался бы как «запись очистилась», и «Сохранить» создал бы дубль.
  if (isEdit && !referencesPending && !failedReference && !editing) {
    return (
      <Screen edges={["top", "bottom"]}>
        <View className="flex-row items-center px-3" style={{ height: 48 }}>
          <Pressable
            onPress={leaveBook}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Вернуться к календарю"
            style={{ minWidth: 72, minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ fontSize: 16, color: t.body }}>Назад</Text>
          </Pressable>
          <Text
            className="flex-1 text-center"
            style={{ fontSize: 16, fontWeight: "600", color: t.ink }}
          >
            Запись
          </Text>
          <View style={{ minWidth: 72 }} />
        </View>
        <View className="flex-1 items-center justify-center px-7">
          <Text
            style={{ fontSize: 20, fontWeight: "700", color: t.ink, textAlign: "center" }}
          >
            Записи больше нет
          </Text>
          <Text
            style={{ fontSize: 14, lineHeight: 20, color: t.sub, textAlign: "center", marginTop: 8 }}
          >
            Её удалили или ссылка устарела.
          </Text>
        </View>
      </Screen>
    );
  }

  if (failedReference || referencesPending) {
    const errorMessage =
      failedReference?.query.error instanceof Error
        ? failedReference.query.error.message
        : "Проверьте подключение и повторите загрузку.";
    return (
      <Screen edges={["top", "bottom"]}>
        <View className="flex-row items-center px-3" style={{ height: 48 }}>
          <Pressable
            onPress={requestClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Закрыть оформление заявки"
            style={{ minWidth: 72, minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ fontSize: 16, color: t.body }}>Отмена</Text>
          </Pressable>
          <Text
            className="flex-1 text-center"
            style={{ fontSize: 16, fontWeight: "600", color: t.ink }}
          >
            {title}
          </Text>
          <View style={{ minWidth: 72 }} />
        </View>
        <View className="flex-1 items-center justify-center px-7">
          {/* Ожидание ДВИЖЕТСЯ: крупная надпись без движения читалась как
              зависший экран (владелец 2026-07-27). */}
          {referencesPending ? (
            <View style={{ marginBottom: 14 }}>
              <Spinner size={30} label="Загружаем данные записи" />
            </View>
          ) : null}
          <Text
            style={{ fontSize: 20, fontWeight: "700", color: t.ink, textAlign: "center" }}
          >
            {referencesPending
              ? "Загружаем данные записи"
              : `Не удалось загрузить ${failedReference?.label ?? "данные"}`}
          </Text>
          {!referencesPending ? (
            <Text
              style={{ fontSize: 14, lineHeight: 20, color: t.sub, textAlign: "center", marginTop: 8 }}
            >
              {errorMessage}
            </Text>
          ) : null}
          {failedReference ? (
            <Pressable
              onPress={() => {
                void Promise.all(referenceQueries.map(({ query }) => query.refetch()));
              }}
              accessibilityRole="button"
              accessibilityLabel="Повторить загрузку данных заявки"
              style={{
                minHeight: 48,
                justifyContent: "center",
                paddingHorizontal: 22,
                borderRadius: t.radius.card,
                backgroundColor: t.accent,
                marginTop: 18,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "700", color: "#FFFFFF" }}>
                Повторить
              </Text>
            </Pressable>
          ) : null}
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={["top"]} bg={groundBg}>
      {/* шапка: Отмена · заголовок · Цвет записи — на identity-подложке;
          выбор цвета живо подсвечивает шапку (halo), фон и CTA. */}
      <View
        style={{
          backgroundColor: headerBg,
          borderBottomWidth: 1,
          borderBottomColor: headerBorder,
        }}
      >
        {hasColor ? <Halo color={accentC} intensity={0.16} /> : null}
        <View className="flex-row items-center px-3" style={{ height: 48 }}>
          <Pressable
            onPress={requestClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={
              isEdit ? "Закрыть запись" : "Отменить создание записи"
            }
            style={{ minWidth: 72, minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ fontSize: 16, color: t.body }}>Отмена</Text>
          </Pressable>
          <Text
            className="flex-1 text-center"
            style={{ fontSize: 16, fontWeight: "600", color: t.ink }}
          >
            {title}
          </Text>
          <View style={{ minWidth: 72, alignItems: "flex-end" }}>
            {/* Подписанный контрол цвета (не Done-слот): swatch + «Цвет» —
                самоочевидная кнопка, единственный коммит — градиент снизу. */}
            <Pressable
              onPress={() => {
                setColorSheetOpen(true);
                haptics.tap();
              }}
              hitSlop={8}
              className="items-center justify-center rounded-[10px] px-1.5"
              style={{ minHeight: 44 }}
              accessibilityRole="button"
              accessibilityLabel={`${
                kind === "event" ? "Цвет события" : "Цвет записи"
              }: ${hasColor ? "выбран" : "по умолчанию"}`}
              accessibilityHint="Открывает выбор цвета — им подсвечивается вся запись"
            >
              {hasColor ? (
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: t.radius.card,
                    backgroundColor: accentC,
                    borderWidth: 2,
                    borderColor: t.surface,
                    boxShadow: `0px 1px 4px ${accentC}66`,
                  }}
                />
              ) : (
                <Palette color={t.sub} size={ICON.sm} />
              )}
              <Text style={{ fontSize: 11, fontWeight: "600", color: t.faint, marginTop: 1 }}>
                Цвет
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* ПЕРЕКЛЮЧАТЕЛЯ «КЛИЕНТ / СОБЫТИЕ» ЗДЕСЬ БОЛЬШЕ НЕТ (владелец
              2026-08-30: «всё будет зависеть от того, что я выберу в начале,
              когда тапаю на календарь — вылазит иконка, там оно уже всё»).

              Развилка и правда стоит РАНЬШЕ формы: попап слота отдаёт вид
              вместе со временем (`BookSlotSheet.onPick(kind, slot)`), и он же
              приезжает сюда параметром маршрута. Держать второй такой же
              вопрос внутри формы значило спрашивать дважды.

              СОСТОЯНИЕ `kind` ОСТАЁТСЯ, и сносить его нельзя: правку события
              открывает не параметр, а сама запись — вид выставляет гидрация
              (`setKind(editing.kind …)`). Выведи `kind` прямо из `params.kind`
              — и правка события нарисуется формой клиента, а сохранение
              затрёт событие.

              ЦЕНА, УПЛАЧЕННАЯ ОСОЗНАННО: из трёх холостых дверей — «записей
              нет», онбординг, пустой календарь — теперь заводится только
              клиентская запись: они зовут `bookAt()` без вида. Это их
              естественное значение («создать первую запись»), а дорога к
              событию остаётся там, где владелец её и назначил, — в попапе
              слота. */}

          {/* Необязательный справочник не загрузился — не блокируем, но честно
              предупреждаем, что часть подсказок недоступна. */}
          {failedOptional ? (
            <View
              className="mx-3 mt-2 flex-row items-center gap-2 rounded-[10px] px-3 py-2.5"
              style={{ backgroundColor: `${t.warning}14`, borderWidth: 1, borderColor: `${t.warning}33` }}
            >
              <AlertTriangle color={t.warning} size={ICON.sm} />
              <Text style={{ fontSize: 13, color: t.warning, flex: 1 }}>
                Не удалось загрузить {failedOptional.label} — часть подсказок недоступна
              </Text>
            </View>
          ) : null}

          {kind === "work" ? (
            <>
              {/* Докет «Команда · Когда» — одна спокойная строка вместо пилюли
                  команды и карточки времени с мини-таймлайном */}
              <DocketRow
                teamName={team?.name ?? "Команда"}
                teamColor={team?.color ?? t.accent}
                masterName={
                  masterId
                    ? masters.find((m) => m.id === masterId)?.full_name ?? null
                    : null
                }
                date={date}
                timeStart={timeStart}
                duration={computedDuration > 0 ? computedDuration : slotFallback}
                warning={workWarning}
                accent={identityC}
                onEditTeam={() => {
                  setTeamSheetOpen(true);
                  haptics.tap();
                }}
                onEditTime={() => {
                  setWhenOpen(true);
                  haptics.tap();
                }}
              />

              {/* КЛИЕНТ — ПЕРВЫЙ БЛОК И САМ ПО СЕБЕ (владелец 2026-08-31:
                  «первый блок это выбор клиента… потом второе это объект»).

                  Был один герой «Кому и куда едем»: клиент, адрес, объект и
                  маршрут одним списком — «кому и куда» считалось одним
                  смыслом. Владелец назвал порядок иначе: клиент → объект →
                  услуга → цена, четыре шага, и каждый свой. */}
              <SectionCard title="Клиент">
                {client ? (
                  <View className="flex-row items-center">
                    <Pressable
                      className="flex-1 flex-row items-center px-4 py-3"
                      onPress={() => setClientPickerOpen(true)}
                      accessibilityRole="button"
                      accessibilityLabel={`Клиент: ${client.full_name || "без имени"}. ${
                        clientHistory ?? client.phone ?? "ещё не обслуживали"
                      }`}
                      accessibilityHint="Открывает выбор клиента"
                    >
                      <View className="flex-1">
                        <Text style={{ fontSize: 17, fontWeight: "700", color: t.ink }}>
                          {client.full_name || "Без имени"}
                        </Text>
                        <Text
                          style={{
                            fontSize: 13,
                            color: clientHistory || client.phone ? t.sub : t.placeholder,
                            marginTop: 2,
                          }}
                          numberOfLines={1}
                        >
                          {clientHistory ?? client.phone ?? "ещё не обслуживали"}
                        </Text>
                      </View>
                      {/* шеврон = «тап, чтобы сменить клиента» (было видно только VoiceOver) */}
                      <ChevronRight color={t.chevron} size={ICON.sm} />
                    </Pressable>
                    {client.phone ? (
                      <Pressable
                        onPress={() => {
                          const digits = client.phone.replace(/[^\d+]/g, "");
                          if (digits) void Linking.openURL(`tel:${digits}`);
                        }}
                        className="mr-4 items-center justify-center self-center rounded-full"
                        style={{ width: 44, height: 44, backgroundColor: `${t.accent}14` }}
                        accessibilityRole="button"
                        accessibilityLabel={`Позвонить клиенту ${client.full_name || "без имени"}`}
                      >
                        <Phone color={t.accent} size={ICON.sm} />
                      </Pressable>
                    ) : null}
                  </View>
                ) : (
                  <Pressable
                    className="flex-row items-center px-4 py-3.5"
                    onPress={() => setClientPickerOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Выбрать клиента"
                    accessibilityHint="Открывает поиск по имени или телефону"
                  >
                    <View
                      className="mr-3 items-center justify-center rounded-full"
                      style={{ width: 34, height: 34, backgroundColor: `${t.accent}14` }}
                    >
                      <UserRound color={t.accent} size={ICON.sm} />
                    </View>
                    <Text className="flex-1" style={{ fontSize: 17, fontWeight: "600", color: t.accent }}>
                      Выбрать клиента
                    </Text>
                    <ChevronRight color={t.chevron} size={ICON.sm} />
                  </Pressable>
                )}

              </SectionCard>

              {/* ОБЪЕКТ — ВТОРОЙ БЛОК, И ОН СТОИТ ВСЕГДА (владелец: «хочу,
                  чтоб был зафиксированный блок, и он никуда не девался и не
                  подтягивался»). Раньше объекта не было на экране вовсе,
                  пока не выбран клиент, — и человек не знал, что он бывает.

                  БЕЗ КЛИЕНТА ОБЪЕКТ НЕ ЗАВОДИТСЯ, и блок говорит об этом
                  словом, а не пустотой. Сам владелец пришёл к этому вслух:
                  сперва «можно добавить объект без клиента», потом — «объект
                  есть, а клиента нет, это очень странно, не та архитектура».
                  Верно второе: объект принадлежит клиенту. */}
              <SectionCard title="Объект">
                {client ? (
                  <>
                  <View style={{ borderTopWidth: 1, borderTopColor: t.separator }}>
                    {/* ОБЪЕКТЫ — ТЕМИ ЖЕ КАРТОЧКАМИ АДРЕСА, ЧТО НА КАРТОЧКЕ
                        КЛИЕНТА (владелец 2026-08-31: «блок объекта должен быть
                        такой же, как в клиентах»).

                        Здесь стояли ЧИПЫ: одно слово в пилюле — ни адреса, ни
                        срока ТО, ни заметки. Человек выбирал «Дом» и «Дача»
                        вслепую, а всё, что нужно бригаде («код домофона»,
                        «пора обслужить»), лежало этажом ниже, в карточке
                        клиента, куда из записи не ходят.

                        Строка НЕ СКОПИРОВАНА, а взята та же — `ObjectRow`
                        открыт из блока объектов клиента. Копия разошлась бы с
                        оригиналом на первой правке, как разошлись две формы
                        записи, которые мы сейчас сводим. Разница ровно одна:
                        здесь объект ВЫБИРАЮТ, поэтому у выбранного стоит
                        галка, а тап не открывает правку. */}
                    {clientLocations.map((l, i) => (
                      <ObjectRow
                        key={l.id}
                        loc={l}
                        plan={servicePlan(l, allAppts, date)}
                        separated={i > 0}
                        selected={locationId === l.id}
                        onPress={() => pickLocation(l.id)}
                      />
                    ))}

                    <View className="px-4 py-3">
                      {/* АДРЕС ПОКАЗЫВАЕТСЯ, ТОЛЬКО КОГДА ОБЪЕКТ НЕ ВЫБРАН.
                          Карточка объекта выше уже несёт адрес и свою кнопку
                          маршрута — с этим полем он стоял на экране ДВАЖДЫ, с
                          двумя «Маршрут» подряд. Я это и увидел на симуляторе
                          сразу после того, как поставил карточки: копия
                          адреса выглядела вторым, другим адресом.

                          Поле остаётся живым для выезда БЕЗ объекта — разовый
                          адрес по звонку, который в справочник клиента не
                          заводят. */}
                      {!locationId ? (
                      <View className="flex-row items-center gap-2">
                        <TextInput
                          keyboardAppearance="light"
                          accessibilityLabel="Адрес выезда"
                          value={address}
                          onChangeText={setAddress}
                          placeholder="Адрес выезда"
                          placeholderTextColor={t.placeholder}
                          style={{ flex: 1, minHeight: 44, fontSize: 15, color: t.ink, paddingVertical: 4 }}
                        />
                        <Pressable
                          onPress={openRoute}
                          disabled={!address.trim()}
                          className="flex-row items-center gap-1 rounded-full px-3"
                          style={{
                            minHeight: 44,
                            backgroundColor: address.trim() ? `${t.accent}14` : t.fill,
                            opacity: address.trim() ? 1 : 0.45,
                          }}
                          accessibilityRole="button"
                          accessibilityLabel="Проложить маршрут до адреса"
                        >
                          <Navigation color={t.accent} size={ICON.xs} />
                          <Text style={{ fontSize: 13, fontWeight: "600", color: t.accent }}>
                            Маршрут
                          </Text>
                        </Pressable>
                      </View>
                      ) : null}
                      {/* «ПОДЪЕЗД, КОД, ЭТАЖ» УБРАН СОВСЕМ (владелец
                          2026-08-31: «зачем вот это, не надо, без этого можно
                          всё сделать»).
                          
                          Поле носило ДВЕ разные вещи под одним именем, и обе
                          у нас уже есть свои места:
                            • «код от ворот 1234», «домофон 45» — это свойство
                              ОБЪЕКТА, оно верно всегда. У объекта есть своя
                              заметка, и карточка выше её печатает третьей
                              строкой;
                            • «сегодня ключ у соседей» — про ЭТУ поездку, для
                              этого заметка записи.
                          Третье безымянное поле между ними давало один и тот
                          же факт записать в трёх местах, а бригаде — гадать,
                          какое из трёх читать.

                          Колонка `address_note` в базе цела: форма её больше
                          не шлёт, и обновление частичным патчем прежние
                          значения не трогает. */}
                    </View>

                    {/* ТО оборудования объекта — визит часто из-за него; тап
                        ведёт к выбору услуги (записать обслуживание). */}
                    {serviceDue && serviceDueCount > 0 ? (
                      <Pressable
                        onPress={() => {
                          setServicePickerOpen(true);
                          haptics.tap();
                        }}
                        className="flex-row items-center gap-2 px-4 py-2.5"
                        style={{ borderTopWidth: 1, borderTopColor: t.separator }}
                        accessibilityRole="button"
                        accessibilityLabel={
                          serviceDue.overdue.length > 0
                            ? `Пора обслужить оборудование: ${serviceDue.overdue.length}`
                            : `Скоро ТО оборудования: ${serviceDue.soon.length}`
                        }
                        accessibilityHint="Открывает выбор услуги"
                      >
                        <AlertTriangle color={t.warning} size={ICON.xs} />
                        <Text style={{ fontSize: 13, color: t.warning, flex: 1 }}>
                          {serviceDue.overdue.length > 0
                            ? `Пора обслужить оборудование (${serviceDue.overdue.length})`
                            : `Скоро ТО оборудования (${serviceDue.soon.length})`}
                        </Text>
                        <ChevronRight color={t.chevron} size={ICON.xs} />
                      </Pressable>
                    ) : null}

                    <View style={{ borderTopWidth: 1, borderTopColor: t.separator }}>
                      <AddRow
                        label="Добавить объект"
                        onPress={() => setObjectSheet(true)}
                      />
                    </View>
                  </View>
                  </>
                ) : (
                  <View className="px-4 py-3">
                    <Text
                      maxFontSizeMultiplier={1.3}
                      style={{ fontSize: 15, color: t.placeholder }}
                    >
                      Сначала выберите клиента
                    </Text>
                  </View>
                )}
              </SectionCard>

              {/* УСЛУГИ. Заголовок был «Услуги и сумма» — владелец
                  2026-08-31: «убираем, просто ставим услуги». Сумма и так
                  стоит в блоке строкой «Итого»; называть её ещё и в шапке
                  значило объявлять два предмета там, где предмет один: набор
                  работ, у которого есть цена. */}
              <SectionCard title="Услуги">
                {serviceIds.length === 0 ? (
                  <>
                    {frequentTeamServices.length > 0 ? (
                      <View className="flex-row flex-wrap gap-2 px-4 pb-1 pt-1">
                        {frequentTeamServices.map((s) => (
                          <Chip
                            key={s.id}
                            label={s.name}
                            variant="tint"
                            onPress={() => toggleService(s.id)}
                          />
                        ))}
                      </View>
                    ) : null}
                    <AddRow label="Выбрать услугу" onPress={() => setServicePickerOpen(true)} />
                    <TotalEditor
                      value={totalDraft}
                      custom={customTotal}
                      onChange={(value) => {
                        setTotalDraft(value);
                        setCustomTotal(true);
                      }}
                      onReset={() => setCustomTotal(false)}
                      accessoryId={kbdAccessory}
                    />
                  </>
                ) : (
                  <>
                    {selectedServices.map((line) => {
                      // СТРОКА ЖИВЁТ БЕЗ КАТАЛОГА. Раньше здесь стоял
                      // `catalog.get(id) ?? return null`, и у сохранённой
                      // записи строки просто исчезали с экрана, когда услугу
                      // убирали из прайса: сумма в «Итого» оставалась, а
                      // работы, за которые её взяли, было не видно. Имя,
                      // единицу и длительность держит снимок строки.
                      const svc = catalog.get(line.serviceId);
                      const lineName =
                        line.serviceName ??
                        nameById.get(line.serviceId) ??
                        "Услуга удалена";
                      return (
                        <View
                          key={line.serviceId}
                          style={{ borderTopWidth: 1, borderTopColor: t.separator }}
                        >
                        <View className="flex-row items-center px-4 py-2.5">
                          <View className="flex-1 pr-2">
                            <Text style={{ fontSize: 15, color: t.ink }}>{lineName}</Text>
                            <Text style={{ fontSize: 13, color: t.placeholder, marginTop: 1 }}>
                              {durationLabel(line.duration)}
                            </Text>
                          </View>
                          {/* СТЕППЕР У КАЖДОЙ УСЛУГИ (2026-08-21). Второго,
                              конкурирующего вида строки — с кнопкой «Убрать»
                              вместо количества — больше нет: флаг «продаём
                              целиком» снят, а убрать услугу по-прежнему можно
                              тем же степпером до нуля. */}
                          <Stepper
                            qty={line.quantity}
                            unit={line.unit ?? svc?.unit ?? null}
                            onDec={() => setQty(line.serviceId, line.quantity - 1)}
                            onInc={() => setQty(line.serviceId, line.quantity + 1)}
                          />
                          <Text
                            style={{
                              fontSize: 15,
                              fontWeight: "600",
                              color: t.ink,
                              minWidth: 56,
                              textAlign: "right",
                              fontVariant: ["tabular-nums"],
                            }}
                          >
                            {formatEURExact(line.totalPrice)}
                          </Text>
                        </View>

                        </View>
                      );
                    })}
                    <View style={{ borderTopWidth: 1, borderTopColor: t.separator }}>
                      <AddRow label="Добавить услугу" onPress={() => setServicePickerOpen(true)} />
                    </View>
                    {/* Быстрые частые услуги остаются под списком — вторая
                        услуга добавляется одним тапом, без модалки. */}
                    {frequentTeamServices.some((s) => !serviceIds.includes(s.id)) ? (
                      <View
                        className="flex-row flex-wrap gap-2 px-4 pb-3 pt-1"
                        style={{ borderTopWidth: 1, borderTopColor: t.separator }}
                      >
                        {frequentTeamServices
                          .filter((s) => !serviceIds.includes(s.id))
                          .map((s) => (
                            <Chip
                              key={s.id}
                              label={`+ ${s.name}`}
                              variant="tint"
                              onPress={() => toggleService(s.id)}
                            />
                          ))}
                      </View>
                    ) : null}
                    {discountAmount > 0 ? (
                      <MoneyRow
                        label={`Скидка${discountReason ? ` · ${discountReason}` : ""}`}
                        value={`−${formatEURExact(discountAmount)}`}
                        color={t.success}
                        top
                      />
                    ) : null}
                    <TotalEditor
                      value={totalDraft}
                      custom={customTotal}
                      onChange={(value) => {
                        setTotalDraft(value);
                        setCustomTotal(true);
                      }}
                      onReset={() => setCustomTotal(false)}
                      accessoryId={kbdAccessory}
                    />
                  </>
                )}
              </SectionCard>

              {/* Оплата — сразу после «Итого»: единая денежная цепочка
                  сумма → предоплата → долг. Свёрнута, не гейтит сейв. */}
              <SectionCard>
                {!showPay ? (
                  <>
                    <ValueRow
                      label="Оплата"
                      value={
                        prepay <= 0
                          ? "Без предоплаты"
                          : debtAfter === 0 && effectiveTotal > 0
                            ? `Оплачено · ${formatEURExact(prepay)}`
                            : `${formatEURExact(prepay)} · долг ${formatEURExact(debtAfter)}`
                      }
                      muted={prepay === 0}
                      onPress={() => {
                        setShowPay(true);
                        haptics.tap();
                      }}
                    />
                    {/* приехал-сделал-закрыл: один тап вместо копания по секциям */}
                    {status !== "completed" && effectiveTotal > 0 ? (
                      <Pressable
                        onPress={closeOnSite}
                        className="flex-row items-center gap-2 px-4"
                        style={({ pressed }) => ({
                          minHeight: 48,
                          borderTopWidth: 1,
                          borderTopColor: t.separator,
                          backgroundColor: pressed ? t.pressed : "transparent",
                        })}
                        accessibilityRole="button"
                        accessibilityLabel={`Закрыть на месте, оплачено ${formatEURExact(effectiveTotal)}`}
                      >
                        <View
                          className="items-center justify-center rounded-full"
                          style={{ width: 26, height: 26, backgroundColor: `${t.success}1f` }}
                        >
                          <Check color={t.success} size={ICON.xs} />
                        </View>
                        <Text style={{ fontSize: 15, fontWeight: "600", color: t.success, flex: 1 }}>
                          Закрыть на месте
                        </Text>
                        <Text style={{ fontSize: 14, color: t.sub, fontVariant: ["tabular-nums"] }}>
                          {formatEURExact(effectiveTotal)}
                        </Text>
                      </Pressable>
                    ) : null}
                  </>
                ) : (
                  <View className="px-4 py-3">
                    <Pressable
                      onPress={() => {
                        setShowPay(false);
                        haptics.tap();
                      }}
                      className="flex-row items-center justify-between"
                      style={{ minHeight: 24 }}
                      accessibilityRole="button"
                      accessibilityLabel="Свернуть предоплату"
                    >
                      <Text style={{ fontSize: 12, fontWeight: "700", color: t.faint, letterSpacing: 0.4 }}>
                        {prepay > 0 && debtAfter === 0 && effectiveTotal > 0
                          ? "ОПЛАЧЕНО ПОЛНОСТЬЮ"
                          : "ПРЕДОПЛАТА"}
                      </Text>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: t.accent }}>
                        Свернуть
                      </Text>
                    </Pressable>
                    <View className="mt-2 flex-row items-center gap-3">
                      <TextInput
                        keyboardAppearance="light"
                        accessibilityLabel="Предоплата"
                        value={prepayDraft}
                        onChangeText={setPrepayDraft}
                        placeholder="0"
                        placeholderTextColor={t.placeholder}
                        keyboardType="decimal-pad"
                        inputAccessoryViewID={kbdAccessory}
                        style={{ minHeight: 44, fontSize: 24, fontWeight: "700", color: t.ink, minWidth: 64, fontVariant: ["tabular-nums"] }}
                      />
                      <Text style={{ fontSize: 20, color: t.sub }}>€</Text>
                    </View>
                    {/* КАССА, А НЕ СПОСОБ. Тот же выбор, что в карточке
                        записи: счета этой команды плюс подключённые общие.
                        Счетов нет вовсе — откат на четыре способа, приём
                        денег не блокируем никогда. */}
                    <View className="mt-3 flex-row flex-wrap gap-2">
                      {payAccounts.length > 0
                        ? payAccounts.map((acc) => (
                            <Chip
                              key={acc.id}
                              label={acc.name}
                              variant="tint"
                              radio
                              selected={payAccountId === acc.id}
                              onPress={() => {
                                const off = payAccountId === acc.id;
                                setPayAccountId(off ? null : acc.id);
                                setPayMethod(
                                  off ? null : paymentMethodForAccountKind(acc.kind),
                                );
                                haptics.tap();
                              }}
                            />
                          ))
                        : PAYMENT_METHODS.map(
                            (method) => (
                              <Chip
                                key={method}
                                label={PAYMENT_METHOD_LABEL[method]}
                                variant="tint"
                                radio
                                selected={payMethod === method}
                                onPress={() => {
                                  setPayMethod(payMethod === method ? null : method);
                                  haptics.tap();
                                }}
                              />
                            ),
                          )}
                    </View>
                    {prepay > 0 && effectiveTotal > 0 ? (
                      <Text style={{ fontSize: 13, color: t.sub, marginTop: 10 }}>
                        Останется долг{" "}
                        <Text style={{ color: t.danger, fontWeight: "600", fontVariant: ["tabular-nums"] }}>
                          {formatEURExact(debtAfter)}
                        </Text>
                      </Text>
                    ) : null}
                    {prepay > 0 && !payMethod && !prepayExceedsTotal ? (
                      <Text
                        accessibilityRole="alert"
                        style={{ fontSize: 13, color: t.danger, marginTop: 8 }}
                      >
                        Выберите способ предоплаты
                      </Text>
                    ) : null}
                    {prepayExceedsTotal ? (
                      <Text
                        accessibilityRole="alert"
                        style={{ fontSize: 13, color: t.danger, marginTop: 8 }}
                      >
                        Предоплата не может быть больше итоговой суммы
                      </Text>
                    ) : null}
                  </View>
                )}
              </SectionCard>

              {/* Заметка команде — последняя строка формы: «Дополнительно» под ней
                  снесено 2026-08-30. */}
              <SectionCard>
                <View className="px-4 py-3">
                  <TextInput
                    keyboardAppearance="light"
                    accessibilityLabel="Заметка команде"
                    value={comment}
                    onChangeText={setComment}
                    placeholder="Заметка команде — что сделать, взять с собой…"
                    placeholderTextColor={t.placeholder}
                    multiline
                    style={{ fontSize: 15, color: t.ink, minHeight: 44 }}
                  />
                </View>
              </SectionCard>

              {/* БЛОК «ДОПОЛНИТЕЛЬНО» СНЕСЁН 2026-08-30 (владелец: «убрать
                  совсем»). За одной дверью лежали скидка, статус, источник
                  заявки и SMS клиенту — пять разных вещей, сложенных вместе
                  не по смыслу, а по признаку «редкое».

                  Повтор и напоминание переживают снос: у них есть свои двери —
                  Кабинет → «Повторяющиеся ТО» и напоминание на карточке
                  клиента.

                  ПОПРАВКА 2026-08-31: «скидка и источник уходят из продукта»
                  было сказано неверно. Источник и SMS-переключатель живы во
                  ВТОРОЙ форме записи (`AppointmentSheet`), которой правят
                  существующую запись, — снос здесь сделал работу наполовину.
                  Скидка же осталась и на этом экране: её начисляет программа
                  лояльности, и она печатается в итогах. Но ТОЛЬКО при
                  создании: при правке лояльность молчит (`if (isEdit) return`),
                  а ручного поля больше нет — у сохранённой записи скидку из
                  этой формы теперь не изменить и не снять. */}
            </>
          ) : (
            /* ── Событие ── */
            <>
              <SectionCard title="Название">
                <TextInput
                  keyboardAppearance="light"
                  accessibilityLabel="Название события"
                  value={eventTitle}
                  onChangeText={setEventTitle}
                  placeholder="Обед, встреча, перерыв…"
                  placeholderTextColor={t.placeholder}
                  autoFocus
                  className="min-h-11 px-4 pb-3 pt-1"
                  style={{ fontSize: 17, fontWeight: "600", color: t.ink }}
                />
              </SectionCard>

              {eventTypes.length > 0 ? (
                <SectionCard title="Тип события">
                  <View className="flex-row flex-wrap gap-2 px-4 py-3">
                    {eventTypes.map((eventType) => (
                      <Chip
                        key={eventType.id}
                        label={eventType.label}
                        variant="tint"
                        color={eventType.color}
                        selected={eventTypeId === eventType.id}
                        radio
                        onPress={() => applyEventType(eventType.id)}
                      />
                    ))}
                  </View>
                </SectionCard>
              ) : null}

              <SectionCard title="Когда">
                <Pressable
                  onPress={() => {
                    setWhenOpen(true);
                    haptics.tap();
                  }}
                  className="flex-row items-center px-4 py-3"
                  style={({ pressed }) => ({ backgroundColor: pressed ? t.pressed : "transparent" })}
                  accessibilityRole="button"
                  accessibilityLabel={`Дата и время: ${humanDay(date)}, ${
                    allDay ? "весь день" : `${timeStart}–${timeEnd}`
                  }`}
                  accessibilityHint="Открывает выбор даты и времени"
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 17, fontWeight: "700", color: t.ink }}>
                      {humanDay(date)}
                      {allDay ? "" : ` · ${timeStart}`}
                    </Text>
                    <Text style={{ fontSize: 13, color: t.sub, marginTop: 2 }}>
                      {allDay ? "весь день" : `до ${timeEnd}`}
                    </Text>
                  </View>
                  <ChevronRight color={t.chevron} size={ICON.sm} />
                </Pressable>
                <View style={{ borderTopWidth: 1, borderTopColor: t.separator }}>
                  <SwitchRow
                    label="Весь день"
                    value={allDay}
                    onChange={(on) => {
                      setAllDay(on);
                      if (on) {
                        setTimeStart("00:00");
                        setTimeEnd("23:59");
                      } else {
                        const start = timeStart === "00:00" ? "10:00" : timeStart;
                        setTimeStart(start);
                        setTimeEnd(addMinutesHM(start, 60));
                      }
                      setDurationTouched(true);
                      haptics.tap();
                    }}
                  />
                </View>
              </SectionCard>

              <SectionCard>
                <View className="flex-row flex-wrap gap-2 px-4 py-3">
                  <Chip
                    label="Личное"
                    variant="outline"
                    color={t.accent}
                    selected={teamId == null}
                    radio
                    onPress={() => {
                      selectTeam(null);
                      haptics.tap();
                    }}
                  />
                  {teams.map((tm) => (
                    <Chip
                      key={tm.id}
                      label={tm.name}
                      variant="outline"
                      color={tm.color ?? t.accent}
                      selected={teamId === tm.id}
                      onPress={() => {
                        selectTeam(tm.id);
                        haptics.tap();
                      }}
                    />
                  ))}
                </View>
              </SectionCard>

              <SectionCard title="Подробности">
                <TextInput
                  keyboardAppearance="light"
                  accessibilityLabel="Заметка к событию"
                  value={eventNotes}
                  onChangeText={setEventNotes}
                  placeholder="Заметка"
                  placeholderTextColor={t.placeholder}
                  multiline
                  className="px-4 py-3"
                  style={{ minHeight: 56, fontSize: 15, color: t.ink }}
                />
                <View style={{ height: 1, marginLeft: 16, backgroundColor: t.separator }} />
                <TextInput
                  keyboardAppearance="light"
                  accessibilityLabel="Место или адрес события"
                  value={eventAddress}
                  onChangeText={setEventAddress}
                  placeholder="Место или адрес"
                  placeholderTextColor={t.placeholder}
                  className="px-4 py-3"
                  style={{ minHeight: 48, fontSize: 15, color: t.ink }}
                />
                <View style={{ height: 1, marginLeft: 16, backgroundColor: t.separator }} />
                <TextInput
                  keyboardAppearance="light"
                  accessibilityLabel="Ссылка события"
                  value={eventUrl}
                  onChangeText={setEventUrl}
                  placeholder="Ссылка"
                  placeholderTextColor={t.placeholder}
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="px-4 py-3"
                  style={{ minHeight: 48, fontSize: 15, color: t.ink }}
                />
              </SectionCard>

              <SectionCard title="Напоминание">
                <View className="flex-row flex-wrap gap-2 px-4 py-3">
                  {EVENT_REMINDER_OPTIONS.map((option) => (
                    <Chip
                      key={option.label}
                      label={option.label}
                      variant="tint"
                      selected={eventReminderOffset === option.value}
                      radio
                      onPress={() => {
                        setEventReminderOffset(option.value);
                        haptics.tap();
                      }}
                    />
                  ))}
                </View>
                {repeat.kind !== "none" && eventReminderOffset != null ? (
                  <Text style={{ paddingHorizontal: 16, paddingBottom: 12, fontSize: 13, color: t.sub }}>
                    Напоминание будет повторяться вместе с событием
                  </Text>
                ) : null}
              </SectionCard>

              {/* Цвет события задаётся тем же swatch в шапке, что и у записи —
                  один контрол на оба режима, живая подсветка экрана. */}
              <SectionCard title="Повтор">
                <View className="flex-row flex-wrap gap-2 px-4 py-3">
                  {REPEAT_OPTIONS.map((option) => (
                    <Chip
                      key={option.value}
                      label={option.label}
                      variant="tint"
                      selected={repeat.kind === option.value}
                      radio
                      onPress={() => {
                        setRepeatKind(option.value);
                        haptics.tap();
                      }}
                    />
                  ))}
                </View>
                {repeat.kind !== "none" ? (
                  <View
                    className="flex-row items-center justify-between px-4 py-2"
                    style={{ borderTopWidth: 1, borderTopColor: t.separator }}
                  >
                    <View className="flex-1 pr-3">
                      <Text style={{ fontSize: 15, color: t.ink }}>Завершить повтор</Text>
                      <Text style={{ fontSize: 13, color: t.sub, marginTop: 2 }}>
                        {repeatUntil ? humanDay(repeatUntil) : "Без даты окончания"}
                      </Text>
                    </View>
                    {repeatUntil ? (
                      <Pressable
                        onPress={() => setRepeat({ ...repeat, until: undefined })}
                        accessibilityRole="button"
                        accessibilityLabel="Убрать дату окончания повтора"
                        style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}
                      >
                        <Text style={{ fontSize: 14, fontWeight: "600", color: t.accent }}>
                          Без даты
                        </Text>
                      </Pressable>
                    ) : null}
                    <DateTimeInput
                      themeVariant="light"
                      value={parseYMD(repeatUntil ?? date)}
                      minimumDate={parseYMD(date)}
                      mode="date"
                      display="compact"
                      onChange={(_, picked) => {
                        if (picked) {
                          setRepeat({ ...repeat, until: formatYMD(picked) });
                        }
                      }}
                    />
                  </View>
                ) : null}
              </SectionCard>
            </>
          )}
        </ScrollView>

        {/* липкий футер — внутри KAV, чтобы клавиатура (цифровые поля денег)
            поднимала кнопку, а не закрывала её */}
        <View
          style={{
            paddingHorizontal: 14,
            paddingTop: 8,
            paddingBottom: insets.bottom + 8,
            backgroundColor: groundBg,
            borderTopWidth: 1,
            borderTopColor: headerBorder,
          }}
        >
        {/* Причина, почему кнопка ещё не активна — всегда видна над CTA
            (раньше disabled-кнопка молчала, и весь missingHint был мёртв). */}
        {!canSave && !bookingBusy ? (
          <Text
            accessibilityLiveRegion="polite"
            style={{
              fontSize: 13,
              color: t.sub,
              textAlign: "center",
              marginBottom: 8,
            }}
          >
            {missingHint}
          </Text>
        ) : null}
        {/* Дата · время · сумма уже названы в докете и «Итого» — CTA их не
            дублирует; градиент носит выбранный цвет записи. */}
        <GradientButton
          label={
            isEdit
              ? "Сохранить"
              : kind === "event"
                ? "Создать событие"
                : "Создать запись"
          }
          onPress={save}
          disabled={!canSave || bookingBusy}
          loading={bookingBusy}
          tint={hasColor ? accentC : undefined}
        />
        </View>
      </KeyboardAvoidingView>

      <UnifiedTimePopup
        open={whenOpen}
        date={date}
        timeStart={timeStart}
        timeEnd={timeEnd}
        allDay={allDay}
        allowAllDay={kind === "event"}
        // Шаг минут здесь больше не передают: пятиминутка — закон продукта
        // (`MINUTE_STEP`, DS §5), и попап знает его сам. Почему это НЕ
        // «Длительность записи» тенанта — записано в шапке попапа.
        onCommit={(next) => {
          dateTouchedRef.current = true;
          setDate(next.date);
          setTimeStart(next.timeStart);
          setTimeEnd(next.timeEnd);
          setAllDay(kind === "event" && next.allDay);
          // Пользователь явно задал конец в попапе — не растим его под услуги.
          setDurationTouched(true);
        }}
        onClose={() => setWhenOpen(false)}
      />
      {/* Добавление объекта — ТОТ ЖЕ лист, что на карточке клиента: один
          диалект и одна дорога записи. Открывается с уже набранным здесь
          адресом и сразу выбирает добавленный объект для этой записи. */}
      {client ? (
        <ObjectSheet
          visible={objectSheet}
          client={client}
          update={updateClientPatch}
          writer={locationWriter}
          initialTarget={address}
          onAdded={(added) => {
            setLocationId(added.id);
            setAddress(locationAddressForBooking(added));
            toast("Объект сохранён");
          }}
          onClose={() => setObjectSheet(false)}
        />
      ) : null}
      <ClientPicker
        visible={clientPickerOpen}
        onClose={() => setClientPickerOpen(false)}
        // Уходя за клиентом, оставляем в ящике СЛОТ: карточка клиента живёт
        // внутри вкладки и уводит из формы совсем, вернуться «назад» некуда.
        // После сохранения запись откроется заново уже с этим слотом.
        onCreateClient={() =>
          stashBookingReturn({ date, timeStart, teamId })
        }
        clients={clients}
        recentIds={recentClientIds}
        onPick={(pickedClient) => {
          pickClient(pickedClient);
          setClientPickerOpen(false);
        }}
      />
      <ServicePicker
        visible={servicePickerOpen}
        onClose={() => setServicePickerOpen(false)}
        services={teamServices}
        frequent={frequentTeamServices}
        selectedIds={serviceIds}
        teamId={teamId}
        // Каталог знает день записи: услуга, которую по вторникам не делают,
        // уезжает вниз списка под свою подпись.
        date={date}
        onToggle={toggleService}
        quantities={Object.fromEntries(
          serviceIds.map((id) => [id, overrides[id]?.qty ?? 1]),
        )}
        onQtyChange={setQty}
      />
      <TeamMasterSheet
        visible={teamSheetOpen}
        onClose={() => setTeamSheetOpen(false)}
        teams={teams}
        masters={masters}
        teamId={teamId}
        masterId={masterId}
        onPickTeam={(id) => {
          selectTeam(id);
          haptics.tap();
        }}
        onPickMaster={(id) => {
          setMasterId(id);
          haptics.tap();
        }}
      />
      <ColorSheet
        visible={colorSheetOpen}
        onClose={() => setColorSheetOpen(false)}
        isEvent={kind === "event"}
        value={kind === "event" ? eventColor : colorOverride}
        onPick={(c) => {
          if (kind === "event") setEventColor(c);
          else setColorOverride(c);
          haptics.tap();
        }}
      />
      {Platform.OS === "ios" ? (
        <InputAccessoryView nativeID={KBD_ACCESSORY_ID}>
          <View
            className="flex-row justify-end px-3 py-2"
            style={{ backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.separator }}
          >
            <Pressable
              onPress={() => Keyboard.dismiss()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Скрыть клавиатуру"
              style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 10 }}
            >
              <Text style={{ fontSize: 16, fontWeight: "600", color: t.accent }}>Готово</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}

      <RouteSheet
        visible={routeOpen}
        target={routeAim}
        onClose={() => setRouteOpen(false)}
      />
    </Screen>
  );
}
