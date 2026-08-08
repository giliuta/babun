import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  type AlertButton,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Clock,
  Phone,
  Repeat,
  Search,
  X,
} from "lucide-react-native";
import {
  appointmentTotal,
  globalDiscountAmount,
  totalDuration,
} from "@babun/shared/local/finance/appointment-calc";
import {
  APPOINTMENT_SOURCE_LABELS,
  createBlankAppointment,
  getPaidAmount,
  type Appointment,
  type AppointmentSource,
  type AppointmentStatus,
  type Discount,
  type PersonalEventRepeat,
} from "@babun/shared/local/appointments";
import {
  findBufferClash,
  findOverlap,
} from "@babun/shared/common/utils/appointment-overlap";
import {
  buildDebtPaidPatch,
  paymentMethodForAccountKind,
  PAY_METHOD_LABELS,
  type PayMethod,
} from "@/features/appointments/payment";
import { useTeamPaymentAccounts } from "@/features/appointments/payment-accounts";
import { AppointmentPhotos } from "@/features/appointments/AppointmentPhotos";
import { tierForVisits } from "@babun/shared/local/loyalty";
import { locationAddressForBooking } from "@babun/shared/local/clients";
import { formatEUR } from "@babun/shared/common/utils/money";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { SectionCard } from "@/components/ui/SectionCard";
import { OptionSheet } from "@/components/ui/OptionSheet";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ValueRow } from "@/components/ui/ValueRow";
import { ICON } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import {
  useCalendarSettings,
  useLoyalty,
  usePersonalEventTypes,
} from "@/features/settings/local-settings";
import type { PersonalEventType } from "@babun/shared/local/personal-event-types";
import { useClients, useCreateClient } from "@/features/clients/queries";
import {
  useCreateService,
  useServices,
  type Service,
} from "@/features/services/queries";
import { useMasters, useTeams } from "@/features/reference/queries";
import { RepeatReminderSheet } from "@/features/recurring/RepeatReminderSheet";
import { useCreateReminder } from "@/features/recurring/queries";
import {
  useCreateAppointment,
  useDeleteAppointment,
  useResetAppointmentPayment,
  useSetAppointmentPrepayment,
  useUpdateAppointment,
} from "@/features/calendar/mutations";
import { useCurrentRole } from "@/features/settings/tenant";
import { useAppointments } from "@/features/calendar/queries";
import {
  cancelAppointmentReminders,
  syncEventAppointmentReminders,
} from "@/features/calendar/reminders";
import {
  addMinutesHM,
  buildServices,
  formatHM,
  formatYMD,
  humanDay,
  parseHM,
  parseMoneyInput,
  parseYMD,
  unitPriceFor,
  type ServiceOverride,
} from "./helpers";

const CANCEL_REASONS = [
  "Клиент перенёс",
  "Клиент отменил",
  "Погода",
  "Не дозвонились",
  "Нет доступа",
  "Дубль",
];

const STATUSES: { value: AppointmentStatus; label: string }[] = [
  { value: "scheduled", label: "Запланировано" },
  { value: "in_progress", label: "В работе" },
  { value: "completed", label: "Выполнено" },
  { value: "cancelled", label: "Отменено" },
];

const SOURCE_OPTIONS: readonly {
  value: AppointmentSource | "";
  label: string;
}[] = [
  { value: "", label: "Не указан" },
  ...Object.entries(APPOINTMENT_SOURCE_LABELS).map(([value, label]) => ({
    value: value as AppointmentSource,
    label,
  })),
];

// Правила повтора события — те же 7 пресетов, что web RepeatPickerRow
// (custom_weekdays набирается только с веба, здесь не предлагаем).
const REPEAT_OPTIONS: {
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

// «Ежедневно · до 15 июля» — сводка правила повтора (бейдж + пикер).
function repeatLabel(r: PersonalEventRepeat): string {
  const base =
    REPEAT_OPTIONS.find((o) => o.value === r.kind)?.label ??
    (r.kind === "custom_weekdays" ? "По дням недели" : "Не повторять");
  const until = r.kind !== "none" ? r.until : undefined;
  return until ? `${base} · до ${humanDay(until)}` : base;
}

// "HH:MM" → minutes since midnight (sheet-local; shared helpers untouched).
const hmToMin = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

// Shallow id+qty+price signature — service-list equality for the dirty check.
const svcSignature = (
  list: { serviceId: string; quantity: number; pricePerUnit: number }[],
) => JSON.stringify(list.map((s) => [s.serviceId, s.quantity, s.pricePerUnit]));

const moneyDraft = (amount: number) =>
  String(Math.round(Math.max(0, amount) * 100) / 100);

export function AppointmentSheet({
  visible,
  onClose,
  appointment,
  defaults,
}: {
  visible: boolean;
  onClose: () => void;
  appointment?: Appointment | null;
  defaults?: {
    date?: string;
    time_start?: string;
    client_id?: string | null;
    location_id?: string | null;
    team_id?: string | null;
    /** Предвыбор услуг (?new= с карточки клиента / повторное ТО). */
    service_ids?: string[];
    /** Тип записи: "event" открывает шит сразу в режиме события. */
    kind?: Appointment["kind"];
  };
}) {
  const t = useThemeColors();
  const isEdit = !!appointment;
  const { data: clients = [] } = useClients();
  const createClient = useCreateClient();
  const { data: services = [] } = useServices();
  const { data: teams = [] } = useTeams();
  const { data: masters = [] } = useMasters();
  const createMut = useCreateAppointment();
  const updateMut = useUpdateAppointment();
  const deleteMut = useDeleteAppointment();
  const prepaymentMut = useSetAppointmentPrepayment();
  const resetPaymentMut = useResetAppointmentPayment();
  const currentRole = useCurrentRole().data;
  const createReminder = useCreateReminder();
  const toast = useToast();
  // Grid step drives the initial slot length for a new record (web parity:
  // the team's slot minutes size the tap-created slot, not a fixed hour).
  const { data: calSettings } = useCalendarSettings();

  const catalog = useMemo(
    () => new Map(services.map((s) => [s.id, s])),
    [services],
  );

  // История записей питает умные дефолты (кеш уже тёплый — календарь
  // грузит тот же queryKey): недавние клиенты, последняя команда,
  // частые услуги. Все три сокращают заполнение шита до 1 тапа на поле.
  const { data: allAppts = [] } = useAppointments();

  // Последние 5 клиентов по дате последней записи — верх пикера клиента.
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

  // Команда последней созданной записи — дефолт для новой (умный дефолт:
  // диспетчер обычно набивает день одной бригаде подряд).
  const lastTeamId = useMemo(() => {
    let best: string | null = null;
    let bestTs = "";
    for (const a of allAppts) {
      if (
        a.team_id &&
        a.created_at > bestTs &&
        teams.some((tm) => tm.id === a.team_id)
      ) {
        bestTs = a.created_at;
        best = a.team_id;
      }
    }
    return best;
  }, [allAppts, teams]);

  // Топ-4 услуг по частоте использования — быстрый выбор в один тап.
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

  const [clientId, setClientId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [timeStart, setTimeStart] = useState("10:00");
  const [timeEnd, setTimeEnd] = useState("11:00");
  const [durationTouched, setDurationTouched] = useState(false);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [masterId, setMasterId] = useState<string | null>(null);
  const [total, setTotal] = useState("0");
  const [customTotal, setCustomTotal] = useState(false);
  const [status, setStatus] = useState<AppointmentStatus>("scheduled");
  const [source, setSource] = useState<AppointmentSource | null>(null);
  const [reminderOn, setReminderOn] = useState(false);
  const [comment, setComment] = useState("");
  const [locationId, setLocationId] = useState<string | null>(null);
  // Адрес денормализован в запись (бригада видит куда ехать даже у
  // клиента без объектов): предзаполняется из выбранного объекта,
  // правится руками. address_note — «подъезд, код» рядом с навигацией.
  const [address, setAddress] = useState("");
  const [addressNote, setAddressNote] = useState("");
  const [overrides, setOverrides] = useState<Record<string, ServiceOverride>>({});
  // Черновики строк цены за услугу: controlled String(price) съедал
  // десятичный разделитель на каждом нажатии («12,» → 12 → «12»).
  // Пока поле в фокусе показываем сырую строку, парсим на лету.
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [discountType, setDiscountType] = useState<"fixed" | "percent" | null>(null);
  const [discountValue, setDiscountValue] = useState("");
  // Откуда скидка: метка уровня лояльности при автоприменении (пишется в
  // global_discount.reason — веб-паритет), null после ручной правки.
  const [discountReason, setDiscountReason] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [kind, setKind] = useState<"work" | "event">("work");
  const [eventColor, setEventColor] = useState<string | null>(null);
  const [eventNotes, setEventNotes] = useState("");
  const [eventUrl, setEventUrl] = useState("");
  const [eventReminderOffset, setEventReminderOffset] = useState<number | null>(
    null,
  );
  const [eventPushAt, setEventPushAt] = useState<string | null>(null);
  // Тип события — ПРЕСЕТ (веб-семантика): выбор чипа применяет цвет и
  // название, в запись не персистится. Локальный state сессии шита.
  const [eventTypeId, setEventTypeId] = useState<string | null>(null);
  // «Весь день» — время скрыто, диапазон 00:00–23:59, флаг пишется в
  // event_all_day (веб EventForm parity).
  const [allDay, setAllDay] = useState(false);
  // Правило повтора события (event_repeat, web RepeatPickerRow parity).
  const [repeat, setRepeat] = useState<PersonalEventRepeat>({ kind: "none" });
  // Время до включения «весь день» — выключение возвращает его.
  const preAllDayRef = useRef<{ start: string; end: string } | null>(null);

  const [clientPicker, setClientPicker] = useState(false);
  const [servicePicker, setServicePicker] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [sourceSheetOpen, setSourceSheetOpen] = useState(false);
  const [prepaymentOpen, setPrepaymentOpen] = useState(false);
  // «Выполнено» + долг → предлагаем сразу принять оплату.
  // null = «позже»: сохраняем без платежа, долг остаётся в «Должниках».
  const [payMethod, setPayMethod] = useState<PayMethod | null>(null);
  // Куда кладут деньги. null при выбранном способе — легаси-путь (счетов у
  // команды нет), сервер угадает счёт сам.
  const [payAccountId, setPayAccountId] = useState<string | null>(null);
  // Счета этой команды + подключённые общие. Без балансов: здесь выбирают
  // кассу, а не смотрят деньги.
  const { data: payAccounts = [] } = useTeamPaymentAccounts(teamId);
  // «Куда легло» — по строке на каждое поступление. Имя счёта берём из
  // справочника команды; платежи старых записей счёта не знают и честно
  // говорят «счёт определён автоматически», а не выдумывают кассу.
  const paidRows = useMemo(() => {
    const byId = new Map(payAccounts.map((a) => [a.id, a.name]));
    const rows: { key: string; text: string }[] = [];
    for (const p of appointment?.payments ?? []) {
      const where = p.account_id
        ? (byId.get(p.account_id) ?? "счёт недоступен")
        : "счёт определён автоматически";
      rows.push({
        key: p.id,
        text: `${formatEUR(p.amount)} · ${where}`,
      });
    }
    return rows;
  }, [appointment?.payments, payAccounts]);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentAmountTouched, setPaymentAmountTouched] = useState(false);

  // Лояльность — автоскидка уровня по числу завершённых визитов клиента
  // (порт apps/web/src/hooks/useLoyaltyAutoApply.ts): автозначение
  // заменяет только само себя, ручная скидка диспетчера всегда важнее.
  const { data: loyalty } = useLoyalty();
  const clientVisits = useMemo(
    () =>
      clientId
        ? allAppts.reduce(
            (n, a) =>
              a.client_id === clientId && a.status === "completed" ? n + 1 : n,
            0,
          )
        : 0,
    [allAppts, clientId],
  );
  const loyaltyAppliedRef = useRef<{ clientId: string; percent: number } | null>(
    null,
  );
  // Пара «поколение гидрации»: ref бампится СИНХРОННО в эффекте гидрации,
  // state догоняет со следующим рендером. Эффект лояльности сравнивает их
  // и пропускает волны, где стейт формы ещё от прошлой сессии шита.
  const hydratedSeqRef = useRef(0);
  const [hydratedSeq, setHydratedSeq] = useState(0);
  // Типы событий из кабинета — чипы быстрого применения в режиме «Событие».
  const { data: rawEventTypes = [] } = usePersonalEventTypes();
  const eventTypes = useMemo(
    () => [...rawEventTypes].sort((a, b) => a.order - b.order),
    [rawEventTypes],
  );
  // Зеркало текущей скидки: эффект автоприменения читает свежие значения,
  // не включая их в deps — иначе он дрался бы с ручной очисткой скидки.
  const discountRef = useRef({ type: discountType, value: discountValue });
  discountRef.current = { type: discountType, value: discountValue };

  // Hydrate on open.
  useEffect(() => {
    if (!visible) return;
    setRepeatOpen(false);
    setSourceSheetOpen(false);
    setPrepaymentOpen(false);
    setPayMethod(null);
    setPayAccountId(null);
    setPaymentAmount("");
    setPaymentAmountTouched(false);
    if (appointment) {
      setClientId(appointment.client_id);
      setDate(appointment.date);
      setTimeStart(appointment.time_start);
      setTimeEnd(appointment.time_end);
      setServiceIds(
        appointment.service_ids?.length
          ? appointment.service_ids
          : (appointment.services ?? []).map((s) => s.serviceId),
      );
      setTeamId(appointment.team_id);
      setMasterId(appointment.master_id ?? null);
      setTotal(String(appointment.total_amount ?? 0));
      setCustomTotal(!!appointment.custom_total);
      setStatus(appointment.status);
      setSource(appointment.source ?? null);
      setReminderOn(appointment.reminder_enabled);
      setComment(appointment.comment ?? "");
      setLocationId(appointment.location_id ?? null);
      setAddress(appointment.address ?? "");
      setAddressNote(appointment.address_note ?? "");
      setPriceDrafts({});
      setOverrides(
        Object.fromEntries(
          (appointment.services ?? []).map((s) => {
            // Seed a price override only when the stored line really was
            // overridden (differs from the catalog price of its day) or the
            // catalog can't reprice it (service deleted / not loaded yet).
            // Untouched lines stay ladder-priced, so qty edits re-tier —
            // web parity (appointment-services.ts userOverride check).
            const keepPrice =
              catalog.size === 0 ||
              !catalog.has(s.serviceId) ||
              s.pricePerUnit !== s.originalPrice;
            return [
              s.serviceId,
              { qty: s.quantity, ...(keepPrice ? { price: s.pricePerUnit } : {}) },
            ];
          }),
        ),
      );
      setDiscountType(appointment.global_discount?.type ?? null);
      setDiscountValue(
        appointment.global_discount ? String(appointment.global_discount.value) : "",
      );
      setDiscountReason(appointment.global_discount?.reason ?? null);
      loyaltyAppliedRef.current = null;
      setCancelReason(appointment.cancel_reason ?? "");
      setKind(appointment.kind === "work" ? "work" : "event");
      setEventColor(appointment.color_override ?? null);
      setEventNotes(appointment.event_notes ?? "");
      setEventUrl(appointment.event_url ?? "");
      setEventPushAt(
        appointment.event_push_enabled ? appointment.event_push_at ?? null : null,
      );
      setEventReminderOffset(
        appointment.event_push_enabled && !appointment.event_push_at
          ? appointment.event_push_offsets?.[0] ?? null
          : null,
      );
      // Пресеты не персистятся — выбранность чипа живёт только в сессии.
      setEventTypeId(null);
      setAllDay(appointment.event_all_day ?? false);
      setRepeat(appointment.event_repeat ?? { kind: "none" });
      preAllDayRef.current = null;
      // Web parity: the flag resets on EVERY open (edit too), so adding
      // services keeps auto-extending the end — the grow-only recalc
      // below never shrinks the stored end anyway.
      setDurationTouched(false);
    } else {
      const today = formatYMD(new Date());
      const start = defaults?.time_start ?? "10:00";
      setClientId(defaults?.client_id ?? null);
      setDate(defaults?.date ?? today);
      setTimeStart(start);
      // Длительность новой записи — настройка календаря той команды, куда
      // пишем (teams.default_slot_minutes). Раньше мобила читала «Шаг сетки»:
      // визуальная плотность рельса тайно назначала бизнес-правило «сколько
      // длится визит». Настройки шага больше нет, дефолт — честные 30 мин.
      const slotTeamId = defaults?.team_id ?? lastTeamId;
      setTimeEnd(
        addMinutesHM(
          start,
          teams.find((x) => x.id === slotTeamId)?.default_slot_minutes ?? 30,
        ),
      );
      // Предвыбор услуг из ?new= («Записать сюда» / повторное ТО).
      setServiceIds(defaults?.service_ids ?? []);
      // Умный дефолт: команда последней созданной записи (записи одной
      // бригаде обычно набивают подряд). Явный defaults?.team_id
      // («Записать сюда» с карточки клиента) всегда важнее.
      setTeamId(defaults?.team_id ?? lastTeamId);
      setMasterId(null);
      setTotal("0");
      setCustomTotal(false);
      setStatus("scheduled");
      setSource(null);
      setReminderOn(false);
      setComment("");
      // «Записать сюда» с карточки клиента предвыбирает объект (LOCKED
      // «Карта-диспетчер»: букинг в 2 тапа с предвыбранным объектом).
      setLocationId(defaults?.location_id ?? null);
      const defLoc = clients
        .find((c) => c.id === defaults?.client_id)
        ?.locations.find((l) => l.id === defaults?.location_id);
      setAddress(defLoc ? defLoc.address.trim() || defLoc.label.trim() : "");
      setAddressNote("");
      setPriceDrafts({});
      setOverrides({});
      setDiscountType(null);
      setDiscountValue("");
      setDiscountReason(null);
      loyaltyAppliedRef.current = null;
      setCancelReason("");
      setKind(defaults?.kind && defaults.kind !== "work" ? "event" : "work");
      setEventColor(null);
      setEventNotes("");
      setEventUrl("");
      setEventReminderOffset(null);
      setEventPushAt(null);
      setEventTypeId(null);
      setAllDay(false);
      setRepeat({ kind: "none" });
      preAllDayRef.current = null;
      setDurationTouched(false);
    }
    // Маркер «состояние этого открытия применено». Эффекты той же
    // волны (лояльность) видят ещё СТАРЫЕ значения стейта прошлой
    // сессии шита — им нельзя действовать, пока сеты выше не легли.
    hydratedSeqRef.current += 1;
    setHydratedSeq(hydratedSeqRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, appointment?.id]);

  const globalDiscount = useMemo<Discount | null>(() => {
    // parseMoneyInput: запятая — легальный десятичный разделитель
    // (EU decimal-pad), Number("12,5") молча давал NaN → скидка терялась.
    const value = parseMoneyInput(discountValue);
    return discountType && value > 0
      ? {
          type: discountType,
          value,
          ...(discountReason ? { reason: discountReason } : {}),
        }
      : null;
  }, [discountType, discountValue, discountReason]);

  // Автоприменение уровня лояльности при выборе клиента. Триггер —
  // hydratedSeq, НЕ visible: на волне открытия эффект видел бы стейт
  // прошлой сессии шита (клиент X, его скидка) и, применив её, затирал
  // сохранённую скидку только что открытой записи. hydratedSeq растёт
  // ПОСЛЕ того, как сеты гидрации легли, — здесь значения уже свежие.
  useEffect(() => {
    if (!visible || hydratedSeq !== hydratedSeqRef.current) return;
    const applied = loyaltyAppliedRef.current;
    const cur = discountRef.current;
    const isAuto =
      applied != null &&
      cur.type === "percent" &&
      parseMoneyInput(cur.value) === applied.percent;
    const dropAuto = () => {
      if (isAuto) {
        setDiscountType(null);
        setDiscountValue("");
        setDiscountReason(null);
      }
      loyaltyAppliedRef.current = null;
    };
    // Edit-режим: автоскидка только когда клиент РЕАЛЬНО сменился
    // относительно сохранённой записи. Иначе каждое открытие молча
    // уценивало запись и включало ложный «Сохранить изменения?».
    // Возврат к исходному клиенту снимает только свою автоскидку.
    if (isEdit && appointment && clientId === appointment.client_id) {
      dropAuto();
      return;
    }
    if (!clientId || !loyalty) {
      dropAuto();
      return;
    }
    const tier = tierForVisits(clientVisits, loyalty);
    if (!tier) {
      dropAuto();
      return;
    }
    // Ручную скидку не перезаписываем (веб-паритет: manual edit wins).
    if (cur.type != null && parseMoneyInput(cur.value) > 0 && !isAuto) return;
    setDiscountType("percent");
    setDiscountValue(String(tier.percent));
    setDiscountReason(tier.label);
    loyaltyAppliedRef.current = { clientId, percent: tier.percent };
  }, [hydratedSeq, visible, clientId, clientVisits, loyalty, isEdit, appointment]);
  const selectedServices = useMemo(
    () => buildServices(serviceIds, catalog, overrides),
    [serviceIds, catalog, overrides],
  );
  const computedTotal = useMemo(
    () => appointmentTotal(selectedServices, globalDiscount),
    [selectedServices, globalDiscount],
  );
  const computedDuration = useMemo(
    () => totalDuration(selectedServices),
    [selectedServices],
  );

  // Live end-time recalc (web parity): end ≥ start + Σ service durations,
  // grow-only — a manually-set or stored end is never shrunk back. Clamped
  // at 23:59 with a toast: a cross-midnight visit is booked as two records.
  useEffect(() => {
    if (durationTouched || computedDuration <= 0) return;
    const wanted = hmToMin(timeStart) + computedDuration;
    const requiredEnd = Math.min(23 * 60 + 59, wanted);
    if (requiredEnd > hmToMin(timeEnd)) {
      setTimeEnd(addMinutesHM("00:00", requiredEnd));
      if (wanted > requiredEnd)
        toast("Запись выходит за полночь — конец обрезан до 23:59", "info");
    }
  }, [timeStart, timeEnd, computedDuration, durationTouched, toast]);

  // Keep total in sync with catalog unless the operator overrode it.
  useEffect(() => {
    if (!customTotal) setTotal(String(computedTotal));
  }, [computedTotal, customTotal]);

  const effectiveTotal = customTotal ? parseMoneyInput(total) : computedTotal;
  // Долг = сумма минус уже полученное (аванс + платежи). Питает секцию
  // «Оплата» при статусе «Выполнено» (getPaidAmount — как «Должники»).
  const alreadyPaid = appointment ? getPaidAmount(appointment) : 0;
  // «Возвращено» — терминальное состояние старого платёжного цикла: деньги
  // и долг равны нулю; повторное обслуживание начинается новой заявкой.
  const debt =
    appointment?.payment_status === "refunded"
      ? 0
      : Math.max(0, effectiveTotal - alreadyPaid);
  const settlementAmount = parseMoneyInput(paymentAmount);
  const settlementScaleValid = /^\d+(?:[.,]\d{0,2})?$/.test(
    paymentAmount.trim(),
  );
  const settlementAmountValid =
    payMethod === null ||
    (status === "completed" &&
      debt > 0 &&
      settlementAmount > 0 &&
      settlementAmount <= debt &&
      settlementScaleValid);

  // Selecting a tender means «pay the full debt» by default. If total/debt
  // changes before save, keep that fast-path in sync until the dispatcher
  // explicitly edits the amount for a partial payment.
  useEffect(() => {
    if (!payMethod || paymentAmountTouched) return;
    setPaymentAmount(moneyDraft(debt));
  }, [debt, payMethod, paymentAmountTouched]);

  const client = clients.find((c) => c.id === clientId) ?? null;
  // «Чистка · Диагностика» — для RepeatReminderSheet (web serviceSummary).
  const serviceSummary = useMemo(
    () =>
      serviceIds
        .map((id) => catalog.get(id)?.name)
        .filter((n): n is string => Boolean(n))
        .join(" · "),
    [serviceIds, catalog],
  );
  // Web parity canSave: work needs a client + at least one service,
  // event needs a title — an empty €0 record must not save.
  const canSave =
    !!date &&
    (kind === "work"
      ? !!clientId && serviceIds.length > 0
      : comment.trim().length > 0) &&
    settlementAmountValid &&
    !createMut.isPending &&
    !updateMut.isPending;

  // Double-booking warn (web OverlapWarning parity): another record of the
  // same team on the same date whose half-open time range intersects the
  // draft's. Warning only — overlaps happen by accident in HVAC and the
  // dispatcher must SEE them, never be blocked from saving. Правила —
  // shared findOverlap: события (Обед, перерыв) с работами не пересекаются.
  const overlap = useMemo<Appointment | null>(
    () =>
      // findOverlap возвращает элемент allAppts — сужение до Appointment честно.
      findOverlap(
        {
          id: appointment?.id,
          date,
          time_start: timeStart,
          time_end: timeEnd,
          team_id: teamId,
          kind,
        },
        allAppts,
      ) as Appointment | null,
    [allAppts, appointment?.id, kind, teamId, date, timeStart, timeEnd],
  );
  const overlapWho = overlap
    ? overlap.client_id
      ? clients.find((c) => c.id === overlap.client_id)?.full_name || "Запись"
      : overlap.comment || "Запись"
    : null;

  // Буфер на дорогу/уборку: team.buffer_minutes ?? общий ?? 0 — тот же
  // резолв, что у сетки ((dashboard)/index.tsx). Предупреждаем ровно как о
  // накладке — видимо, но не блокируя. До этого буфер был только серой
  // полосой на сетке: доктайп обещал «новые записи не ставятся в буфер», а
  // поставить визит впритык ничто не мешало.
  const bufferMinutes =
    teams.find((x) => x.id === teamId)?.buffer_minutes ??
    calSettings?.bufferMinutes ??
    0;
  const tight = useMemo<Appointment | null>(
    () =>
      overlap
        ? null // о накладке уже сказано — два предупреждения об одном это шум
        : (findBufferClash(
            {
              id: appointment?.id,
              date,
              time_start: timeStart,
              time_end: timeEnd,
              team_id: teamId,
              kind,
            },
            allAppts,
            bufferMinutes,
          ) as Appointment | null),
    [
      overlap,
      allAppts,
      appointment?.id,
      kind,
      teamId,
      date,
      timeStart,
      timeEnd,
      bufferMinutes,
    ],
  );

  // Dirty draft for the close guard: create — any meaningful field beyond
  // the opening defaults (slot tap / «Записать сюда» prefills are not dirt);
  // edit — the draft differs from the stored record (web v619 field set,
  // extended with the fields this sheet edits).
  const dirty = useMemo(() => {
    if (!isEdit || !appointment) {
      return (
        clientId !== (defaults?.client_id ?? null) ||
        // Предвыбор услуг из ?new= — не грязь, как и предвыбранный клиент.
        JSON.stringify(serviceIds) !==
          JSON.stringify(defaults?.service_ids ?? []) ||
        comment.trim().length > 0 ||
        // Автоскидка лояльности (reason задан) — не грязь: она приезжает
        // сама при предвыбранном клиенте («Записать сюда»).
        (globalDiscount !== null && !discountReason) ||
        customTotal ||
        masterId !== null ||
        eventColor !== null ||
        eventNotes.trim().length > 0 ||
        eventUrl.trim().length > 0 ||
        eventReminderOffset !== null ||
        eventPushAt !== null ||
        status !== "scheduled" ||
        source !== null ||
        reminderOn ||
        cancelReason.trim().length > 0 ||
        addressNote.trim().length > 0 ||
        // Адрес с выбранным объектом — предзаполнение, не грязь; руками
        // набранный адрес клиента без объектов терять нельзя.
        (locationId === null && address.trim().length > 0) ||
        repeat.kind !== "none" ||
        payMethod !== null
      );
    }
    return (
      clientId !== appointment.client_id ||
      date !== appointment.date ||
      timeStart !== appointment.time_start ||
      timeEnd !== appointment.time_end ||
      teamId !== appointment.team_id ||
      masterId !== (appointment.master_id ?? null) ||
      status !== appointment.status ||
      source !== (appointment.source ?? null) ||
      reminderOn !== appointment.reminder_enabled ||
      comment.trim() !== (appointment.comment ?? "").trim() ||
      cancelReason.trim() !== (appointment.cancel_reason ?? "").trim() ||
      locationId !== (appointment.location_id ?? null) ||
      address.trim() !== (appointment.address ?? "").trim() ||
      addressNote.trim() !== (appointment.address_note ?? "").trim() ||
      eventColor !== (appointment.color_override ?? null) ||
      eventNotes.trim() !== (appointment.event_notes ?? "").trim() ||
      eventUrl.trim() !== (appointment.event_url ?? "").trim() ||
      eventPushAt !==
        (appointment.event_push_enabled ? appointment.event_push_at ?? null : null) ||
      eventReminderOffset !==
        (appointment.event_push_enabled && !appointment.event_push_at
          ? appointment.event_push_offsets?.[0] ?? null
          : null) ||
      allDay !== (appointment.event_all_day ?? false) ||
      JSON.stringify(repeat) !==
        JSON.stringify(appointment.event_repeat ?? { kind: "none" }) ||
      customTotal !== !!appointment.custom_total ||
      (customTotal && parseMoneyInput(total) !== (appointment.total_amount ?? 0)) ||
      svcSignature(selectedServices) !== svcSignature(appointment.services ?? []) ||
      JSON.stringify(globalDiscount) !==
        JSON.stringify(appointment.global_discount ?? null) ||
      payMethod !== null
    );
  }, [
    isEdit,
    appointment,
    defaults?.client_id,
    defaults?.service_ids,
    clientId,
    serviceIds,
    comment,
    globalDiscount,
    discountReason,
    customTotal,
    total,
    masterId,
    eventColor,
    eventNotes,
    eventUrl,
    eventReminderOffset,
    eventPushAt,
    allDay,
    repeat,
    payMethod,
    date,
    timeStart,
    timeEnd,
    teamId,
    status,
    source,
    reminderOn,
    cancelReason,
    locationId,
    address,
    addressNote,
    selectedServices,
  ]);

  const appointmentHasSettlement =
    !!appointment &&
    ((appointment.paid_amount ?? 0) > 0 ||
      (appointment.payments?.length ?? 0) > 0 ||
      appointment.payment != null ||
      appointment.payment_status === "partial" ||
      (appointment.payment_status === "paid" &&
        (appointment.prepaid_amount ?? 0) < (appointment.total_amount ?? 0)));
  const appointmentHasReceipt =
    !!appointment &&
    ((appointment.prepaid_amount ?? 0) > 0 || appointmentHasSettlement);
  const canAdjustPrepayment =
    !!appointment &&
    kind === "work" &&
    (currentRole === "owner" || currentRole === "dispatcher") &&
    !appointmentHasSettlement &&
    appointment.status !== "completed" &&
    appointment.status !== "cancelled" &&
    appointment.payment_status !== "refunded";
  const canResetPayment =
    !!appointment &&
    kind === "work" &&
    (currentRole === "owner" || currentRole === "dispatcher") &&
    appointmentHasReceipt &&
    appointment.status !== "cancelled" &&
    appointment.payment_status !== "refunded";
  const chooseStatus = (next: AppointmentStatus) => {
    if (
      appointment?.payment_status === "refunded" &&
      next !== appointment.status
    ) {
      Alert.alert(
        "Оплата уже возвращена",
        "Эта заявка закрыта в финансовой истории. Для новой работы создайте новую заявку.",
      );
      return;
    }
    setStatus(next);
    if (next !== "completed") {
      setPayMethod(null);
    setPayAccountId(null);
      setPaymentAmount("");
      setPaymentAmountTouched(false);
    }
  };
  const openPrepaymentEditor = () => {
    if (dirty) {
      Alert.alert(
        "Сначала сохраните заявку",
        "Предоплата пишется в финансовую историю. Сохраните изменения суммы и услуг, затем откройте предоплату.",
      );
      return;
    }
    setPrepaymentOpen(true);
  };
  const resetPayment = () => {
    if (!appointment || resetPaymentMut.isPending) return;
    if (dirty) {
      Alert.alert(
        "Сначала сохраните заявку",
        "В форме есть несохранённые изменения. Сохраните их перед отменой оплаты.",
      );
      return;
    }
    Alert.alert(
      "Отменить оплату?",
      appointment.status === "completed"
        ? "Все полученные суммы, включая предоплату и доплаты, вернутся на исходные счета. Заявка останется выполненной, долг появится снова, а связанный инвойс автоматически переоткроется."
        : "Все полученные суммы вернутся на исходные счета. Сама запись останется в календаре без оплаты, а связанный инвойс автоматически переоткроется.",
      [
        { text: "Не отменять", style: "cancel" },
        {
          text: "Отменить оплату",
          style: "destructive",
          onPress: () =>
            resetPaymentMut.mutate(appointment.id, {
              onSuccess: () => toast("Оплата отменена, долг восстановлен"),
              onError: (error) =>
                Alert.alert("Не удалось отменить оплату", error.message),
            }),
        },
      ],
    );
  };

  // «Весь день»: вкл — запоминаем время и растягиваем на сутки, выкл —
  // возвращаем прежний слот (web EventForm handleAllDay parity).
  const toggleAllDay = (v: boolean) => {
    if (v) {
      if (!allDay) preAllDayRef.current = { start: timeStart, end: timeEnd };
      setAllDay(true);
      setTimeStart("00:00");
      setTimeEnd("23:59");
    } else {
      setAllDay(false);
      setTimeStart(preAllDayRef.current?.start ?? "10:00");
      setTimeEnd(preAllDayRef.current?.end ?? "11:00");
    }
  };

  // Чип типа события — ПРЕСЕТ (веб-семантика): применяет цвет +
  // длительность/весь-день + название (пустое или равное метке другого
  // типа — заменяем; свой текст оператора не трогаем) и НЕ пишется в
  // запись. Повторный тап снимает выбранность, оставляя значения.
  const applyEventType = (et: PersonalEventType) => {
    if (eventTypeId === et.id) {
      setEventTypeId(null);
      return;
    }
    setEventTypeId(et.id);
    setEventColor(et.color);
    const cur = comment.trim();
    if (!cur || eventTypes.some((x) => x.label === cur)) setComment(et.label);
    if (et.allDay) {
      toggleAllDay(true);
    } else {
      // После «весь день» стартуем с 10:00 — 00:00 бессмысленно для обеда.
      const base = allDay || timeStart === "00:00" ? "10:00" : timeStart;
      setAllDay(false);
      setTimeStart(base);
      setTimeEnd(addMinutesHM(base, et.defaultDuration));
    }
  };

  // Повтор события: смена периодичности сохраняет до-дату (web
  // RepeatPickerRow parity); custom_weekdays здесь не предлагается.
  const repeatUntil = repeat.kind === "none" ? undefined : repeat.until;
  const setRepeatKind = (
    k: Exclude<PersonalEventRepeat["kind"], "custom_weekdays">,
  ) => {
    if (k === "none") setRepeat({ kind: "none" });
    else
      setRepeat({
        kind: k,
        ...(repeatUntil ? { until: repeatUntil } : {}),
      } as PersonalEventRepeat);
  };
  const setRepeatUntil = (next?: string) => {
    if (repeat.kind === "none") return;
    setRepeat({ ...repeat, until: next });
  };
  // Повторяющаяся запись: удаление/отмена бьют по ВСЕЙ серии — виртуальные
  // вхождения разворачиваются из seed (expandRepeat) и живут только с ним.
  const isRepeating =
    !!appointment?.event_repeat && appointment.event_repeat.kind !== "none";
  const hasRecordedPayment =
    !!appointment &&
    ((appointment.payment_status != null &&
      appointment.payment_status !== "unpaid") ||
      (appointment.prepaid_amount ?? 0) > 0 ||
      (appointment.paid_amount ?? 0) > 0 ||
      (appointment.payments?.length ?? 0) > 0 ||
      appointment.payment != null);

  const buildPatch = (): Partial<Appointment> => {
    const cancel =
      status === "cancelled" ? cancelReason.trim() || null : null;
    if (kind === "event") {
      // Personal/team event (meeting, lunch, break) — no client/services/
      // money. Тип события — пресет, в запись не пишется (веб-семантика).
      return {
        kind: "event",
        date,
        time_start: timeStart,
        time_end: timeEnd,
        event_all_day: allDay,
        event_repeat: repeat,
        event_notes: eventNotes.trim(),
        event_url: eventUrl.trim(),
        event_push_enabled:
          eventReminderOffset !== null || eventPushAt !== null,
        event_push_offsets:
          eventReminderOffset === null ? [] : [eventReminderOffset],
        event_push_at: eventPushAt,
        team_id: teamId,
        master_id: null,
        status,
        comment: comment.trim(),
        address: address.trim(),
        address_note: "",
        color_override: eventColor,
        client_id: null,
        location_id: null,
        service_ids: [],
        services: [],
        total_amount: 0,
        custom_total: false,
        global_discount: null,
        discount_amount: 0,
        cancel_reason: cancel,
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
      total_duration: computedDuration,
      comment: comment.trim(),
      status,
      source,
      reminder_enabled: reminderOn && Boolean(client?.phone),
      location_id: locationId,
      // Адрес денормализован из состояния секции «Адрес» (предзаполнен
      // объектом, правится руками) — web buildSavedWorkAppointment parity.
      address: address.trim(),
      address_note: addressNote.trim(),
      color_override: eventColor,
      global_discount: globalDiscount,
      discount_amount: globalDiscountAmount(selectedServices, globalDiscount),
      cancel_reason: cancel,
    };
    // «Выполнено» + выбран способ → фиксируем оплату остатка (web
    // buildCompletedAppointment parity). Патч строит общий
    // buildDebtPaidPatch — тот же, что зовёт тап «Оплачено» на визите в
    // карточке клиента: пять связанных полей пишутся из одного места.
    if (
      status === "completed" &&
      payMethod &&
      debt > 0 &&
      settlementAmountValid
    ) {
      const paymentPatch = buildDebtPaidPatch(appointment, {
        method: payMethod,
        amount: settlementAmount,
        remainingDebt: debt,
        accountId: payAccountId,
      });
      // A dispatcher can collect only part now and the remainder later,
      // potentially by another method. The cumulative mirrors stay in the
      // same patch; the server records only this transition's delta.
      Object.assign(patch, paymentPatch);
    } else if (
      status === "completed" &&
      appointment &&
      effectiveTotal > 0 &&
      alreadyPaid >= effectiveTotal &&
      appointment.payment_status !== "refunded"
    ) {
      // A fully prepaid (or previously partially paid) job has no remaining
      // tender to append. Still finalize its payment status together with the
      // work status so the server ledger and debt UI cannot disagree.
      patch.payment_status = "paid";
    }
    return patch;
  };

  const save = async () => {
    // Guard inverted range (belt-and-braces with the end-picker clamp).
    if (timeEnd <= timeStart) {
      Alert.alert("Ошибка", "Время окончания должно быть позже начала");
      return;
    }
    try {
      const patch = buildPatch();
      let saved: Appointment;
      if (isEdit && appointment) {
        await updateMut.mutateAsync({ id: appointment.id, patch });
        saved = { ...appointment, ...patch };
        if (
          kind === "work" &&
          (date !== appointment.date ||
            timeStart !== appointment.time_start ||
            timeEnd !== appointment.time_end ||
            status === "cancelled")
        ) {
          void cancelAppointmentReminders(appointment.id);
        }
      } else {
        saved = createBlankAppointment(patch);
        saved = await createMut.mutateAsync(saved);
      }
      const paidNow =
        kind === "work" &&
        status === "completed" &&
        payMethod &&
        debt > 0 &&
        settlementAmountValid;
      let message = paidNow
        ? `Оплата ${formatEUR(settlementAmount)} получена`
        : isEdit
          ? "Сохранено"
          : kind === "event"
            ? "Событие создано"
            : "Запись создана";
      let toastType: "success" | "info" = "success";
      if (kind === "event") {
        const reminderResult = await syncEventAppointmentReminders(
          saved,
          teams.find((candidate) => candidate.id === saved.team_id)?.timezone ??
            calSettings?.timezone ??
            "Europe/Nicosia",
        );
        if (reminderResult === "scheduled") {
          message = isEdit
            ? "Событие и напоминание сохранены"
            : "Событие создано с напоминанием";
        } else if (reminderResult === "deferred") {
          message =
            "Событие сохранено; напоминание стоит в очереди и установится, когда на iPhone освободится место";
          toastType = "info";
        } else if (reminderResult === "capacity") {
          message =
            "Событие сохранено, но очередь напоминаний переполнена";
          toastType = "info";
        } else if (reminderResult === "denied") {
          message = "Событие сохранено, но уведомления запрещены в Настройках";
          toastType = "info";
        } else if (reminderResult === "unavailable") {
          message = "Событие сохранено; напоминание появится после обновления приложения";
          toastType = "info";
        } else if (reminderResult === "past") {
          message = "Событие сохранено; время напоминания уже прошло";
          toastType = "info";
        }
      }
      toast(message, toastType);
      onClose();
    } catch (e) {
      Alert.alert("Ошибка", (e as Error).message);
    }
  };

  // Почему «Создать» серая — для тоста по тапу на disabled-кнопке и
  // пояснения в close-попапе без опции «Сохранить». Во время сохранения
  // кнопка тоже disabled — честная причина «уже сохраняем», а не ложное
  // «Добавьте услуги» на полностью заполненной форме.
  const missingHint =
    createMut.isPending || updateMut.isPending
      ? "Сохраняем…"
      : payMethod && !settlementAmountValid
        ? settlementAmount > debt
          ? `Сумма оплаты не может быть больше ${formatEUR(debt)}`
          : "Введите сумму оплаты не больше чем с двумя знаками после запятой"
      : kind === "work"
        ? !clientId && serviceIds.length === 0
          ? "Выберите клиента и услуги"
          : !clientId
            ? "Выберите клиента"
            : "Добавьте услуги"
        : "Введите название события";

  // Dirty-close guard (web v667, owner-locked): ✕ and the backdrop never
  // silently drop an edited draft — the operator decides explicitly.
  // «Сохранить» показываем только когда форма реально сохраняема —
  // молчаливо-мёртвая кнопка хуже её отсутствия.
  const requestClose = () => {
    if (!dirty) {
      onClose();
      return;
    }
    const buttons: AlertButton[] = [
      ...(canSave
        ? [{ text: "Сохранить", onPress: () => void save() }]
        : []),
      { text: "Не сохранять", style: "destructive" as const, onPress: onClose },
      { text: "Отмена", style: "cancel" as const },
    ];
    Alert.alert(
      "Сохранить изменения?",
      canSave
        ? "В форме есть несохранённые изменения."
        : `В форме есть несохранённые изменения. ${missingHint} — или закройте без сохранения.`,
      buttons,
    );
  };

  const remove = () => {
    if (!appointment) return;
    if (hasRecordedPayment) {
      Alert.alert(
        "Запись хранится в истории",
        "Запись с оплатой нельзя удалить. Отмените её или оформите возврат, чтобы финансовая история осталась корректной.",
      );
      return;
    }
    // Повторяющаяся запись хранится одной seed-строкой — удаление
    // стирает ВСЮ серию, и подтверждение обязано сказать это прямо.
    Alert.alert(
      isRepeating ? "Удалить серию?" : "Удалить запись?",
      isRepeating
        ? "Запись повторяется — удалится вся серия повторов. Действие необратимо."
        : "Действие необратимо.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: isRepeating ? "Удалить серию" : "Удалить",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMut.mutateAsync(appointment.id);
              void cancelAppointmentReminders(appointment.id);
              onClose();
            } catch (e) {
              Alert.alert("Ошибка", (e as Error).message);
            }
          },
        },
      ],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={requestClose}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <View className="flex-1 justify-end" style={{ backgroundColor: t.scrim }}>
        <Pressable className="flex-1" onPress={requestClose} accessible={false} />
        <View className="h-[88%] overflow-hidden rounded-t-3xl" style={{ backgroundColor: t.canvas }}>
          {/* header */}
          <View className="flex-row items-center border-b px-2 py-2" style={{ borderColor: t.separator, backgroundColor: t.surface }}>
            <Pressable
              onPress={requestClose}
              accessibilityRole="button"
              accessibilityLabel="Закрыть"
              className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
            >
              <X color={t.body} size={ICON.md} />
            </Pressable>
            <Text className="flex-1 text-center text-base font-semibold" style={{ color: t.ink }}>
              {kind === "event"
                ? isEdit
                  ? "Событие"
                  : "Новое событие"
                : isEdit
                  ? "Запись"
                  : "Новая запись"}
            </Text>
            <View className="w-11" />
          </View>

          <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
            {/* kind toggle — create only: kind is fixed for an existing
                record (flipping work→event would wipe client/services/total) */}
            {!isEdit ? (
              <SegmentedControl
                options={[
                  { value: "work", label: "Работа" },
                  { value: "event", label: "Событие" },
                ]}
                value={kind}
                onChange={(k) => {
                  setKind(k);
                  // «Личное» (team_id=null) валидно только для событий:
                  // возврат в «Работу» обязан вернуть команду, иначе
                  // запись сохранится невидимой на календарях всех бригад.
                  if (k === "work" && !teamId)
                    setTeamId(defaults?.team_id ?? lastTeamId ?? teams[0]?.id ?? null);
                }}
                style={{ marginHorizontal: 12, marginTop: 12 }}
              />
            ) : null}

            {kind === "work" ? (
              <>
            {/* client */}
            <SectionCard title="Клиент">
              <View className="flex-row items-stretch">
                <Pressable
                  onPress={() => setClientPicker(true)}
                  accessibilityRole="button"
                  accessibilityLabel={client ? `Изменить клиента: ${client.full_name || "Без имени"}` : "Выбрать клиента"}
                  className="min-h-[52px] flex-1 flex-row items-center py-3 pl-4 active:opacity-60"
                >
                  <View className="flex-1">
                    {client ? (
                      <>
                        <Text className="text-base font-semibold" style={{ color: t.ink }}>
                          {client.full_name || "Без имени"}
                        </Text>
                        {client.phone ? (
                          <Text className="text-sm" style={{ color: t.sub }}>
                            {client.phone}
                          </Text>
                        ) : null}
                      </>
                    ) : (
                      <Text className="text-base" style={{ color: t.accent }}>Выбрать клиента</Text>
                    )}
                  </View>
                  {client ? (
                    <Text className="mr-3 text-sm font-medium" style={{ color: t.accent }}>Изменить</Text>
                  ) : null}
                </Pressable>
                {client?.phone ? (
                  <Pressable
                    onPress={() =>
                      void Linking.openURL(
                        `tel:${client.phone!.replace(/[^+\d]/g, "")}`,
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Позвонить: ${client.phone}`}
                    className="mr-3 h-11 w-11 items-center justify-center self-center rounded-full active:opacity-70"
                    style={{ backgroundColor: `${t.accent}14` }}
                  >
                    <Phone color={t.accent} size={ICON.sm} />
                  </Pressable>
                ) : null}
              </View>
            </SectionCard>

            {/* object / location */}
            {client?.locations && client.locations.length > 0 ? (
              <SectionCard title="Объект">
                <ChipRow
                  items={client.locations.map((l) => ({
                    id: l.id,
                    label: l.label || "Объект",
                  }))}
                  selected={locationId}
                  onSelect={(id) => {
                    const next = id === locationId ? null : id;
                    setLocationId(next);
                    // Выбор объекта предзаполняет «Адрес» (label — фолбэк
                    // для link-only объекта); снятие набранное не стирает.
                    const loc = client.locations.find((l) => l.id === next);
                    if (loc) setAddress(locationAddressForBooking(loc));
                  }}
                />
              </SectionCard>
            ) : null}

            {/* address — бригада должна знать куда ехать даже у клиента
                без объектов (web: address + address_note в buildPatch) */}
            <SectionCard title="Адрес">
              <TextInput
                value={address}
                accessibilityLabel="Адрес"
                onChangeText={setAddress}
                placeholder="Улица, дом, город…"
                placeholderTextColor={t.placeholder}
                selectionColor={t.accent}
                keyboardAppearance="light"
                className="px-4 pt-3 pb-1.5 text-base"
                style={{ color: t.ink }}
              />
              <TextInput
                value={addressNote}
                accessibilityLabel="Детали адреса"
                onChangeText={setAddressNote}
                placeholder="Заметка: подъезд, код, этаж…"
                placeholderTextColor={t.placeholder}
                selectionColor={t.accent}
                keyboardAppearance="light"
                className="px-4 pb-3 text-sm"
                style={{ color: t.sub }}
              />
            </SectionCard>

              </>
            ) : null}

            {/* double-booking warn — visible, never blocks save (web
                OverlapWarning parity) */}
            {overlap ? (
              <View
                className="mx-3 mt-2 flex-row items-start gap-2 rounded-[14px] border px-3 py-2.5"
                style={{
                  backgroundColor: `${t.warning}14`,
                  borderColor: `${t.warning}33`,
                }}
              >
                <AlertTriangle color={t.warning} size={ICON.sm} />
                <Text className="flex-1 text-[13px] font-medium" style={{ color: t.warning }}>
                  Пересекается с {overlap.time_start}–{overlap.time_end} · {overlapWho}
                </Text>
              </View>
            ) : null}

            {/* буфер на дорогу/уборку — тот же язык, тише тоном: это не
                накладка, а «слишком впритык» */}
            {tight ? (
              <View
                className="mx-3 mt-2 flex-row items-start gap-2 rounded-[14px] px-3 py-2.5"
                style={{ backgroundColor: t.fill }}
              >
                <Clock color={t.sub} size={ICON.sm} />
                <Text className="flex-1 text-[13px]" style={{ color: t.sub }}>
                  Меньше {bufferMinutes} мин до записи {tight.time_start}–
                  {tight.time_end} — не останется времени на дорогу
                </Text>
              </View>
            ) : null}

            {/* date + time */}
            <SectionCard title="Когда">
              <View className="flex-row items-center justify-between px-4 py-2.5">
                <Text className="text-base" style={{ color: t.ink }}>Дата</Text>
                <DateTimePicker
                  themeVariant="light"
                  value={date ? parseYMD(date) : new Date()}
                  mode="date"
                  display="compact"
                  onChange={(_, d) => d && setDate(formatYMD(d))}
                />
              </View>
              {kind === "event" && allDay ? null : (
                <>
                  <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />
                  <View className="flex-row items-center justify-between px-4 py-2.5">
                    <Text className="text-base" style={{ color: t.ink }}>Время</Text>
                    <View className="flex-row items-center">
                      <DateTimePicker
                        themeVariant="light"
                        value={parseHM(timeStart)}
                        mode="time"
                        display="compact"
                        minuteInterval={5}
                        onChange={(_, d) => d && setTimeStart(formatHM(d))}
                      />
                      <Text className="px-1" style={{ color: t.faint }}>–</Text>
                      <DateTimePicker
                        themeVariant="light"
                        value={parseHM(timeEnd)}
                        mode="time"
                        display="compact"
                        minuteInterval={5}
                        onChange={(_, d) => {
                          if (!d) return;
                          const end = formatHM(d);
                          // End must be after start — clamp to start + 15 min.
                          setTimeEnd(end <= timeStart ? addMinutesHM(timeStart, 15) : end);
                          setDurationTouched(true);
                        }}
                      />
                    </View>
                  </View>
                </>
              )}
              {kind === "event" ? (
                <>
                  <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />
                  <View className="flex-row items-center justify-between px-4 py-2.5">
                    <Text className="text-base" style={{ color: t.ink }}>Весь день</Text>
                    <Switch
                      value={allDay}
                      onValueChange={toggleAllDay}
                      trackColor={{ true: t.accent }}
                      accessibilityLabel="Весь день"
                    />
                  </View>
                </>
              ) : null}
              {kind === "work" && isRepeating && appointment?.event_repeat ? (
                // Бейдж серии: у события повтор виден в секции «Повтор»,
                // работе достаточно строки — правило задаётся с веба.
                <View className="flex-row items-center gap-2 px-4 pb-3">
                  <Repeat color={t.sub} size={ICON.xs} />
                  <Text className="text-sm" style={{ color: t.sub }}>
                    Повторяется: {repeatLabel(appointment.event_repeat)}
                  </Text>
                </View>
              ) : null}
            </SectionCard>

            {kind === "work" ? (
              <>
            {/* services */}
            <SectionCard
              title="Услуги"
              action={{ label: "Изменить", onPress: () => setServicePicker(true) }}
            >
              {serviceIds.length === 0 ? (
                frequentServices.length > 0 ? (
                  // Частые услуги — добавление в 1 тап вместо трёх
                  // (открыть пикер → найти → выбрать). Длительность и
                  // сумма подтянутся из каталога автоматически.
                  <View className="flex-row flex-wrap gap-2 p-3">
                    {frequentServices.map((s) => (
                      <Chip
                        key={s.id}
                        label={s.name}
                        variant="outline"
                        color={t.accent}
                        accessibilityLabel={`Добавить услугу ${s.name}`}
                        onPress={() => setServiceIds((prev) => [...prev, s.id])}
                      />
                    ))}
                    <Chip
                      label="Все услуги…"
                      variant="outline"
                      onPress={() => setServicePicker(true)}
                    />
                  </View>
                ) : (
                  <Pressable
                    onPress={() => setServicePicker(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Добавить услуги"
                    className="px-4 py-3 active:opacity-60"
                  >
                    <Text className="text-base" style={{ color: t.accent }}>Добавить услуги</Text>
                  </Pressable>
                )
              ) : (
                serviceIds.map((id) => {
                  const s = catalog.get(id);
                  const ov = overrides[id] ?? {};
                  const countable = s?.is_countable !== false;
                  const qty = countable ? (ov.qty ?? 1) : 1;
                  // Effective price mirrors buildServices: operator override
                  // wins, otherwise the bulk ladder reprices per quantity.
                  const price = ov.price ?? (s ? unitPriceFor(s, qty) : 0);
                  const setOv = (p: ServiceOverride) =>
                    setOverrides((o) => ({ ...o, [id]: { ...o[id], ...p } }));
                  const removeService = () => {
                    setServiceIds((prev) => prev.filter((x) => x !== id));
                    setOverrides((o) => {
                      const rest = { ...o };
                      delete rest[id];
                      return rest;
                    });
                    setPriceDrafts((d) => {
                      const rest = { ...d };
                      delete rest[id];
                      return rest;
                    });
                  };
                  return (
                    <View
                      key={id}
                      className="flex-row items-center px-4 py-2.5"
                    >
                      <Text className="flex-1 pr-2 text-base tabular-nums" style={{ color: t.ink }} numberOfLines={1}>
                        {s?.name ?? "Услуга"}
                      </Text>
                      {countable ? (
                        <>
                          <Pressable
                            onPress={() => {
                              if (qty <= 1) removeService();
                              else setOv({ qty: qty - 1 });
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={
                              qty <= 1
                                ? `Убрать услугу ${s?.name ?? "Услуга"}`
                                : `Уменьшить количество: ${s?.name ?? "Услуга"}`
                            }
                            accessibilityValue={{ now: qty, min: 1 }}
                            className="h-11 w-11 items-center justify-center rounded-full active:opacity-70"
                            style={{ backgroundColor: t.fill }}
                          >
                            <ChevronDown color={t.body} size={13} />
                          </Pressable>
                          <Text className="w-6 text-center text-sm tabular-nums" style={{ color: t.sub }}>
                            {qty}
                          </Text>
                          <Pressable
                            onPress={() => setOv({ qty: qty + 1 })}
                            accessibilityRole="button"
                            accessibilityLabel={`Увеличить количество: ${s?.name ?? "Услуга"}`}
                            accessibilityValue={{ now: qty, min: 1 }}
                            className="h-11 w-11 items-center justify-center rounded-full active:opacity-70"
                            style={{ backgroundColor: t.fill }}
                          >
                            <ChevronUp color={t.body} size={13} />
                          </Pressable>
                        </>
                      ) : (
                        <Pressable
                          onPress={removeService}
                          accessibilityRole="button"
                          accessibilityLabel="Убрать услугу"
                          style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}
                        >
                          <Text style={{ fontSize: 13, fontWeight: "600", color: t.accent }}>
                            Убрать
                          </Text>
                        </Pressable>
                      )}
                      <TextInput
                        // Черновик строки, пока поле в фокусе: controlled
                        // String(price) съедал «12,» на каждом нажатии.
                        value={priceDrafts[id] ?? String(price)}
                        onChangeText={(v) => {
                          setPriceDrafts((d) => ({ ...d, [id]: v }));
                          setOv({ price: parseMoneyInput(v) });
                        }}
                        onEndEditing={() =>
                          setPriceDrafts((d) => {
                            const rest = { ...d };
                            delete rest[id];
                            return rest;
                          })
                        }
                        keyboardType="decimal-pad"
                        accessibilityLabel={`Стоимость услуги: ${s?.name ?? "Услуга"}`}
                        // textAlign задаём СТИЛЕМ, а не классом: у TextInput
                        // react-native-css объявляет nativeStyleMapping
                        // { textAlign: true } и делает path.split(".") — на
                        // `true` это падает красной ошибкой «path.split is not
                        // a function». Класс text-right роняет ЛЮБОЙ TextInput.
                        className="ml-2 min-h-11 w-14 text-sm tabular-nums"
                        style={{ color: t.sub, textAlign: "right" }}
                        placeholderTextColor={t.placeholder}
                        selectionColor={t.accent}
                        keyboardAppearance="light"
                      />
                      <Text className="text-sm" style={{ color: t.faint }}>€</Text>
                    </View>
                  );
                })
              )}
            </SectionCard>

              </>
            ) : null}

            {/* team / master */}
            {teams.length > 0 ? (
              <SectionCard title="Команда">
                <ChipRow
                  items={teams.map((t) => ({ id: t.id, label: t.name }))}
                  selected={teamId}
                  // Работа: radio без снятия — запись без team_id невидима
                  // на календарях бригад. Событие: повторный тап снимает
                  // команду → личное событие (web parity: team_id=null).
                  onSelect={(id) =>
                    setTeamId(kind === "event" && id === teamId ? null : id)
                  }
                />
                {kind === "event" && !teamId ? (
                  <Text className="px-4 pb-3 text-sm" style={{ color: t.sub }}>
                    Личное — не привязано к команде
                  </Text>
                ) : null}
              </SectionCard>
            ) : null}
            {kind === "work" && masters.length > 0 ? (
              <SectionCard title="Мастер">
                <ChipRow
                  items={masters.map((m) => ({ id: m.id, label: m.full_name }))}
                  selected={masterId}
                  onSelect={(id) => setMasterId(id === masterId ? null : id)}
                />
              </SectionCard>
            ) : null}

            {kind === "work" ? (
              <>
            {/* total */}
            <SectionCard title="Сумма">
              <View className="flex-row items-center px-4 py-2.5">
                  <TextInput
                    value={customTotal ? total : String(computedTotal)}
                    accessibilityLabel="Итоговая сумма"
                  onChangeText={(v) => {
                    setCustomTotal(true);
                    setTotal(v);
                  }}
                  keyboardType="decimal-pad"
                  className="flex-1 text-2xl font-bold"
                  style={{ color: t.ink }}
                  placeholder="0"
                  placeholderTextColor={t.placeholder}
                  selectionColor={t.accent}
                  keyboardAppearance="light"
                />
                <Text className="text-2xl font-bold" style={{ color: t.faint }}>€</Text>
                {customTotal ? (
                  <Pressable
                    onPress={() => setCustomTotal(false)}
                    accessibilityRole="button"
                    accessibilityLabel="Вернуть автоматическую сумму"
                    className="ml-3 min-h-11 min-w-11 items-center justify-center"
                  >
                    <Text className="text-sm font-medium" style={{ color: t.accent }}>Авто</Text>
                  </Pressable>
                ) : null}
              </View>
            </SectionCard>

            {/* discount */}
            <SectionCard title="Скидка">
              <View className="flex-row items-center gap-2 p-3">
                {(
                  [
                    { v: null, label: "Нет" },
                    { v: "fixed", label: "€" },
                    { v: "percent", label: "%" },
                  ] as const
                ).map((opt) => (
                  <Chip
                    key={opt.label}
                    label={opt.label}
                    radio
                    selected={discountType === opt.v}
                    onPress={() => {
                      setDiscountType(opt.v);
                      setDiscountReason(null);
                    }}
                  />
                ))}
                {discountType ? (
                      <TextInput
                        value={discountValue}
                        accessibilityLabel="Размер скидки"
                    onChangeText={(v) => {
                      setDiscountValue(v);
                      setDiscountReason(null);
                    }}
                    keyboardType="decimal-pad"
                    placeholder={discountType === "percent" ? "10" : "20"}
                    placeholderTextColor={t.placeholder}
                    selectionColor={t.accent}
                    keyboardAppearance="light"
                    className="ml-2 flex-1 text-base"
                    style={{ color: t.ink }}
                  />
                ) : null}
              </View>
              {globalDiscount ? (
                <Text className="px-4 pb-3 text-sm font-medium" style={{ color: t.success }}>
                  −{formatEUR(globalDiscountAmount(selectedServices, globalDiscount))}
                  {discountReason ? (
                    <Text style={{ color: t.sub }}>  ·  {discountReason} (лояльность)</Text>
                  ) : null}
                </Text>
              ) : null}
            </SectionCard>

            {(canAdjustPrepayment || canResetPayment) && appointment ? (
              <SectionCard title="Расчёты">
                {canAdjustPrepayment ? (
                  <ValueRow
                    label="Предоплата"
                    value={
                      appointment.prepaid_amount > 0
                        ? `${formatEUR(appointment.prepaid_amount)} · ${
                            appointment.payment_method
                              ? PAY_METHOD_LABELS[appointment.payment_method]
                              : "способ не указан"
                          }`
                        : "Не внесена"
                    }
                    muted={appointment.prepaid_amount <= 0}
                    onPress={openPrepaymentEditor}
                  />
                ) : null}
                {canResetPayment ? (
                  <ValueRow
                    label="Оплата"
                    value="Отменить оплату"
                    onPress={resetPayment}
                  />
                ) : null}
              </SectionCard>
            ) : null}

              </>
            ) : null}

            {/* event type chips (event only) — типы из кабинета */}
            {kind === "event" && eventTypes.length > 0 ? (
              <SectionCard title="Тип">
                <View className="flex-row flex-wrap gap-2 p-3">
                  {eventTypes.map((et) => (
                    <Chip
                      key={et.id}
                      label={et.label}
                      radio
                      color={et.color}
                      selected={eventTypeId === et.id}
                      onPress={() => applyEventType(et)}
                    />
                  ))}
                </View>
              </SectionCard>
            ) : null}

            {kind === "event" ? (
              <SectionCard title="Подробности">
              <TextInput
                value={eventNotes}
                accessibilityLabel="Заметка к событию"
                  onChangeText={setEventNotes}
                  placeholder="Заметка"
                  placeholderTextColor={t.placeholder}
                  selectionColor={t.accent}
                  keyboardAppearance="light"
                  multiline
                  className="min-h-[64px] px-4 py-3 text-base"
                  style={{ color: t.ink, textAlignVertical: "top" }}
                />
                <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />
              <TextInput
                value={address}
                accessibilityLabel="Место или адрес события"
                  onChangeText={setAddress}
                  placeholder="Место или адрес"
                  placeholderTextColor={t.placeholder}
                  selectionColor={t.accent}
                  keyboardAppearance="light"
                  className="min-h-12 px-4 py-3 text-base"
                  style={{ color: t.ink }}
                />
                <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />
              <TextInput
                value={eventUrl}
                accessibilityLabel="Ссылка события"
                  onChangeText={setEventUrl}
                  placeholder="Ссылка"
                  placeholderTextColor={t.placeholder}
                  selectionColor={t.accent}
                  keyboardAppearance="light"
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="min-h-12 px-4 py-3 text-base"
                  style={{ color: t.ink }}
                />
              </SectionCard>
            ) : null}

            {kind === "event" ? (
              <SectionCard title="Напоминание">
                <View className="flex-row flex-wrap gap-2 p-3">
                  {EVENT_REMINDER_OPTIONS.map((option) => (
                    <Chip
                      key={option.label}
                      label={option.label}
                      radio
                      selected={
                        eventPushAt === null &&
                        eventReminderOffset === option.value
                      }
                      onPress={() => {
                        setEventPushAt(null);
                        setEventReminderOffset(option.value);
                      }}
                    />
                  ))}
                </View>
                {eventPushAt ? (
                  <View
                    className="flex-row items-center px-4 pb-3"
                    style={{ gap: 12 }}
                  >
                    <Text className="flex-1 text-sm" style={{ color: t.sub }}>
                      Точное время: {new Date(eventPushAt).toLocaleString("ru-RU")}
                    </Text>
                    <Pressable
                      onPress={() => setEventPushAt(null)}
                      accessibilityRole="button"
                      accessibilityLabel="Убрать точное время напоминания"
                      style={{ minHeight: 44, justifyContent: "center" }}
                    >
                      <Text className="text-sm font-semibold" style={{ color: t.accent }}>
                        Убрать
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
                {repeat.kind !== "none" && eventReminderOffset !== null ? (
                  <Text className="px-4 pb-3 text-sm" style={{ color: t.sub }}>
                    Напоминание будет повторяться вместе с событием
                  </Text>
                ) : null}
              </SectionCard>
            ) : null}

            {/* event color (event only) */}
            {kind === "event" ? (
              <SectionCard title="Цвет">
                <View className="flex-row flex-wrap gap-3 p-3">
                  {(
                    [
                      ["#4338ca", "Индиго"],
                      ["#10b981", "Зелёный"],
                      ["#ef4444", "Красный"],
                      ["#f59e0b", "Оранжевый"],
                      ["#06b6d4", "Голубой"],
                      ["#a855f7", "Фиолетовый"],
                      ["#ec4899", "Розовый"],
                      ["#737373", "Серый"],
                    ] as const
                  ).map(([c, name]) => (
                    <Pressable
                      key={c}
                      onPress={() => setEventColor(c)}
                      accessibilityRole="button"
                      accessibilityLabel={name}
                      accessibilityState={{ selected: eventColor === c }}
                      className="h-11 w-11 rounded-full"
                      style={[
                        { backgroundColor: c },
                        eventColor === c ? { borderWidth: 2, borderColor: t.ink } : null,
                      ]}
                    />
                  ))}
                </View>
              </SectionCard>
            ) : null}

            {/* repeat (event only) — правило повтора, web RepeatPickerRow */}
            {kind === "event" ? (
              <SectionCard title="Повтор">
                <View className="flex-row flex-wrap gap-2 p-3">
                  {REPEAT_OPTIONS.map((opt) => (
                    <Chip
                      key={opt.value}
                      label={opt.label}
                      radio
                      selected={repeat.kind === opt.value}
                      onPress={() => setRepeatKind(opt.value)}
                    />
                  ))}
                </View>
                {repeat.kind !== "none" ? (
                  <View className="flex-row items-center justify-between px-4 pb-3">
                    <Text className="text-base" style={{ color: t.ink }}>
                      Завершить
                    </Text>
                    {repeatUntil ? (
                      <View className="flex-row items-center gap-3">
                        <DateTimePicker
                          themeVariant="light"
                          value={parseYMD(repeatUntil)}
                          mode="date"
                          display="compact"
                          onChange={(_, d) => d && setRepeatUntil(formatYMD(d))}
                        />
                        <Pressable
                          onPress={() => setRepeatUntil(undefined)}
                          accessibilityRole="button"
                          accessibilityLabel="Снять дату завершения"
                          className="min-h-11 min-w-11 items-center justify-center px-2"
                        >
                          <Text className="text-sm font-medium" style={{ color: t.accent }}>
                            Снять
                          </Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => setRepeatUntil(date)}
                        accessibilityRole="button"
                        accessibilityLabel="Повторять до даты"
                        className="min-h-11 justify-center px-2"
                      >
                        <Text className="text-base" style={{ color: t.accent }}>
                          До даты…
                        </Text>
                      </Pressable>
                    )}
                  </View>
                ) : null}
              </SectionCard>
            ) : null}

            {/* status — только для работ: у веб-EventForm статуса нет */}
            {kind === "work" ? (
            <SectionCard title="Статус">
              <View className="flex-row flex-wrap gap-2 p-3">
                {STATUSES.map((s) => (
                  <Chip
                    key={s.value}
                    label={s.label}
                    radio
                    selected={status === s.value}
                    onPress={() => {
                      // Отмена серии гасит ВСЕ развёрнутые вхождения —
                      // молча делать это нельзя.
                      if (
                        s.value === "cancelled" &&
                        isRepeating &&
                        status !== "cancelled"
                      ) {
                        Alert.alert(
                          "Отменить серию?",
                          "Запись повторяется — статус «Отменено» скроет с календаря всю серию повторов.",
                          [
                            { text: "Отмена", style: "cancel" },
                            {
                              text: "Отменить серию",
                              style: "destructive",
                              onPress: () => chooseStatus("cancelled"),
                            },
                          ],
                        );
                        return;
                      }
                      chooseStatus(s.value);
                    }}
                  />
                ))}
              </View>
            </SectionCard>
            ) : null}

            {kind === "work" ? (
              <SectionCard>
                <ValueRow
                  label="Источник заявки"
                  value={source ? APPOINTMENT_SOURCE_LABELS[source] : "Не указан"}
                  muted={!source}
                  onPress={() => setSourceSheetOpen(true)}
                />
                <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />
                <View
                  className="flex-row items-center justify-between px-4 py-2.5"
                  style={{ minHeight: 52 }}
                >
                  <View className="flex-1 pr-3">
                    <Text className="text-base" style={{ color: t.ink }}>
                      SMS-напоминание клиенту
                    </Text>
                    <Text className="mt-0.5 text-[13px]" style={{ color: t.sub }}>
                      {client?.phone
                        ? "По расписанию SMS компании"
                        : "Сначала добавьте телефон клиента"}
                    </Text>
                  </View>
                  <Switch
                    value={reminderOn}
                    onValueChange={setReminderOn}
                    disabled={!client?.phone && !reminderOn}
                    trackColor={{ true: t.accent }}
                    accessibilityLabel="SMS-напоминание клиенту"
                    accessibilityState={{ disabled: !client?.phone && !reminderOn }}
                  />
                </View>
              </SectionCard>
            ) : null}

            {/* payment — появляется сразу после «Выполнено», чтобы цепочка
                «завершил → получил деньги» не требовала отдельного экрана.
                «Позже» = сохранить с долгом (клиент останется в «Должниках»). */}
            {kind === "work" && appointment?.payment_status === "refunded" ? (
              <SectionCard title="Оплата">
                <View className="flex-row items-center gap-2 px-4 py-3">
                  <AlertTriangle color={t.danger} size={ICON.sm} />
                  <View className="flex-1">
                    <Text className="text-base font-semibold" style={{ color: t.danger }}>
                      Оплата возвращена
                    </Text>
                    <Text className="mt-0.5 text-sm" style={{ color: t.sub }}>
                      Денег к зачёту и долга по этой заявке нет
                    </Text>
                  </View>
                </View>
              </SectionCard>
            ) : kind === "work" && status === "completed" ? (
              debt > 0 ? (
                <SectionCard title={`Оплата · ${formatEUR(debt)}`}>
                  {/* КУДА ПОЛОЖИЛИ ДЕНЬГИ, А НЕ «КАКИМ СПОСОБОМ».
                      Раньше здесь стояли четыре абстрактных способа, а счёт
                      сервер УГАДЫВАЛ — первый активный счёт нужного вида у
                      команды. Не нашлось (нет карточного счёта, нет счёта
                      «другое», общий счёт не подключён к этой команде) —
                      приём денег ПАДАЛ, и бригадир не мог закрыть долг.
                      Теперь тапают конкретную кассу: промахнуться она не
                      может, а способ оплаты выводится из её вида.
                      Счетов у команды нет вовсе → откат на прежние четыре
                      способа: приём денег не блокируем никогда. */}
                  <View className="flex-row flex-wrap gap-2 p-3">
                    {[
                      ...(payAccounts.length > 0
                        ? payAccounts.map((acc) => ({
                            key: acc.id,
                            label: acc.name,
                            accountId: acc.id as string | null,
                            method: paymentMethodForAccountKind(acc.kind) as
                              | PayMethod
                              | null,
                          }))
                        : (["cash", "card", "transfer", "other"] as const).map(
                            (value) => ({
                              key: value as string,
                              label: PAY_METHOD_LABELS[value],
                              accountId: null as string | null,
                              method: value as PayMethod | null,
                            }),
                          )),
                      {
                        key: "later",
                        label: "Позже",
                        accountId: null as string | null,
                        method: null as PayMethod | null,
                      },
                    ].map((opt) => (
                      <Chip
                        key={opt.key}
                        label={opt.label}
                        radio
                        color={opt.method ? t.success : undefined}
                        selected={
                          opt.method === null
                            ? payMethod === null
                            : opt.accountId
                              ? payAccountId === opt.accountId
                              : payAccountId === null &&
                                payMethod === opt.method
                        }
                        onPress={() => {
                          const startingPayment = payMethod === null;
                          setPayMethod(opt.method);
                          setPayAccountId(opt.accountId);
                          if (opt.method === null) {
                            setPaymentAmount("");
                            setPaymentAmountTouched(false);
                          } else if (startingPayment) {
                            setPaymentAmount(moneyDraft(debt));
                            setPaymentAmountTouched(false);
                          }
                        }}
                      />
                    ))}
                  </View>
                  {payMethod ? (
                    <View className="px-3 pb-3">
                      <Text className="mb-1 text-sm font-medium" style={{ color: t.sub }}>
                        Сумма сейчас
                      </Text>
                      <View
                        className="flex-row items-center rounded-2xl border px-4"
                        style={{
                          borderColor: settlementAmountValid
                            ? t.separator
                            : t.danger,
                          backgroundColor: t.canvas,
                        }}
                      >
                        <TextInput
                          value={paymentAmount}
                          onChangeText={(value) => {
                            setPaymentAmount(value);
                            setPaymentAmountTouched(true);
                          }}
                          keyboardType="decimal-pad"
                          placeholder="0"
                          placeholderTextColor={t.placeholder}
                          selectionColor={t.accent}
                          keyboardAppearance="light"
                          accessibilityLabel="Сумма оплаты сейчас"
                          className="flex-1 py-3 text-xl font-semibold tabular-nums"
                          style={{ color: t.ink }}
                        />
                        <Text className="text-xl font-semibold" style={{ color: t.faint }}>
                          €
                        </Text>
                      </View>
                      <Text
                        className="mt-2 text-sm"
                        style={{ color: settlementAmountValid ? t.success : t.danger }}
                      >
                        {settlementAmountValid
                          ? settlementAmount < debt
                            ? `Будет принято ${formatEUR(settlementAmount)} · останется ${formatEUR(debt - settlementAmount)}`
                            : `Будет полностью оплачено ${formatEUR(debt)}`
                          : settlementAmount > debt
                            ? `Не больше ${formatEUR(debt)}`
                            : "Введите корректную сумму"}
                      </Text>
                    </View>
                  ) : (
                    <Text className="px-4 pb-3 text-sm" style={{ color: t.sub }}>
                      «Позже» — долг останется в списке должников
                    </Text>
                  )}
                </SectionCard>
              ) : effectiveTotal > 0 ? (
                <SectionCard title="Оплата">
                  <View className="flex-row items-center gap-2 px-4 py-3">
                    <Check color={t.success} size={ICON.sm} />
                    <Text className="text-base font-medium" style={{ color: t.success }}>
                      Оплачено · {formatEUR(alreadyPaid)}
                    </Text>
                  </View>
                  {/* КУДА ЛЕГЛИ ДЕНЬГИ — по строке на каждое поступление.
                      Спрашиваем у САМОГО платежа, а не у колонки записи:
                      аванс мог уйти на карту, а остаток — в наличку, и одна
                      колонка такую пару рассказать не может. */}
                  {paidRows.length > 0 ? (
                    <View className="gap-1 px-4 pb-3">
                      {paidRows.map((row) => (
                        <Text
                          key={row.key}
                          className="text-[13px]"
                          style={{ color: t.sub }}
                        >
                          {row.text}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </SectionCard>
              ) : null
            ) : null}

            {/* cancel reason — статусная механика работ (у событий её нет) */}
            {kind === "work" && status === "cancelled" ? (
              <SectionCard title="Причина отмены">
                <View className="flex-row flex-wrap gap-2 p-3">
                  {CANCEL_REASONS.map((r) => (
                    <Chip
                      key={r}
                      label={r}
                      color={t.danger}
                      selected={cancelReason === r}
                      onPress={() => setCancelReason(cancelReason === r ? "" : r)}
                    />
                  ))}
                </View>
              <TextInput
                value={cancelReason}
                accessibilityLabel="Причина отмены"
                  onChangeText={setCancelReason}
                  placeholder="Своя причина…"
                  placeholderTextColor={t.placeholder}
                  selectionColor={t.accent}
                  keyboardAppearance="light"
                  className="px-4 pb-3 text-base"
                  style={{ color: t.ink }}
                />
              </SectionCard>
            ) : null}

            {/* comment / event title */}
            <SectionCard title={kind === "event" ? "Название" : "Комментарий"}>
              <TextInput
                value={comment}
                accessibilityLabel={kind === "event" ? "Название события" : "Заметка для бригады"}
                onChangeText={setComment}
                multiline
                placeholder={kind === "event" ? "Обед, встреча, перерыв…" : "Заметка для бригады…"}
                placeholderTextColor={t.placeholder}
                selectionColor={t.accent}
                keyboardAppearance="light"
                className="min-h-[64px] px-4 py-3 text-base"
                style={{ color: t.ink }}
                textAlignVertical="top"
              />
            </SectionCard>

            {isEdit && kind === "work" && appointment ? (
              <AppointmentPhotos
                appointmentId={appointment.id}
                clientId={appointment.client_id}
                locationId={appointment.location_id}
                consentGiven={appointment.consent_given}
                canUpload={status !== "cancelled"}
                canDelete
              />
            ) : null}

            {/* «Повторить через…» — посев recurring-напоминания из
                ЗАВЕРШЁННОЙ записи (web: ClientActionMenu → RepeatReminderSheet;
                инбокс возвратов — экран «Повторяющиеся ТО»). */}
            {isEdit && kind === "work" && status === "completed" && client ? (
              <Pressable
                onPress={() => setRepeatOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Повторить через…"
                className="mt-4 flex-row items-center justify-center gap-2 py-3 active:opacity-70"
                style={{ minHeight: 44 }}
              >
                <Repeat color={t.accent} size={ICON.xs} />
                <Text className="text-base font-medium" style={{ color: t.accent }}>
                  Повторить через…
                </Text>
              </Pressable>
            ) : null}

            {isEdit ? (
              hasRecordedPayment ? (
                <Text
                  accessibilityRole="text"
                  className="px-6 py-5 text-center text-sm leading-5"
                  style={{ color: t.faint }}
                >
                  Запись с оплатой хранится в истории — отмените её или оформите возврат.
                </Text>
              ) : (
                <Pressable
                  onPress={remove}
                  accessibilityRole="button"
                  accessibilityLabel={isRepeating ? "Удалить серию" : "Удалить запись"}
                  className="min-h-11 items-center justify-center py-5 active:opacity-70"
                >
                  <Text className="text-base font-medium" style={{ color: t.danger }}>
                    {isRepeating ? "Удалить серию" : "Удалить запись"}
                  </Text>
                </Pressable>
              )
            ) : (
              <View className="h-6" />
            )}
          </ScrollView>

          {/* sticky footer */}
          <View className="border-t px-4 pb-7 pt-3" style={{ borderColor: t.separator, backgroundColor: t.surface }}>
            {/* Серая кнопка обязана объяснять почему: pointerEvents="none"
                пропускает тап disabled-кнопки на обёртку → тост-подсказка. */}
            <Pressable
              onPress={canSave ? undefined : () => toast(missingHint, "info")}
              accessibilityRole={canSave ? undefined : "button"}
              accessibilityLabel={canSave ? undefined : missingHint}
            >
              <View pointerEvents={canSave ? "auto" : "none"}>
                <Button
                  label={
                    kind === "event"
                      ? isEdit
                        ? "Сохранить"
                        : "Создать событие"
                      : isEdit
                        ? `Сохранить · ${formatEUR(effectiveTotal)}`
                        : `Создать · ${formatEUR(effectiveTotal)}`
                  }
                  onPress={save}
                  disabled={!canSave}
                  loading={createMut.isPending || updateMut.isPending}
                />
              </View>
            </Pressable>
          </View>
        </View>
      </View>

      {/* client picker */}
      <ClientPickerModal
        visible={clientPicker}
        onClose={() => setClientPicker(false)}
        clients={clients}
        recentIds={recentClientIds}
        selectedId={clientId}
        onPick={(id) => {
          setClientId(id);
          // Web parity onClientSelect: switch to the NEW client's primary
          // object so the previous client's location_id never leaks.
          // Адрес следует за объектом (или чистится — адрес прошлого
          // клиента в записи хуже пустого).
          const locs = clients.find((c) => c.id === id)?.locations ?? [];
          const loc = locs.find((l) => l.isPrimary) ?? locs[0];
          setLocationId(loc?.id ?? null);
          setAddress(loc ? locationAddressForBooking(loc) : "");
          setClientPicker(false);
        }}
        onCreate={async (name, phone) => {
          const created = await createClient.mutateAsync({
            full_name: name,
            phone,
          });
          return created.id;
        }}
      />

      {/* «Повторить через…» — интервалы ТО; onConfirm сеет напоминание в
          инбокс «Повторяющиеся ТО» (web AppointmentSheet.onRepeatConfirm). */}
      {client ? (
        <RepeatReminderSheet
          visible={repeatOpen}
          clientName={client.full_name || "Без имени"}
          serviceSummary={serviceSummary}
          lastDate={date}
          busy={createReminder.isPending}
          onClose={() => setRepeatOpen(false)}
          onConfirm={(months, note) =>
            createReminder.mutate(
              {
                client_id: client.id,
                client_name: client.full_name,
                phone: client.phone ?? "",
                team_id: teamId,
                service_ids: serviceIds,
                service_summary: serviceSummary,
                last_date: date,
                interval_months: months,
                note,
              },
              {
                onSuccess: () => toast("Напоминание создано"),
                onError: (e) => Alert.alert("Ошибка", e.message),
              },
            )
          }
        />
      ) : null}

      {/* service picker (multi) */}
      <PickerModal
        visible={servicePicker}
        onClose={() => setServicePicker(false)}
        title="Услуги"
        multi
        items={services.map((s) => ({
          id: s.id,
          title: s.name,
          subtitle: `${formatEUR(Number(s.price))} · ${s.duration_minutes} мин`,
        }))}
        selectedIds={serviceIds}
        onToggle={(id) =>
          setServiceIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
          )
        }
        // Пустой каталог = тупик первой записи: белый лист и серая
        // «Создать» молча. CTA создаёт услугу и сразу выбирает её.
        empty={
          services.length === 0 ? (
            <InlineServiceCreate
              onCreated={(id) => setServiceIds((prev) => [...prev, id])}
            />
          ) : undefined
        }
      />
      <OptionSheet
        visible={sourceSheetOpen}
        title="Источник заявки"
        options={SOURCE_OPTIONS}
        value={source ?? ""}
        onPick={(value) => setSource(value || null)}
        onClose={() => setSourceSheetOpen(false)}
      />
      {appointment ? (
        <PrepaymentEditor
          visible={prepaymentOpen}
          currentAmount={appointment.prepaid_amount ?? 0}
          currentMethod={
            (appointment.payment_method as PayMethod | undefined) ?? null
          }
          maximum={appointment.total_amount ?? 0}
          busy={prepaymentMut.isPending}
          onClose={() => setPrepaymentOpen(false)}
          onSubmit={async (amount, method) => {
            const previous = appointment.prepaid_amount ?? 0;
            await prepaymentMut.mutateAsync({
              appointmentId: appointment.id,
              amount,
              paymentMethod: method,
            });
            setPrepaymentOpen(false);
            toast(
              amount < previous
                ? "Возврат предоплаты оформлен"
                : amount > previous
                  ? "Предоплата принята"
                  : "Способ предоплаты изменён",
            );
          }}
        />
      ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PrepaymentEditor({
  visible,
  currentAmount,
  currentMethod,
  maximum,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  currentAmount: number;
  currentMethod: PayMethod | null;
  maximum: number;
  busy: boolean;
  onClose: () => void;
  onSubmit: (amount: number, method: PayMethod | null) => Promise<void>;
}) {
  const t = useThemeColors();
  const [amount, setAmount] = useState(String(currentAmount));
  const [method, setMethod] = useState<PayMethod | null>(currentMethod ?? "cash");

  useEffect(() => {
    if (!visible) return;
    setAmount(String(currentAmount));
    setMethod(currentMethod ?? "cash");
  }, [visible, currentAmount, currentMethod]);

  const normalized = amount.trim().replace(",", ".");
  const amountNumber = Number(normalized);
  const amountShapeValid = /^\d+(?:\.\d{0,2})?$/.test(normalized);
  const amountValid =
    amountShapeValid &&
    Number.isFinite(amountNumber) &&
    amountNumber >= 0 &&
    amountNumber <= maximum;
  const canSubmit = amountValid && (amountNumber === 0 || method !== null) && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      await onSubmit(amountNumber, amountNumber > 0 ? method : null);
    } catch (e) {
      Alert.alert(
        "Не удалось изменить предоплату",
        (e as Error).message,
      );
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-1 justify-end" style={{ backgroundColor: t.scrim }}>
          <Pressable className="flex-1" onPress={onClose} accessible={false} />
          <View
            className="rounded-t-3xl px-5 pb-8 pt-3"
            style={{ backgroundColor: t.surface }}
          >
            <View className="mb-4 flex-row items-center">
              <Text className="flex-1 text-lg font-bold" style={{ color: t.ink }}>
                Предоплата
              </Text>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Закрыть"
                className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
              >
                <X color={t.body} size={ICON.md} />
              </Pressable>
            </View>

            <Text className="mb-1 text-sm font-medium" style={{ color: t.sub }}>
              Сумма до {formatEUR(maximum)}
            </Text>
            <View
              className="mb-4 flex-row items-center rounded-2xl border px-4"
              style={{ borderColor: t.separator, backgroundColor: t.canvas }}
            >
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                autoFocus
                placeholder="0"
                placeholderTextColor={t.placeholder}
                selectionColor={t.accent}
                keyboardAppearance="light"
                accessibilityLabel="Сумма предоплаты"
                className="flex-1 py-3 text-xl font-semibold tabular-nums"
                style={{ color: t.ink }}
              />
              <Text className="text-xl font-semibold" style={{ color: t.faint }}>€</Text>
            </View>

            {amountNumber > 0 ? (
              <>
                <Text className="mb-2 text-sm font-medium" style={{ color: t.sub }}>
                  Способ
                </Text>
                <View className="mb-4 flex-row flex-wrap gap-2">
                  {(Object.keys(PAY_METHOD_LABELS) as PayMethod[]).map((value) => (
                    <Chip
                      key={value}
                      label={PAY_METHOD_LABELS[value]}
                      radio
                      selected={method === value}
                      onPress={() => setMethod(value)}
                    />
                  ))}
                </View>
              </>
            ) : null}

            <Text className="mb-4 text-sm leading-5" style={{ color: t.sub }}>
              {amountNumber < currentAmount
                ? "Уменьшение оформит возврат на исходный счёт. История платежей сохранится."
                : "Деньги появятся на счёте команды сразу после сохранения."}
            </Text>
            {!amountValid && amount.trim() ? (
              <Text className="mb-3 text-sm" style={{ color: t.danger }}>
                Укажите сумму от 0 до {formatEUR(maximum)}, не больше двух знаков после запятой.
              </Text>
            ) : null}
            <Button
              label={
                currentAmount > 0
                  ? "Сохранить"
                  : "Принять предоплату"
              }
              onPress={submit}
              disabled={!canSubmit}
              loading={busy}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Пустой каталог услуг — тупик первой записи: минимальная inline-форма
// (название + цена, час по умолчанию) прямо в пикере. Созданная услуга
// сразу выбирается в запись; каталог доредактируют в кабинете.
function InlineServiceCreate({
  onCreated,
}: {
  onCreated: (id: string) => void;
}) {
  const t = useThemeColors();
  const createService = useCreateService();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");

  const submit = async () => {
    if (!name.trim()) return;
    try {
      const svc = await createService.mutateAsync({
        name: name.trim(),
        price: parseMoneyInput(price),
        duration_minutes: 60,
      });
      onCreated(svc.id);
    } catch (e) {
      Alert.alert("Не удалось создать услугу", (e as Error).message);
    }
  };

  return (
    <View className="px-5 pt-4">
      <Text className="mb-3 text-sm" style={{ color: t.sub }}>
        Каталог пуст — создайте первую услугу, она сразу добавится в запись.
      </Text>
          <TextInput
            value={name}
            accessibilityLabel="Название услуги"
        onChangeText={setName}
        placeholder="Название услуги"
        placeholderTextColor={t.placeholder}
        selectionColor={t.accent}
        keyboardAppearance="light"
        autoFocus
        className="mb-2 rounded-[14px] border px-4 py-3 text-base"
        style={{ borderColor: t.separator, color: t.ink }}
      />
          <TextInput
            value={price}
            accessibilityLabel="Цена услуги"
        onChangeText={setPrice}
        placeholder="Цена, €"
        placeholderTextColor={t.placeholder}
        selectionColor={t.accent}
        keyboardType="decimal-pad"
        keyboardAppearance="light"
        className="mb-4 rounded-[14px] border px-4 py-3 text-base"
        style={{ borderColor: t.separator, color: t.ink }}
      />
      <Button
        label="Создать услугу"
        onPress={() => void submit()}
        disabled={!name.trim() || createService.isPending}
        loading={createService.isPending}
      />
    </View>
  );
}

function ChipRow({
  items,
  selected,
  onSelect,
}: {
  items: { id: string; label: string }[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}
    >
      {items.map((it) => (
        <Chip
          key={it.id}
          label={it.label}
          radio
          selected={selected === it.id}
          onPress={() => onSelect(it.id)}
        />
      ))}
    </ScrollView>
  );
}

type PickerItem = { id: string; title: string; subtitle?: string };

function PickerModal({
  visible,
  onClose,
  title,
  items,
  selectedIds,
  multi,
  onPick,
  onToggle,
  createLabel,
  onCreateNew,
  empty,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  items: PickerItem[];
  selectedIds: string[];
  multi?: boolean;
  onPick?: (id: string) => void;
  onToggle?: (id: string) => void;
  createLabel?: string;
  onCreateNew?: (query: string) => void;
  /** Показывается вместо пустого списка (CTA первого запуска). */
  empty?: ReactElement;
}) {
  const th = useThemeColors();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(t) ||
        (i.subtitle ?? "").toLowerCase().includes(t),
    );
  }, [q, items]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <View className="flex-1 justify-end" style={{ backgroundColor: th.scrim }}>
        <Pressable className="flex-1" onPress={onClose} accessible={false} />
        <View className="h-[80%] overflow-hidden rounded-t-3xl" style={{ backgroundColor: th.surface }}>
          <View className="flex-row items-center border-b px-2 py-2" style={{ borderColor: th.separator }}>
            <Text className="flex-1 px-2 text-base font-semibold" style={{ color: th.ink }}>
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={multi ? "Готово" : "Закрыть"}
              className={`h-11 items-center justify-center rounded-full active:opacity-60 ${multi ? "px-3" : "w-11"}`}
            >
              {multi ? (
                <Text className="text-sm font-semibold" style={{ color: th.accent }}>Готово</Text>
              ) : (
                <X color={th.body} size={ICON.md} />
              )}
            </Pressable>
          </View>
          <View className="flex-row items-center gap-2 px-4 py-2">
            <Search color={th.faint} size={ICON.sm} />
            <TextInput
              value={q}
              accessibilityLabel="Поиск услуги"
              onChangeText={setQ}
              placeholder="Поиск…"
              placeholderTextColor={th.placeholder}
              selectionColor={th.accent}
              keyboardAppearance="light"
              className="flex-1 py-1 text-base"
              style={{ color: th.ink }}
            />
          </View>
          <FlatList
            style={{ flex: 1 }}
            data={filtered}
            keyExtractor={(i) => i.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={empty ?? null}
            ListHeaderComponent={
              onCreateNew ? (
                <Pressable
                  onPress={() => onCreateNew(q.trim())}
                  accessibilityRole="button"
                  accessibilityLabel={q.trim() ? `Создать ${q.trim()}` : (createLabel ?? "Создать")}
                  className="flex-row items-center gap-2 border-b px-4 py-3 active:opacity-60"
                  style={{ borderColor: th.separator }}
                >
                  <Text className="text-base font-semibold" style={{ color: th.accent }}>
                    {createLabel ?? "Создать"}
                    {q.trim() ? ` «${q.trim()}»` : ""}
                  </Text>
                </Pressable>
              ) : null
            }
            renderItem={({ item }) => {
              const sel = selectedIds.includes(item.id);
              return (
                <Pressable
                  onPress={() => (multi ? onToggle?.(item.id) : onPick?.(item.id))}
                  accessibilityRole={multi ? "checkbox" : "button"}
                  accessibilityLabel={item.subtitle ? `${item.title}, ${item.subtitle}` : item.title}
                  accessibilityState={multi ? { checked: sel } : { selected: sel }}
                  className="flex-row items-center px-4 py-3 active:opacity-60"
                >
                  <View className="flex-1 pr-2">
                    <Text className="text-base" style={{ color: th.ink }} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {item.subtitle ? (
                      <Text className="text-sm" style={{ color: th.sub }} numberOfLines={1}>
                        {item.subtitle}
                      </Text>
                    ) : null}
                  </View>
                  {sel ? <Check color={th.accent} size={ICON.md} /> : null}
                </Pressable>
              );
            }}
            ItemSeparatorComponent={() => (
              <View className="ml-4 h-px" style={{ backgroundColor: th.separator }} />
            )}
          />
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Calendar client picker with inline «Новый клиент» create — one Modal that
// switches between the list and the create form (web parity; avoids the iOS
// «can't present a modal while another dismisses» race of stacked modals).
type PickerClient = { id: string; full_name: string | null; phone: string | null };
type ClientRow =
  | { kind: "header"; title: string }
  | { kind: "client"; client: PickerClient };

function ClientPickerModal({
  visible,
  onClose,
  clients,
  recentIds,
  selectedId,
  onPick,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  clients: PickerClient[];
  /** Клиенты последних записей — секция «Недавние» над общим списком. */
  recentIds?: string[];
  selectedId: string | null;
  onPick: (id: string) => void;
  onCreate: (name: string, phone: string) => Promise<string>;
}) {
  const t = useThemeColors();
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"list" | "create">("list");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setMode("list");
      setQ("");
      setName("");
      setPhone("");
    }
  }, [visible]);

  // Без запроса: «Недавние» (по последней записи) сверху, потом полный
  // список. При поиске секции убираются — просто совпадения.
  const rows = useMemo<ClientRow[]>(() => {
    const s = q.trim().toLowerCase();
    if (s) {
      return clients
        .filter(
          (c) =>
            (c.full_name ?? "").toLowerCase().includes(s) ||
            (c.phone ?? "").toLowerCase().includes(s),
        )
        .map((c) => ({ kind: "client" as const, client: c }));
    }
    const byId = new Map(clients.map((c) => [c.id, c]));
    const recents = (recentIds ?? [])
      .map((id) => byId.get(id))
      .filter((c): c is PickerClient => !!c);
    if (recents.length === 0)
      return clients.map((c) => ({ kind: "client" as const, client: c }));
    return [
      { kind: "header" as const, title: "Недавние" },
      ...recents.map((c) => ({ kind: "client" as const, client: c })),
      { kind: "header" as const, title: "Все клиенты" },
      ...clients.map((c) => ({ kind: "client" as const, client: c })),
    ];
  }, [q, clients, recentIds]);

  const startCreate = () => {
    const query = q.trim();
    const isPhone = /^[+\d][\d\s()-]*$/.test(query);
    setName(isPhone ? "" : query);
    setPhone(isPhone ? query : "");
    setMode("create");
  };

  const submit = async () => {
    if (!name.trim() && !phone.trim()) return;
    setBusy(true);
    try {
      const id = await onCreate(name.trim(), phone.trim());
      onPick(id);
    } catch (e) {
      Alert.alert("Не удалось создать клиента", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <View className="flex-1 justify-end" style={{ backgroundColor: t.scrim }}>
        <Pressable className="flex-1" onPress={onClose} accessible={false} />
        <View className="h-[80%] overflow-hidden rounded-t-3xl" style={{ backgroundColor: t.surface }}>
          <View className="flex-row items-center border-b px-2 py-2" style={{ borderColor: t.separator }}>
            {mode === "create" ? (
              <Pressable
                onPress={() => setMode("list")}
                accessibilityRole="button"
                accessibilityLabel="Назад"
                className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
              >
                <ChevronLeft color={t.body} size={ICON.md} />
              </Pressable>
            ) : null}
            <Text className="flex-1 px-2 text-base font-semibold" style={{ color: t.ink }}>
              {mode === "create" ? "Новый клиент" : "Клиент"}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Закрыть"
              className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
            >
              <X color={t.body} size={ICON.md} />
            </Pressable>
          </View>

          {mode === "list" ? (
            <>
              <View className="flex-row items-center gap-2 px-4 py-2">
                <Search color={t.faint} size={ICON.sm} />
            <TextInput
              value={q}
              accessibilityLabel="Поиск клиента"
                  onChangeText={setQ}
                  placeholder="Поиск…"
                  placeholderTextColor={t.placeholder}
                  selectionColor={t.accent}
                  keyboardAppearance="light"
                  className="flex-1 py-1 text-base"
                  style={{ color: t.ink }}
                />
              </View>
              <FlatList
                style={{ flex: 1 }}
                data={rows}
                keyExtractor={(i, idx) =>
                  i.kind === "header" ? `h-${i.title}` : `${i.client.id}-${idx}`
                }
                keyboardShouldPersistTaps="handled"
                ListHeaderComponent={
                  <Pressable
                    onPress={startCreate}
                    accessibilityRole="button"
                    accessibilityLabel={q.trim() ? `Новый клиент ${q.trim()}` : "Новый клиент"}
                    className="flex-row items-center gap-2 border-b px-4 py-3 active:opacity-60"
                    style={{ borderColor: t.separator }}
                  >
                    <Text className="text-base font-semibold" style={{ color: t.accent }}>
                      Новый клиент{q.trim() ? ` «${q.trim()}»` : ""}
                    </Text>
                  </Pressable>
                }
                renderItem={({ item }) => {
                  if (item.kind === "header") {
                    return (
                      <Text
                        className="px-4 pb-1.5 pt-3 text-xs font-semibold uppercase tracking-wider"
                        style={{ color: t.sub }}
                      >
                        {item.title}
                      </Text>
                    );
                  }
                  const c = item.client;
                  const sel = c.id === selectedId;
                  return (
                    <Pressable
                      onPress={() => onPick(c.id)}
                      accessibilityRole="button"
                      accessibilityLabel={[c.full_name || "Без имени", c.phone].filter(Boolean).join(", ")}
                      accessibilityState={{ selected: sel }}
                      className="flex-row items-center px-4 py-3 active:opacity-60"
                    >
                      <View className="flex-1 pr-2">
                        <Text className="text-base" style={{ color: t.ink }} numberOfLines={1}>
                          {c.full_name || "Без имени"}
                        </Text>
                        {c.phone ? (
                          <Text className="text-sm" style={{ color: t.sub }} numberOfLines={1}>
                            {c.phone}
                          </Text>
                        ) : null}
                      </View>
                      {sel ? <Check color={t.accent} size={ICON.md} /> : null}
                    </Pressable>
                  );
                }}
                ItemSeparatorComponent={() => (
                  <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />
                )}
              />
            </>
          ) : (
            <View className="px-5 pt-4">
          <TextInput
            value={name}
            accessibilityLabel="Имя клиента"
                onChangeText={setName}
                placeholder="Имя клиента"
                placeholderTextColor={t.placeholder}
                selectionColor={t.accent}
                keyboardAppearance="light"
                autoFocus
                className="mb-2 rounded-[14px] border px-4 py-3 text-base"
                style={{ borderColor: t.separator, color: t.ink }}
              />
          <TextInput
            value={phone}
            accessibilityLabel="Телефон клиента"
                onChangeText={setPhone}
                placeholder="+357 99 ..."
                placeholderTextColor={t.placeholder}
                selectionColor={t.accent}
                keyboardType="phone-pad"
                keyboardAppearance="light"
                className="mb-4 rounded-[14px] border px-4 py-3 text-base"
                style={{ borderColor: t.separator, color: t.ink }}
              />
              <Button
                label="Добавить"
                onPress={submit}
                disabled={(!name.trim() && !phone.trim()) || busy}
                loading={busy}
              />
            </View>
          )}
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
