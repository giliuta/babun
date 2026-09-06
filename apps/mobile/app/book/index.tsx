import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
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
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AlertTriangle,
  ChevronRight,
  MapPin,
  MoreHorizontal,
  UserRound,
  Briefcase,
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
  type ClientNote,
  type Location,
} from "@babun/shared/local/clients";
import { Spinner } from "@/components/ui/Spinner";
import { ObjectSheet } from "@/features/clients/ObjectSheet";
import { ObjectEditSheet } from "@/features/clients/ObjectEditSheet";
import { ObjectPickerSheet } from "@/features/clients/ObjectPickerSheet";
import { LabelSheet } from "@/features/appointments/LabelSheet";
import { useJsonArrayWriter } from "@/features/clients/use-json-writer";
import { useInlineNote } from "@/features/appointments/use-inline-note";
import { applyNoteEdit } from "@/features/appointments/client-note-journal";
import { InlineNoteField } from "@/features/appointments/InlineNoteField";
import { randomUuid } from "@babun/shared/sync/uuid";
import { useLocationWriter } from "@/features/clients/use-location-writer";
import { globalDiscountAmount } from "@babun/shared/local/finance/appointment-calc";
import {
  findBufferClash,
  findOverlap,
} from "@babun/shared/common/utils/appointment-overlap";
import { getDayScheduleForDate } from "@babun/shared/local/schedule";
import { tierForVisits } from "@babun/shared/local/loyalty";
import { formatEURExact } from "@babun/shared/common/utils/money";
import { colorName } from "@babun/shared/common/utils/colors";
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
import PhoneChannelButton from "@/features/clients/PhoneChannelButton";
import { Chip } from "@/components/ui/Chip";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { AddRow } from "@/components/ui/AddRow";
import { ColorDot } from "@/components/ui/picker-fields";
import { useToast } from "@/components/ui/Toast";
import { resolveCalendarDayLabel } from "@/features/calendar/day-label";
import { useDayCities } from "@/features/calendar/day-cities";
import {
  useAutoColorRule,
  useBookingBlocks,
  useFallbackColor,
  useSituationPalette,
} from "@/features/appointments/booking-prefs";
import {
  COLOR_SITUATIONS,
  recordFilled,
  resolveRecordColor,
  serviceBaseColor,
  type ColorSituation,
} from "@/features/appointments/record-color";
import { haptics } from "@/lib/haptics";
import { useKeyboardShown } from "@/lib/keyboard";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";

import {
  useClients,
  useUpdateClientById,
} from "@/features/clients/queries";
import {
  useAllServices,
  useServices,
  type Service,
} from "@/features/services/queries";
import { useCities, useMasters, useTeams } from "@/features/reference/queries";
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
import { PaymentBlock, type PendingPayment } from "@/features/appointments/PaymentBlock";
import { AppointmentFilesBlock } from "@/features/appointments/AppointmentFilesBlock";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { AppointmentLifecycleCard } from "@/features/appointments/AppointmentLifecycleCard";
import { useRecordPayment } from "@/features/appointments/payment-mutations";
import { WhenSheet } from "@/features/appointments/WhenSheet";
import {
  resolveBookingClientPrefill,
  resolveBookingTeamId,
} from "@/features/appointments/booking-prefill";
import { ObjectRow } from "@/features/clients/blocks/ObjectsBlock";
import {
  ClientHistoryLine,
  clientHistoryText,
} from "@/features/clients/history-line";
import { takeCreatedClient } from "@/features/appointments/pending-client";
import { buildStatsMap } from "@babun/shared/local/selectors/client-stats";
import {
  TeamLabelRow,
  TotalRow,
  WhenRow,
} from "@/features/appointments/BookingSummary";
import { TotalSheet } from "@/features/appointments/TotalSheet";
import { QtyBadge } from "@/features/appointments/QtyBadge";
import {
  ColorSheet,
  TeamMasterSheet,
} from "@/features/appointments/BookingSheets";
import {
  ClientPicker,
  ServicePicker,
} from "@/features/appointments/BookingPickers";
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
const EMPTY_NOTES: ClientNote[] = [];
/** Пауза перед первым листом цепочки: столько уезжает попап слота, из
 *  которого сюда пришли. Меньше — и лист подаётся поверх закрывающегося окна,
 *  то есть не появляется вовсе. */
const CHAIN_START_MS = 420;

const KBD_ACCESSORY_ID = "bookKbdDone";
/** Сколько ждать, пока KAV ужмёт список под выезжающую клавиатуру: раньше
 *  докрутка «до конца» останавливается на старой, ещё полной высоте. */
const KEYBOARD_SETTLE_MS = 300;

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
  // Прокрутка формы — чтобы поле, получившее фокус в самом низу, показать
  // над клавиатурой: KAV сжимает список, но к сфокусированному полю сам не
  // едет, и заметку набирали вслепую.
  const scrollRef = useRef<ScrollView>(null);
  const keyboardShown = useKeyboardShown();
  const toast = useToast();
  const { data: dayCities = {} } = useDayCities();
  // КАКИЕ БЛОКИ НУЖНЫ ЭТОМУ БИЗНЕСУ (Кабинет → «Запись», владелец 2026-09-05:
  // «для бьюти-мастеров объект не нужен — можем вообще его убрать»).
  const blocks = useBookingBlocks();
  const showObject = blocks.includes("object");
  const showLabelBlock = blocks.includes("label");
  const showPayment = blocks.includes("payment");
  const showNote = blocks.includes("note");
  // Чем красить запись, когда цвет не выбирали руками, и какими цветами
  // говорить о незаполненном (Кабинет → «Запись»).
  const autoColorRule = useAutoColorRule();
  const situationPalette = useSituationPalette();
  const fallbackColor = useFallbackColor();
  const activeSituations = useMemo<ColorSituation[]>(
    () =>
      COLOR_SITUATIONS.map((s) => s.id).filter(
        (id) => id !== "noObject" || showObject,
      ),
    [showObject],
  );
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
  // ВВОДНАЯ О КАЖДОМ КЛИЕНТЕ — ОДНОЙ КАРТОЙ НА ВЕСЬ СПИСОК. `buildStats` на
  // строку превратил бы выбор клиента в квадрат по числу записей.
  const statsById = useMemo(
    () => buildStatsMap(clientsQuery.data ?? [], allAppts),
    [clientsQuery.data, allAppts],
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
  // «ЕЩЁ НЕТ ДАННЫХ», А НЕ «ИДЁТ ЗАПРОС». `isLoading` ложно, пока запрос
  // выключен (роль ещё не доехала) — и эффекты дефолтов срабатывали по
  // ПУСТОМУ списку: команда из ссылки «не находилась» и обнулялась, клиент
  // из диплинка сбрасывался, и цепочка открывала выбор клиента поверх
  // записи, у которой клиент был назван. Ловилось только на холодном кэше —
  // после полной перезагрузки бандла (симулятор 2026-09-03). `isPending`
  // истинно, пока данных нет вовсе, — ровно то, чего эффекты ждут.
  const teamsLoading = teamsQuery.isPending;
  const clientsLoading = clientsQuery.isPending;

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
  // Цвет — по тому же ПОЛНОМУ справочнику, а не по живому каталогу: правка
  // старой записи с убранной из прайса услугой красила бы форму одним цветом,
  // а сетку другим, — ровно та тихая ложь, о которой предупреждает соседний
  // комментарий.
  const serviceColorById = useMemo(
    () => new Map(allServices.map((s) => [s.id, s.color])),
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
  // Метки принадлежат команде — те же, что предлагаются её дню.
  const { data: teamCities = [] } = useCities({ teamId });
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
  // Деньги новой записи: счёт выбран, запишется после «Создать запись».
  // У существующей записи блок пишет оплату сам и сразу (STORY-065).
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const recordPayment = useRecordPayment();
  const [reminderOn, setReminderOn] = useState(false);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const [whenOpen, setWhenOpen] = useState(false);
  const [teamSheetOpen, setTeamSheetOpen] = useState(false);
  const [colorSheetOpen, setColorSheetOpen] = useState(false);
  const [colorOverride, setColorOverride] = useState<string | null>(null);
  const [objectSheet, setObjectSheet] = useState(false);
  // Выбор/замена объекта — лист блока «Объект» (владелец 2026-09-03);
  // правка выбранного объекта — кружком «…» в его строке (2026-09-04).
  const [objectPicker, setObjectPicker] = useState(false);
  const [objectEdit, setObjectEdit] = useState(false);
  // МЕТКА ЭТОЙ ЗАПИСИ. Новая запись берёт метку дня СРАЗУ (владелец
  // 2026-09-04: «метка подставляется туда автоматически, то есть выбирается
  // по дню, а потом я уже вручную могу выбрать другую именно на запись»), и
  // с этого момента она принадлежит записи: диспетчер переставит метку дня —
  // уже назначенные работы своей метки не потеряют. `null` остаётся только у
  // записей, созданных до этого правила: они по-прежнему читаются как «как у
  // дня». Флаг `cityTouched` держит руку человека сильнее любого автомата.
  const [city, setCity] = useState<string | null>(null);
  const [cityTouched, setCityTouched] = useState(false);
  const [labelSheetOpen, setLabelSheetOpen] = useState(false);
  const [totalSheetOpen, setTotalSheetOpen] = useState(false);
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

  // Прайс ВЫБРАННОЙ команды: услуга принадлежит ровно одной команде
  // (2026-08-17). Пока команда не выбрана, каталог пуст — см.
  // `isServiceAllowedForTeam`.
  const teamServices = useMemo(
    () => services.filter((s) => teamId != null && s.team_id === teamId),
    [services, teamId],
  );
  // «ЧАСТЫЕ УСЛУГИ» ПИЛЮЛЯМИ СНЕСЕНЫ ЦЕЛИКОМ (владелец 2026-09-04: «что это
  // за… старый мусор, убирай, чтоб я этого больше не видел»). Пилюли стояли и
  // в блоке услуг, и в листе выбора: тот же прайс, набранный второй раз
  // другой вёрсткой, — список услуг открывается одним тапом и говорит цену и
  // длительность, а пилюля не говорит ничего.

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
  // ОБЪЕКТ, ДОБАВЛЕННЫЙ ОТСЮДА, ВИДЕН СРАЗУ. Список клиентов после записи
  // только инвалидируется, и с полсекунды `client.locations` не знает о новом
  // объекте: блок мигал «Выбрать объект», а сохранение в эту щель писало
  // location_id: null. Держим добавленный при себе, пока сервер его не
  // отдаст; ключ по клиенту — чужому клиенту он не достанется.
  const [addedLocation, setAddedLocation] = useState<{
    clientId: string;
    loc: Location;
  } | null>(null);
  const serverLocations = client?.locations ?? EMPTY_LOCATIONS;
  const clientLocations = useMemo(() => {
    if (!client || !addedLocation || addedLocation.clientId !== client.id) {
      return serverLocations;
    }
    return serverLocations.some((l) => l.id === addedLocation.loc.id)
      ? serverLocations
      : [...serverLocations, addedLocation.loc];
  }, [client, serverLocations, addedLocation]);
  const selectedLocation =
    clientLocations.find((l) => l.id === locationId) ?? null;
  // Объект удалили листом правки или убрали «✕» сразу после добавления —
  // выбор снимается, адрес-снимок пустеет: id удалённого в запись не едет.
  const forgetLocation = (id: string) => {
    setAddedLocation((cur) => (cur?.loc.id === id ? null : cur));
    if (locationId === id) {
      setLocationId(null);
      setAddress("");
    }
  };
  // Последняя заметка клиента — в поле под клиентом. Журнал на карточке
  // хранит новые первыми, но сортируем по дате: порядок массива — не закон.
  // Импортированный `comment` (CSV) — та же заметка, показываем, если
  // журнала ещё нет (как на карточке).
  const latestClientNoteEntry = useMemo(() => {
    if (!client) return null;
    const newest = [...(client.notes ?? [])].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    )[0];
    if (newest) return { id: newest.id, text: newest.text };
    const imported = (client.comment ?? "").trim();
    return imported ? { id: null, text: imported } : null;
  }, [client]);
  const latestClientNote = latestClientNoteEntry?.text ?? "";

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
  const team = teams.find((tm) => tm.id === teamId) ?? null;
  const clientLabel = (client?.city ?? "").trim();
  // МЕТКА ДНЯ — РОВНО ТА, ЧТО СТОИТ НА ДНЕ В КАЛЕНДАРЕ. Здесь звался
  // `resolveDayLabel` из shared: он знает только про ЯВНО поставленную метку
  // и ничего не знает про расписание меток по дням недели. Календарь печатал
  // на субботе «Лимассол» по расписанию, а запись на ту же субботу
  // показывала пустую «Метку» — два экрана говорили о разных метках одного
  // дня, ровно то, ради чего правило и переехало в `features/calendar`.
  const todayYmd = useMemo(() => {
    const timeZone = team?.timezone ?? calendarSettings?.timezone;
    return formatYMD(
      timeZone ? getCurrentTimeInZone(timeZone) : getCurrentCyprusTime(),
    );
  }, [team?.timezone, calendarSettings?.timezone]);
  const dayLabelResolved = useMemo(
    () =>
      resolveCalendarDayLabel({
        dayCities,
        cities: teamCities,
        teamId,
        dateYmd: date,
        todayYmd,
        fallbackColor: t.faint,
      }),
    [dayCities, teamCities, teamId, date, todayYmd, t.faint],
  );
  const dayLabel = dayLabelResolved?.name ?? null;
  // Новая запись надевает метку дня сама и меняет её вслед за днём и
  // командой — пока человек не выбрал метку руками.
  useEffect(() => {
    if (isEdit || cityTouched) return;
    setCity(dayLabel);
  }, [isEdit, cityTouched, dayLabel]);
  // ЧТО НА САМОМ ДЕЛЕ У ЭТОЙ РАБОТЫ: своя метка сильнее метки дня. Ею же
  // судится расхождение с меткой клиента — иначе продукт спорил бы сам с
  // собой: поставил записи «Пафос» под клиента, а плашка всё равно ругается
  // на «Лимассол» дня.
  const effectiveLabel = city ?? dayLabel;
  const labelClash = useMemo(
    () =>
      clientLabel !== "" && effectiveLabel !== null && effectiveLabel !== clientLabel
        ? { client: clientLabel, day: effectiveLabel }
        : null,
    [clientLabel, effectiveLabel],
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

  // ВВОДНАЯ О КЛИЕНТЕ — ТЕМ ЖЕ ТЕКСТОМ, ЧТО В СПИСКЕ ВЫБОРА. Раньше строка
  // собиралась здесь своими руками и молчала о ДОЛГЕ — самом важном, что
  // стоит знать, набирая клиента на работу. Теперь состав один на оба места
  // (`clientHistoryParts`), и долг идёт первым.
  const clientStats = client ? statsById.get(client.id) : undefined;
  const clientHistory = client ? clientHistoryText(client, clientStats) : null;

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
    setCity(editing.city ?? null);
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

  // СКИДКА ЕСТЬ, ЕСЛИ ВПИСАНО ЧИСЛО (владелец 2026-09-04: «там всегда будет
  // ноль, и не надо блока „без скидки“; а напишу скидку — тогда выбираю
  // валюту или процент»). Тип — это ЕДИНИЦА вписанного, а не признак
  // существования: ноль остаётся нулём хоть в евро, хоть в процентах.
  const globalDiscount: Discount | null = useMemo(() => {
    const value = parseMoneyInput(discountValue);
    if (!value) return null;
    return {
      type: discountType ?? "fixed",
      value,
      reason: discountReason ?? undefined,
    };
  }, [discountType, discountValue, discountReason]);

  const discountAmount = globalDiscountAmount(selectedServices, globalDiscount);
  const automaticTotal = Math.max(0, computedTotal - discountAmount);
  const effectiveTotal = customTotal
    ? parseMoneyInput(totalDraft)
    : automaticTotal;

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
    // Считаем по ВПИСАННОМУ: тип теперь лишь единица измерения.
    if (parseMoneyInput(discountValue) > 0 && !loyaltyAppliedRef.current) return;
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
  // ОДИН РАЗ ЗА ЖИЗНЬ ЭКРАНА, и только вперёд: idle → client → services →
  // done. Закрыл лист — цепочка кончилась и сама не воскреснет; иначе
  // закрытие выглядело бы сломанным. Это состояние, а не ref: второе звено
  // ждёт, пока доедет прайс, а ref эффект не будит.
  const [chainStep, setChainStep] = useState<
    "idle" | "client" | "clientClosing" | "services" | "done"
  >("idle");
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
    //
    // СНАЧАЛА ЖДЁМ, ПОКА УЙДЁТ ШТОРКА КЛИЕНТА. Обе шторки — окна `Modal`, и
    // вторая, поданная пока первая ещё уходит, не показывается вовсе: iOS
    // отвечает «already presenting». Состояние при этом считало лист услуг
    // открытым, и тап по «Выбрать услугу» ставил то же самое значение —
    // экран замирал насмерть (владелец 2026-09-04: «после выбора клиента
    // лагает, не могу нажать выбрать услугу»; ошибка найдена в системном
    // журнале). Ждём `onExited` — тот же сигнал, что у «Добавить объект».
    if (chainStep === "client") {
      setChainStep(clientPickerOpen ? "clientClosing" : "services");
    }
  };

  // КАРТОЧКА КЛИЕНТА ПОВЕРХ ЗАПИСИ (владелец 2026-09-04: «при тапе на клиента
  // должна открываться карточка клиента»). Тот же приём, что у создания
  // клиента: маршрут корневого стека `/book/client`, а не вкладка «Клиенты»,
  // — иначе поверх записи ляжет вторая копия табов и «назад» уведёт на
  // календарь, потеряв набранное. Запись остаётся смонтированной под
  // карточкой, «назад» возвращает ровно в неё.
  const openClientCard = () => {
    if (!clientId) return;
    haptics.tap();
    router.push({ pathname: "/book/client", params: { id: clientId } });
  };

  const pickLocation = (id: string) => {
    setLocationId(id);
    const loc = clientLocations.find((l) => l.id === id);
    if (loc) {
      setAddress(locationAddressForBooking(loc));
    }
    haptics.tap();
  };

  // КЛИЕНТ, ЗАВЕДЁННЫЙ РАДИ ЭТОЙ ЗАПИСИ. Карточка нового клиента открывается
  // ПОВЕРХ формы (`/book/client`), после «Готово» кладёт id в ящик и уходит
  // «назад»; форма забирает его, получив фокус. Дальше — тот же `pickClient`,
  // что и тап по списку: объект, любимый мастер, цепочка услуг. Список
  // клиентов может ещё ехать после инвалидации — держим id, пока созданный
  // в нём не появится.
  const [createdClientId, setCreatedClientId] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      const id = takeCreatedClient();
      if (id) setCreatedClientId(id);
    }, []),
  );
  useEffect(() => {
    if (!createdClientId) return;
    const created = clients.find((c) => c.id === createdClientId);
    if (!created) return;
    setCreatedClientId(null);
    pickClient(created);
    // pickClient пересобирается каждый рендер; нужен только клиент.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createdClientId, clients]);

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
    clientId,
  );

  // ═══ ЗАМЕТКА КЛИЕНТА И ЗАМЕТКА ОБЪЕКТА — ПОЛЯМИ ПРЯМО В ФОРМЕ ═══
  //
  // Владелец 2026-09-04: «не надо тапать „добавить заметку“ — мини-блок, куда
  // можно вписывать сразу, как в самом низу: заметка объекта, заметка
  // клиента, внизу заметка записи». Это то, что бригаде надо знать до
  // выезда и что живёт не в записи, а в клиенте («звонить после 18») и в
  // объекте («код ворот 1234»).
  //
  // ЗАМЕТКА КЛИЕНТА — ПОСЛЕДНЯЯ ЗАПИСЬ ЖУРНАЛА. На карточке заметки — датированный
  // журнал; поле здесь правит его последнюю запись на месте, а пустому
  // журналу заводит первую. Стёрли поле — последняя запись уходит. Журнал
  // пишется тем же писателем «свежайший массив + очередь», что и на карточке.
  // Импортированная заметка (`comment` из CSV) при первой правке переезжает
  // в журнал — ОДНИМ патчем вместе с журналом, как на карточке чистит её «✕».
  // Два патча подряд (журнал и отдельно comment) в офлайн-кэше затирали друг
  // другу колонку (ревью 2026-09-04).
  const migrateImportedComment =
    !!client &&
    (client.notes ?? []).length === 0 &&
    (client.comment ?? "").trim() !== "";
  const notesWriter = useJsonArrayWriter<ClientNote>(
    client?.notes ?? EMPTY_NOTES,
    (next) =>
      updateClientPatch(
        migrateImportedComment ? { notes: next, comment: "" } : { notes: next },
      ),
    clientId,
  );
  // Поле привязано к КОНКРЕТНОЙ записи журнала (ключ — её id): стёр — снялась
  // именно она; набрал заново после стирания — родилась новая, а не
  // переписалась соседняя. Ключ `null` — записи ещё нет.
  const writeClientNote = (next: string, boundId: string | null) => {
    if (!client) return;
    let createdId: string | null = null;
    void notesWriter.apply((all) => {
      const edited = applyNoteEdit(all, next, boundId, () => ({
        id: randomUuid(),
        created_at: new Date().toISOString(),
      }));
      createdId = edited.createdId;
      return edited.notes;
    });
    return createdId ?? undefined;
  };
  const writeObjectNote = (next: string, boundId: string | null) => {
    if (!boundId) return;
    void locationWriter.patchLocation(boundId, { note: next || undefined });
  };
  const clientNote = useInlineNote<string | null>(
    latestClientNote,
    latestClientNoteEntry?.id ?? null,
    writeClientNote,
    clientId,
  );
  const objectNote = useInlineNote<string | null>(
    selectedLocation?.note ?? "",
    locationId,
    writeObjectNote,
    locationId,
  );

  const toggleService = (id: string) => {
    setServiceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    haptics.tap();
  };
  // ЦЕНА УСЛУГИ В ЭТОЙ ЗАПИСИ. Ноль законен: бывает «сделали бесплатно».
  const setLinePrice = (id: string, price: number) => {
    setOverrides((p) => ({ ...p, [id]: { ...p[id], price: Math.max(0, price) } }));
  };
  const setQty = (id: string, qty: number) => {
    if (qty < 1) {
      setServiceIds((p) => p.filter((x) => x !== id));
      return;
    }
    setOverrides((p) => ({ ...p, [id]: { ...p[id], qty } }));
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
      // Объект могли удалить листом правки прямо отсюда: висячий id в новую
      // запись не пишем, адрес-снимок остаётся. Правку не трогаем — там
      // пропавший объект законен, адрес держит снимок записи.
      location_id:
        isEdit || locationId == null || clientLocations.some((l) => l.id === locationId)
          ? locationId
          : null,
      address: address.trim(),
      color_override: colorOverride,
      // Метка записи: null — «как у дня», строка — своя.
      city,
      global_discount: globalDiscount,
      discount_amount: discountAmount,
      reminder_enabled: reminderOn && Boolean(client?.phone),
    };
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
    if (chainStep !== "idle") return;
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
        setChainStep("services");
        return;
      }
      setChainStep("client");
      setClientPickerOpen(true);
    }, CHAIN_START_MS);
    return () => clearTimeout(timer);
  }, [chainStep, isEdit, kind, referencesPending, clientId]);

  // ВТОРОЕ ЗВЕНО — УСЛУГИ. Ждём прайс: он не в числе базовых справочников,
  // и лист, открытый до его приезда, показывал честную на вид пустоту
  // «У команды пока нет услуг». ПУСТОЙ ПРАЙС НЕ ОТКРЫВАЕМ ВОВСЕ: лист, в
  // котором нечего выбрать, — это экран, который человек только закрывает
  // (поймано на симуляторе 2026-09-03 у команды без единой услуги). Строка
  // «Выбрать услугу» на форме остаётся в одном тапе.
  useEffect(() => {
    if (chainStep !== "services") return;
    if (servicesQuery.isPending) return;
    setChainStep("done");
    if (serviceIds.length === 0 && teamServices.length > 0) {
      setServicePickerOpen(true);
    }
  }, [chainStep, servicesQuery.isPending, serviceIds.length, teamServices.length]);

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
      : clientId != null &&
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
    // Тап по кнопке фокус у поля не отбирает — заметки клиента и объекта
    // дописываем сами, иначе набранное осталось бы в черновике поля.
    clientNote.commit();
    objectNote.commit();
    try {
      if (isEdit && editId) {
        // Правка идёт мимо useBookingSave: тот хук — про РОЖДЕНИЕ заявки и
        // её хвост (гашение напоминания ТО, постановка push события). У
        // существующей записи этот хвост уже отработал в день создания.
        await updateMut.mutateAsync({ id: editId, patch: buildPatch() });
        toast("Изменения сохранены", "success");
        haptics.success();
      } else {
        const created = await booking.save({
          patch: buildPatch(),
          kind,
          reminderId,
          eventReminderOffset,
          timezone:
            team?.timezone ?? calendarSettings?.timezone ?? "Europe/Nicosia",
        });
        if (pendingPayment && created.kind === "work") {
          // Деньги новой записи ждали её id — уходят тем же событием, что
          // тап по счёту у существующей записи (STORY-065).
          try {
            await recordPayment.mutateAsync({
              appointmentId: created.id,
              accountId: pendingPayment.accountId,
              amount: pendingPayment.amount,
              requestId: randomUuid(),
              kind: pendingPayment.kind,
              closeVisit: pendingPayment.kind === "settlement",
            });
          } catch (e) {
            notify("Запись создана, оплата не записана", (e as Error).message);
          }
        }
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
    // ФЛАГ СОСТОЯНИЯ, А НЕ REF — ТА ЖЕ ПРИЧИНА, ЧТО У `hydrated` ВЫШЕ.
    // `editHydrated` выставляется синхронно внутри гидрации, поэтому этот
    // эффект отрабатывал в ТОМ ЖЕ коммите и снимал «как было» с ПУСТОЙ формы:
    // сегодняшняя дата, 10:00, ни клиента, ни услуг. Дальше запись ложилась в
    // состояние, подпись расходилась со снимком — и всякая открытая запись
    // считалась изменённой. «Отмена» спрашивала «Закрыть без сохранения?» у
    // того, кто ничего не трогал, то есть диалог врал ровно там, где обязан
    // говорить правду. `hydrated` переключается со следующим рендером — когда
    // значения записи УЖЕ в состоянии.
    if (!isEdit || !hydrated || editBaselineRef.current != null) {
      return;
    }
    editBaselineRef.current = editSignature;
  }, [isEdit, hydrated, editSignature]);

  // Заметки клиента и объекта — тоже «введённое»: диалог «Введённое не
  // сохранится» обязан говорить правду, поэтому их черновики считаются здесь
  // и выбрасываются по явному «Закрыть» (см. `discardNotes`).
  const notesDirty = clientNote.dirty || objectNote.dirty;
  const dirty = isEdit
    ? notesDirty ||
      (editBaselineRef.current != null && editSignature !== editBaselineRef.current)
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
        // Скидкой считается ВПИСАННОЕ, а не выбранная валюта: переключить
        // «€ | %» и ничего не набрать — не значит тронуть запись.
        parseMoneyInput(discountValue) > 0 ||
        status !== "scheduled" ||
        reminderOn ||
        pendingPayment != null ||
        colorOverride != null ||
        cityTouched ||
        dateTouchedRef.current ||
        durationTouched ||
        notesDirty);
  const discardNotes = () => {
    clientNote.discard();
    objectNote.discard();
  };
  const confirmDiscard = (onDiscard: () => void) => {
    confirmThen(
      "Закрыть без сохранения?",
      {
        message: "Введённое не сохранится.",
        confirmLabel: "Закрыть",
        destructive: true,
      },
      () => {
        discardNotes();
        onDiscard();
      },
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
  // Цвет записи — тот же, что станет блоком в календаре. Он владеет только
  // ХРОМОМ (подложка, шапка-halo, градиент CTA, образец в углу); семантические
  // токены (зелёный/красный/янтарь) и белые карточки не трогает.
  const picked = kind === "event" ? eventColor : colorOverride;
  /** Цвет выбран РУКОЙ — для озвучки и для листа выбора, не для покраски. */
  const hasColor = picked != null;
  // ЦВЕТ ЗАПИСИ — ОДНО ПРАВИЛО С КАЛЕНДАРЁМ (`record-color`): рука человека,
  // потом первая незакрытая дыра из палитры, потом «обычный» цвет по
  // настройке. Форма обязана показывать ровно то, что покажет сетка.
  //
  // Считается ДВАЖДЫ и по одному правилу: с выбранным цветом — это цвет
  // записи, и им красится всё; без него — цвет, который ДЕЙСТВОВАЛ БЫ, и его
  // показывает кнопка «Автоматически» в листе. Иначе выбор идёт вслепую:
  // слово обещает, что цвет подставят, и умалчивает какой.
  const identityFor = (override: string | null) =>
    kind === "work"
      ? resolveRecordColor({
          override,
          filled: recordFilled({
            client_id: clientId,
            location_id: locationId,
            address,
            service_ids: serviceIds,
            custom_total: customTotal,
            total_amount: effectiveTotal,
          }),
          base:
            autoColorRule === "label"
              ? teamCities.find((c) => c.name === effectiveLabel)?.color ??
                team?.color ??
                null
              : autoColorRule === "service"
                ? // Источник — живой черновик, поэтому шапка перекрашивается
                  // прямо в момент выбора услуги, а кнопка «Автоматически» в
                  // листе цвета показывает то, что встанет в сетке.
                  serviceBaseColor(
                    { service_ids: serviceIds },
                    (id) => serviceColorById.get(id),
                  ) ??
                  team?.color ??
                  null
                : team?.color ?? null,
          palette: situationPalette,
          active: activeSituations,
          fallback: fallbackColor,
        })
      : override ?? team?.color ?? t.accent;
  const identityC = identityFor(picked);
  /** Что подставится, если руками не выбирать. */
  const identityAuto = identityFor(null);
  // ЭКРАН КРАСИТСЯ ДЕЙСТВУЮЩИМ ЦВЕТОМ, А НЕ ТОЛЬКО ВЫБРАННЫМ РУКОЙ (владелец
  // 2026-09-05: «если я выбираю „Автоматически“ — значит подсвечивается именно
  // тем цветом, который сейчас стоит в автоматическом режиме»).
  //
  // Раньше карточки шапки брали `identityC` — полное правило записи, — а
  // подложка, шапка, halo, градиент кнопки и образец в углу брали «только
  // выбранный руками». Запись без клиента выходила серой в трёх карточках и
  // кобальтовой во всём остальном: один предмет двух цветов. Правило одно, и
  // цвет у записи есть ВСЕГДА — выбранный, ситуационный, командный или
  // запасной, — поэтому и гасить подсветку не от чего.
  const groundBg = tintOver(identityC, t.canvas, 0.06);
  const headerBg = tintOver(identityC, t.canvas, 0.1);
  const headerBorder = tintOver(identityC, t.canvas, 0.28);

  // «Маршрут» — реальное действие (его не было): открыть адрес в картах.
  // МАРШРУТ ЖИВЁТ У СТРОКИ ОБЪЕКТА, А НЕ У ФОРМЫ. Свой лист маршрута тут
  // висел ради поля «Адрес выезда»; поля не стало (владелец 2026-09-04), а
  // у выбранного объекта кнопка своя — `ObjectRouteButton` внутри строки.

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
        <Halo color={identityC} intensity={0.16} />
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
              }: ${colorName(identityC)}${hasColor ? "" : ", автоматически"}`}
              accessibilityHint="Открывает выбор цвета — им подсвечивается вся запись"
            >
              {/* ОБРАЗЕЦ ПОКАЗЫВАЕТ ДЕЙСТВУЮЩИЙ ЦВЕТ, А НЕ ФАКТ ВЫБОРА. Здесь
                  рисовалась иконка палитры, пока цвет не выбран руками, — то
                  есть кнопка «Цвет» молчала именно тогда, когда цвет было
                  интереснее всего увидеть: у записи без клиента он серый, у
                  выезда без объекта — оранжевый, и это и есть ответ. */}
              {/* БЕЗ ПОДПИСИ «Цвет» (аудит 2026-09-06): единственная подписанная
                  кнопка шапки во всём продукте спорила с «Отмена» и заголовком.
                  Образец крупнее — 28pt, — чтобы читаться как кнопка; имя для
                  VoiceOver — в accessibilityLabel. */}
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: t.radius.card,
                  borderCurve: "continuous",
                  backgroundColor: identityC,
                  borderWidth: 2,
                  borderColor: t.surface,
                  boxShadow: `0px 1px 4px ${identityC}66`,
                }}
              />
            </Pressable>
          </View>
        </View>
      </View>

      {/* KAV МЕРЯЕТ СЕБЯ ОТНОСИТЕЛЬНО РОДИТЕЛЯ, А КЛАВИАТУРУ — В ОКНЕ.
          `Screen` кладёт верхний safe-area отступ во внешний View, и `layout.y`
          у KAV начинается ПОД ним: перекрытие с клавиатурой недооценивалось
          ровно на высоту «острова» (59pt), и кнопка «Создать запись» уезжала
          под клавиатуру наполовину — поймано на симуляторе 2026-09-03, когда
          у него отключили аппаратную клавиатуру. `keyboardVerticalOffset` и
          есть это расстояние от верха окна до View. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top}
      >
        <ScrollView
          // СКРОЛЛ УПИРАЕТСЯ В КРАЙ БЛОКОВ, А НЕ ТЯНЕТСЯ (владелец 2026-09-06:
          // «должно фиксироваться чётко на конце блока — а не можно поднимать
          // сколько угодно»). Резинка iOS у формы ничего не значит: тянуть
          // для обновления здесь нечего.
          bounces={false}
          overScrollMode="never"
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
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
              {/* КТО И КУДА — одной карточкой: команда с мастером и метка
                  этого выезда (владелец 2026-09-04: «можем совместить команду
                  и метку в одно, а время поставить блоком ниже»). */}
              <TeamLabelRow
                teamName={team?.name ?? "Команда"}
                teamColor={team?.color ?? t.accent}
                masterName={
                  masterId
                    ? masters.find((m) => m.id === masterId)?.full_name ?? null
                    : null
                }
                label={effectiveLabel}
                labelColor={
                  teamCities.find((c) => c.name === effectiveLabel)?.color ?? null
                }
                labelFromDay={city == null}
                showLabel={showLabelBlock}
                onEditTeam={() => {
                  setTeamSheetOpen(true);
                  haptics.tap();
                }}
                onEditLabel={() => {
                  setLabelSheetOpen(true);
                  haptics.tap();
                }}
              />

              {/* КОГДА — своим блоком ниже; предупреждения о времени живут
                  здесь же, под ним. */}
              <WhenRow
                date={date}
                timeStart={timeStart}
                timeEnd={timeEnd}
                // ДЛИТЕЛЬНОСТЬ — ПО КОНЦУ ЗАПИСИ, А НЕ ПО СУММЕ УСЛУГ: конец,
                // заданный руками, докет иначе игнорировал.
                duration={minutesBetweenHM(timeStart, timeEnd) || slotFallback}
                warning={workWarning}
                onPress={() => {
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
              {/* ТАП ПО КЛИЕНТУ ОТКРЫВАЕТ ЕГО КАРТОЧКУ (владелец 2026-09-04).
                  Раньше строка вела в выбор клиента, и посмотреть, кому едешь
                  — телефоны, объекты, историю, долг — из записи было нельзя.

                  ПОПРАВКА ТОГО ЖЕ ДНЯ, СЛОВАМИ ВЛАДЕЛЬЦА: «при тапе на
                  клиента открывается ВЫБОР нового клиента, а справа от
                  телефона значок — три точки, — по нему переход в карточку».
                  Так строка везде значит одно: тап по выбранному открывает
                  выбор (клиент, объект, услуга), а всё, что ведёт вглубь,
                  живёт кружком в хвосте. Стрелки справа больше нет ни у
                  клиента, ни у объекта. */}
              <SectionCard title="Клиент">
                {client ? (
                  <View className="flex-row items-center">
                    <Pressable
                      className="flex-1 flex-row items-center px-4 py-2.5"
                      onPress={() => {
                        setClientPickerOpen(true);
                        haptics.tap();
                      }}
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
                        {/* ПОРЯДОК КАК В СПИСКЕ КЛИЕНТОВ: имя, деньги, связь.
                            Раньше история ВЫТЕСНЯЛА телефон — у постоянного
                            клиента номер из записи пропадал вовсе. */}
                        <ClientHistoryLine client={client} stats={clientStats} />
                        <Text
                          style={{
                            fontSize: 13,
                            color: client.phone ? t.sub : t.placeholder,
                            marginTop: 2,
                          }}
                          numberOfLines={1}
                        >
                          {client.phone ?? "без телефона"}
                        </Text>
                      </View>
                    </Pressable>
                    {client.phone ? (
                      // Та же кнопка, что у номера в карточке и в списке: тап
                      // звонит, удержание — способы связи; 32pt, как маршрут
                      // и «…» (владелец 2026-09-06).
                      <View className="mr-4 self-center">
                        <PhoneChannelButton
                          number={client.phone}
                          telegramUsername={client.telegram_username}
                          label={client.full_name || undefined}
                        />
                      </View>
                    ) : null}
                    {/* «…» — карточка клиента: телефоны, объекты, история,
                        долг. Снаружи нажимаемой области строки, иначе
                        VoiceOver склеит их в один элемент. */}
                    <Pressable
                      onPress={openClientCard}
                      className="mr-4 items-center justify-center self-center rounded-full"
                      style={{ width: 32, height: 32, backgroundColor: t.rowFill }}
                      accessibilityRole="button"
                      accessibilityLabel={`Карточка клиента ${client.full_name || "без имени"}`}
                    >
                      <MoreHorizontal color={t.body} size={ICON.sm} />
                    </Pressable>
                  </View>
                ) : (
                  <ChooseRow
                    icon={UserRound}
                    label="Выбрать клиента"
                    hint="Открывает поиск по имени или телефону"
                    onPress={() => setClientPickerOpen(true)}
                  />
                )}
                {/* ЗАМЕТКА КЛИЕНТА — мини-блок под клиентом, пишет в клиента
                    (см. `writeClientNote`). */}
                {client ? (
                  <InlineNoteField
                    note={clientNote}
                    placeholder="Заметка клиента"
                    accessibilityLabel="Заметка клиента"
                    maxLength={500}
                  />
                ) : null}
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
              {showObject ? (
              <SectionCard title="Объект">
                {client ? (
                  // БЕЗ ВЕРХНЕГО ВОЛОСКА: он шёл сразу под заголовком «ОБЪЕКТ»
                  // и читался как чужая линия — у карточки клиента её нет.
                  <View>
                    {/* ОБЪЕКТ ВЕДЁТ СЕБЯ КАК КЛИЕНТ (владелец 2026-09-03: «мы
                        тапаем на клиента — открывается выбор клиента; то же
                        самое объект: тапаем на объект — идёт замена объекта, и
                        внизу вылазит „Добавить объект“»). Строки «Добавить
                        объект» под выбранным больше нет: она стояла бы под
                        объектом, как не стоит «Добавить клиента» под клиентом.
                        Добавление живёт в листе выбора — там, куда идут, когда
                        нужного объекта нет.

                        Строка НЕ СКОПИРОВАНА, а взята та же — `ObjectRow` с
                        карточки клиента (владелец 2026-08-31: «блок объекта
                        должен быть такой же, как в клиентах»). Разница ровно
                        одна: здесь объект ВЫБИРАЮТ, поэтому справа шеврон, а
                        заметка объекта стоит своей плашкой под строкой, а не
                        третьей строкой. */}
                    {selectedLocation ? (
                      <>
                        <ObjectRow
                          loc={selectedLocation}
                          showNote={false}
                          onMore={() => {
                            setObjectEdit(true);
                            haptics.tap();
                          }}
                          onPress={() => {
                            setObjectPicker(true);
                            haptics.tap();
                          }}
                        />
                        {/* ЗАМЕТКА ОБЪЕКТА — «код ворот», «ключ у соседей»:
                            мини-блок пишет прямо в объект (см. `writeObjectNote`),
                            третья строка карточки объекта её не дублирует. */}
                        <InlineNoteField
                          note={objectNote}
                          placeholder="Заметка объекта"
                          accessibilityLabel="Заметка объекта"
                        />
                      </>
                    ) : clientLocations.length > 0 ? (
                      /* Объекты есть, но ни один не выбран (снят после
                         удаления или запись сохранена с разовым адресом): та
                         же строка-дверь, что «Выбрать клиента».

                         ПОЛЯ «АДРЕС ВЫЕЗДА» ЗДЕСЬ БОЛЬШЕ НЕТ (владелец
                         2026-09-04: «тут должно быть просто в блоке „Добавить
                         объект“, без адреса выезда и так далее»). Блок
                         объекта отвечает на один вопрос — КУДА ехать, — и
                         ответ у него один: объект. Разовый выезд по звонку
                         заводится тем же объектом, на это есть строка ниже.
                         Адрес-снимок сохранённой записи цел: состояние
                         `address` гидрируется и уезжает в патч как было. */
                      <ChooseRow
                        icon={MapPin}
                        label="Выбрать объект"
                        hint="Открывает список объектов клиента"
                        onPress={() => {
                          setObjectPicker(true);
                          haptics.tap();
                        }}
                      />
                    ) : null}

                    {/* ПОДСКАЗКА «ПОРА ОБСЛУЖИТЬ ОБОРУДОВАНИЕ» СНЕСЕНА
                        2026-09-04 вместе с самим интервалом обслуживания
                        (владелец: «сделаем лучше в напоминаниях для клиента»).
                        Она считалась по технике объекта, а техники в продукте
                        нет с тех пор, как ушёл словарь кондиционеров: строка
                        не могла загореться ни у одного клиента. */}

                    {/* У клиента без единого объекта выбирать нечего — первый
                        заводится прямо отсюда, листом добавления. */}
                    {clientLocations.length === 0 ? (
                      <View style={{ borderTopWidth: 1, borderTopColor: t.separator }}>
                        <AddRow
                          label="Добавить объект"
                          onPress={() => setObjectSheet(true)}
                        />
                      </View>
                    ) : null}
                  </View>
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

              ) : null}

              {/* УСЛУГИ. Заголовок был «Услуги и сумма» — владелец
                  2026-08-31: «убираем, просто ставим услуги». Сумма и так
                  стоит в блоке строкой «Итого»; называть её ещё и в шапке
                  значило объявлять два предмета там, где предмет один: набор
                  работ, у которого есть цена. */}
              <SectionCard title="Услуги">
                {serviceIds.length === 0 ? (
                  <>
                    {/* ТА ЖЕ ДВЕРЬ, ЧТО У КЛИЕНТА И ОБЪЕКТА (аудит 2026-09-06):
                        три пустых состояния формы отвечают на один вопрос и
                        выглядят одинаково. */}
                    <ChooseRow
                      icon={Briefcase}
                      label="Выбрать услугу"
                      hint="Открывает список услуг"
                      onPress={() => setServicePickerOpen(true)}
                    />
                    <TotalRow
                      total={effectiveTotal}
                      custom={customTotal}
                      discountAmount={discountAmount}
                      discountReason={discountReason}
                      onPress={() => {
                        setTotalSheetOpen(true);
                        haptics.tap();
                      }}
                    />
                  </>
                ) : (
                  <>
                    {selectedServices.map((line, index) => {
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
                          // Волосок — МЕЖДУ строками, не под шапкой «УСЛУГИ»:
                          // у остальных карточек под надписью линии нет.
                          style={{ borderTopWidth: index > 0 ? 1 : 0, borderTopColor: t.separator }}
                        >
                        {/* ТАП ПО УСЛУГЕ ОТКРЫВАЕТ СПИСОК УСЛУГ ЗАНОВО (владелец
                            2026-09-04: «„Добавить услугу“ убираем; тапаю по
                            выбранной услуге — открывается список»). Та же
                            грамматика, что у клиента и объекта: строка выбранного
                            и есть дверь к выбору. Степпер и цена внутри строки
                            ловят свои касания сами. */}
                        <Pressable
                          className="flex-row items-center px-4 py-2.5"
                          onPress={() => {
                            setServicePickerOpen(true);
                            haptics.tap();
                          }}
                          style={({ pressed }) => ({
                            backgroundColor: pressed ? t.pressed : "transparent",
                          })}
                          accessibilityRole="button"
                          accessibilityLabel={`${lineName}, ${durationLabel(line.duration)}, ${formatEURExact(line.totalPrice)}`}
                          accessibilityHint="Открывает выбор услуг"
                        >
                          {/* ЦВЕТ УСЛУГИ СТОИТ И ЗДЕСЬ (владелец 2026-09-04:
                              «цвет услуги должен быть также в услуге»): в
                              списке выбора он есть, а в самой записи услуги
                              стояли безымянными строками. Точки выстроены
                              столбиком — список читается сверху вниз одним
                              взглядом. */}
                          <ColorDot value={svc?.color ?? null} size={10} />
                          <View className="flex-1 pl-2.5 pr-2">
                            <Text style={{ fontSize: 15, color: t.ink }}>{lineName}</Text>
                            <Text style={{ fontSize: 13, color: t.placeholder, marginTop: 1 }}>
                              {durationLabel(line.duration)}
                            </Text>
                          </View>
                          {/* СКОЛЬКО РАЗ ВЗЯЛИ — ОТТИСКОМ «×3» (владелец
                              2026-09-04, выбрал из четырёх вариантов на
                              экране сравнения). Стрелок вверх/вниз больше
                              нет: количество набирают тапами в списке услуг,
                              который открывает эта же строка. */}
                          <QtyBadge
                            qty={line.quantity}
                            unit={line.unit ?? svc?.unit ?? null}
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
                        </Pressable>
                        </View>
                      );
                    })}
                    {/* ИТОГ — ДВЕРЬ, А НЕ ПОЛЕ (владелец 2026-09-04: «когда я
                        открываю „Итого“, открывается шторка, где прописаны
                        каждая услуга, количество их, и там же скидки»).
                        Скидка называется прямо в строке: видно, почему сумма
                        меньше суммы услуг. */}
                    <TotalRow
                      total={effectiveTotal}
                      custom={customTotal}
                      discountAmount={discountAmount}
                      discountReason={discountReason}
                      onPress={() => {
                        setTotalSheetOpen(true);
                        haptics.tap();
                      }}
                    />
                  </>
                )}
              </SectionCard>

              {/* Оплата — сразу после «Итого»: плитки счетов команды, тап
                  пишет деньги сразу (STORY-065). Выключается в Кабинет →
                  «Запись»: не всякий бизнес принимает деньги в записи. */}
              {showPayment ? (
                <PaymentBlock
                  appointment={editing}
                  teamId={teamId}
                  totalDraft={effectiveTotal}
                  visit={{ date, timeStart, status }}
                  pending={pendingPayment}
                  onPendingChange={setPendingPayment}
                  onAppointmentChanged={(fresh) => {
                    // Сервер закрыл визит вместе с оплатой — форма обязана
                    // знать об этом, иначе «Сохранить» вернул бы старый статус,
                    // а «Отмена» спросила бы про несохранённые изменения.
                    setStatus(fresh.status);
                    editBaselineRef.current = null;
                  }}
                />
              ) : null}

              {/* Заметка записи — последняя строка формы: «Дополнительно» под ней
                  снесено 2026-08-30. Зовётся «заметка записи» (владелец
                  2026-09-04): под клиентом и объектом стоят их заметки, и
                  третье поле обязано сказать, чьё оно. */}
              {showNote ? (
              // БЛОК, КАК У СОСЕДЕЙ (владелец 2026-09-06: «заметка записи —
              // такой же блок, как под объектом или клиентом, с таким же
              // названием»). Надпись «Заметка» — та же малая шапка.
              <SectionCard title="Заметка">
                {/* ТО ЖЕ ПОЛЕ, ЧТО ЗАМЕТКИ КЛИЕНТА И ОБЪЕКТА (аудит 2026-09-06):
                    три заметки формы были набраны тремя способами — здесь
                    голый ввод 15pt, там плашки 13pt на подложке. Одна
                    заметка — одно поле. Скролл докручивается к полю при
                    фокусе: оно последнее, и KAV оставлял его под клавиатурой
                    (поймано 2026-09-03). */}
                <InlineNoteField
                  note={{
                    draft: comment,
                    setDraft: setComment,
                    onFocus: () =>
                      setTimeout(
                        () => scrollRef.current?.scrollToEnd({ animated: true }),
                        KEYBOARD_SETTLE_MS,
                      ),
                    onBlur: () => {},
                  }}
                  placeholder="Детали, пожелания, что взять с собой"
                  accessibilityLabel="Заметка записи"
                />
              </SectionCard>
              ) : null}

              {/* ФАЙЛЫ ЗАПИСИ (STORY-070): фото, документы; у сохранённой
                  записи — файлам нужен её id. К отменённой не добавляют. */}
              {editing ? (
                <AppointmentFilesBlock
                  appointmentId={editing.id}
                  clientId={editing.client_id}
                  locationId={editing.location_id}
                  canUpload={status !== "cancelled"}
                />
              ) : null}

              {/* ЖИЗНЬ ЗАПИСИ — ПОСЛЕДНЕЙ КАРТОЧКОЙ (аудит STORY-072): отменить
                  с причиной, вернуть в план, удалить. Раньше это жило только в
                  долгом нажатии по календарю. */}
              {editing ? (
                <AppointmentLifecycleCard
                  appointment={editing}
                  onStatusChanged={(next) => {
                    setStatus(next);
                    editBaselineRef.current = null;
                  }}
                  onDeleted={leaveBook}
                />
              ) : null}

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
            // Клавиатура iOS уже включает полосу home-индикатора: с её
            // отступом под кнопкой висели лишние ~34pt пустоты (тот же
            // закон, что у футера листов, DS §5).
            paddingBottom: keyboardShown ? 8 : insets.bottom + 8,
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
            дублирует. ЦВЕТ КНОПКИ — СИСТЕМНЫЙ, НЕ ЦВЕТ ЗАПИСИ (владелец
            2026-09-06: «кнопка не должна менять цвет, она должна оставаться
            единой в стиле нашей системы»): оранжевая запись давала бурую
            кнопку, и главное действие экрана переставало быть узнаваемым. */}
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
        />
        </View>
      </KeyboardAvoidingView>

      <WhenSheet
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
          // Конец перестаёт расти под услуги, только если его ДЛИТЕЛЬНОСТЬ
          // задали руками. Смена даты или начала — не про длительность:
          // попап сдвигает конец вместе с началом, и добавленная после
          // услуга по-прежнему обязана удлинить запись.
          const before = minutesBetweenHM(timeStart, timeEnd);
          const after = minutesBetweenHM(next.timeStart, next.timeEnd);
          if (next.allDay || after !== before) setDurationTouched(true);
        }}
        onClose={() => setWhenOpen(false)}
      />
      {/* Добавление объекта — ТОТ ЖЕ лист, что на карточке клиента: один
          диалект и одна дорога записи. Открывается с уже набранным здесь
          адресом и сразу выбирает добавленный объект для этой записи.

          АДРЕС ПОДСТАВЛЯЕТСЯ ТОЛЬКО РАЗОВЫЙ — тот, что набрали в поле без
          объекта. Пока выбран объект, `address` держит ЕГО адрес, и лист
          открывался с «Karpathou 9» в поле НОВОГО объекта: одно «Готово»
          заводило клиенту второй такой же дом. Поймано на симуляторе
          2026-09-03. */}
      {client ? (
        <ObjectSheet
          visible={objectSheet}
          client={client}
          update={updateClientPatch}
          writer={locationWriter}
          initialTarget={locationId ? "" : address}
          onAdded={(added) => {
            setAddedLocation({
              clientId: client.id,
              loc: { ...added, isPrimary: serverLocations.length === 0 },
            });
            setLocationId(added.id);
            setAddress(locationAddressForBooking(added));
            toast("Объект сохранён");
          }}
          onClose={() => setObjectSheet(false)}
        />
      ) : null}
      {client ? (
        <>
          {/* Выбор/замена объекта; «Добавить объект» в его футере открывает
              лист добавления, когда этот уже уехал. */}
          <ObjectPickerSheet
            visible={objectPicker}
            locations={clientLocations}
            selectedId={locationId}
            onSelect={(loc) => pickLocation(loc.id)}
            onAdd={() => setObjectSheet(true)}
            onClose={() => setObjectPicker(false)}
          />
          {/* Правка выбранного объекта — тем же листом, что на карточке. */}
          <ObjectEditSheet
            visible={objectEdit}
            client={client}
            locationId={objectEdit ? locationId : null}
            writer={locationWriter}
            onDeleted={forgetLocation}
            onClose={() => setObjectEdit(false)}
          />
        </>
      ) : null}
      <ClientPicker
        statsById={statsById}
        visible={clientPickerOpen}
        onClose={() => setClientPickerOpen(false)}
        onExited={() => {
          if (chainStep === "clientClosing") setChainStep("services");
        }}
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
        selectedIds={serviceIds}
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
      {/* ДЕНЬГИ ЗАПИСИ — ОДНИМ ЛИСТОМ: услуги с количеством, скидка в евро
          или процентах, итог. Открывается строкой «Итого». */}
      <TotalSheet
        visible={totalSheetOpen}
        onClose={() => setTotalSheetOpen(false)}
        lines={selectedServices}
        nameFor={(line) =>
          line.serviceName ?? nameById.get(line.serviceId) ?? "Услуга удалена"
        }
        colorFor={(line) => catalog.get(line.serviceId)?.color ?? null}
        onQtyChange={setQty}
        // ЦЕНА ПРАВИТСЯ У СТРОКИ, А НЕ У ИТОГА (владелец 2026-09-04). Пишем в
        // `overrides` — снимок ЭТОЙ записи; прайс команды не трогается.
        onPriceChange={setLinePrice}
        servicesTotal={computedTotal}
        // «Без скидки» больше не выбирают: ноль в поле и есть её отсутствие,
        // а переключатель говорит только, ЧЕМ считать вписанное.
        discountKind={discountType ?? "fixed"}
        discountValue={discountValue}
        discountAmount={discountAmount}
        discountReason={discountReason}
        onDiscountKindChange={setDiscountType}
        onDiscountValueChange={setDiscountValue}
        total={effectiveTotal}
        customTotal={customTotal}
        onResetTotal={() => setCustomTotal(false)}
      />
      <LabelSheet
        visible={labelSheetOpen}
        options={teamCities.map((c) => ({ name: c.name, color: c.color ?? t.accent }))}
        // ВЫБРАНА ТА, ЧТО ДЕЙСТВУЕТ СЕЙЧАС — своя либо взятая у дня (владелец
        // 2026-09-04: «открываем метку, там уже автоматически выбрана метка,
        // и можно выбирать другие»).
        value={effectiveLabel}
        onPick={(next) => {
          setCityTouched(true);
          setCity(next);
        }}
        onClose={() => setLabelSheetOpen(false)}
      />
      <ColorSheet
        visible={colorSheetOpen}
        onClose={() => setColorSheetOpen(false)}
        isEvent={kind === "event"}
        autoColor={identityAuto}
        value={kind === "event" ? eventColor : colorOverride}
        onPick={(c) => {
          if (kind === "event") setEventColor(c);
          else setColorOverride(c);
          haptics.tap();
        }}
      />
      {/* ИЗВЕСТНЫЙ ПРЕДЕЛ (2026-09-03, симулятор без аппаратной клавиатуры):
          панель показывается у «Итого», смонтированного вместе с экраном, и
          НЕ показывается у поля предоплаты, которое появляется позже, — ни при
          тапе, ни при фокусе из кода, ни после перемонтирования самой панели.
          Клавиатуру там убирают тапом мимо или потянув список вниз. */}
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

    </Screen>
  );
}
