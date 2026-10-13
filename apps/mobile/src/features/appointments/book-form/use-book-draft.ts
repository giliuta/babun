import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  Appointment,
  AppointmentStatus,
  Discount,
  PersonalEventRepeat,
} from "@babun/shared/local/appointments";
import type { TxVatMode } from "@babun/shared/local/finance/vat";
import { getCurrentCyprusTime } from "@babun/shared/common/utils/date-utils";
import { randomUuid } from "@babun/shared/sync/uuid";
import { useRememberedVatRate } from "@/features/finances/remembered-vat-rate";
import { useTeamVatRate } from "@/features/finances/vat-queries";
import { getSelfReminder } from "@/features/calendar/reminders";
import type { SelfReminder } from "@/features/calendar/reminder-time";
import { useUpdateClientById } from "@/features/clients/queries";
import { useCities } from "@/features/reference/queries";
import { useTeamSchedule } from "@/features/reference/team-schedule";
import { useUpdateAppointment } from "@/features/calendar/mutations";
import type { PendingPayment } from "@/features/appointments/PaymentBlock";
import { useBusinessNow } from "@/features/appointments/business-now";
import type { PendingFile } from "@/features/appointments/pending-files";
import { useTenantId } from "@/lib/tenant";
import { useRecordPayment, useRefundOverpayment } from "@/features/appointments/payment-mutations";
import {
  addMinutesHM,
  formatYMD,
  type ServiceOverride,
} from "@/features/appointments/helpers";
import type { BookReferences } from "./use-book-references";
import { first } from "./book-math";

// A type alias, not an interface: route params need an index-compatible shape.
export type BookParams = {
  date?: string;
  time_start?: string;
  kind?: string;
  teamId?: string;
  clientId?: string;
  locationId?: string;
  /** Правка существующей записи. Та же страница, тот же порядок полей —
   *  других форм записи в продукте нет (STORY-064). */
  appointmentId?: string;
  /** Откуда пришли открывать запись: «finances», «finances:<разрез>»,
   *  «invoice:<id>». Словарь дорог — `resolveReturnTo`. */
  from?: string;
};

export interface BookDraftInput {
  params: BookParams;
  teamId: string | null;
  setTeamId: Dispatch<SetStateAction<string | null>>;
  allAppts: BookReferences["allAppts"];
}

/** Every field of the record / event being written, plus the edit target. */
export function useBookDraft({ params, teamId, setTeamId, allAppts }: BookDraftInput) {
  // ── ПРАВКА СУЩЕСТВУЮЩЕЙ ЗАПИСИ (STORY-064) ──
  // Одна страница создаёт и правит. Запись берём из того же списка, что
  // рисует календарь: кеш уже тёплый, отдельный запрос завёл бы вторую
  // правду о той же записи.
  const editId = first(params.appointmentId) ?? null;
  // НАПОМНИТЬ СЕБЕ — колокольчик в шапке (владелец 24.09). Правило личное и
  // лежит на телефоне (`reminders.ts`), а не в записи.
  const [selfReminder, setSelfReminderRule] = useState<SelfReminder | null>(
    () => (editId ? getSelfReminder(editId) : null),
  );
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
  const dateTouchedRef = useRef(false);
  const [timeStart, setTimeStart] = useState<string>(
    first(params.time_start) ?? "10:00",
  );
  const [timeEnd, setTimeEnd] = useState<string>(() =>
    addMinutesHM(first(params.time_start) ?? "10:00", 60),
  );
  const [durationTouched, setDurationTouched] = useState(false);
  // ДЛИТЕЛЬНОСТЬ, ВЫБРАННАЯ РУКАМИ, СИЛЬНЕЕ ДЛИТЕЛЬНОСТИ ТИПА (владелец
  // 2026-09-08: «тип события — это стандарт, но если в событии я выбираю
  // время, скажем, тридцать минут, то главнее эти тридцать минут»).
  // Отдельный флаг от `durationTouched`: тот взводит и сам выбор типа —
  // иначе второй тип уже не смог бы поставить свою длительность.
  const [durationByHand, setDurationByHand] = useState(false);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, ServiceOverride>>(
    {},
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
  // VAT ЗАПИСИ — В «ИТОГО», КАК У ЧЕКА И ИНВОЙСА (владелец 2026-09-22:
  // «скидка, всё высчитывается, потом VAT начисляется; к счёту привязывается —
  // заходят деньги туда плюсом VAT»). Режим — клавишей VAT, ставка — цифрами,
  // написанная запоминается для следующих документов. «К оплате» записи
  // (`total_amount`) включает налог, а оплата ложится на счёт с выделенным
  // налогом по этой ставке (сервер, миграция 20260922040000).
  // Не писали ставку на этом телефоне — ставка команды из настроек.
  const teamVatRate = useTeamVatRate(teamId);
  const rememberedVatRate = useRememberedVatRate(teamVatRate);
  const [recordVatMode, setRecordVatMode] = useState<TxVatMode>("none");
  const [recordVatRate, setRecordVatRate] = useState<number | null>(null);
  // Причина скидки осталась только у старых записей — программу лояльности
  // сняли 20.09 по слову владельца, и её больше никто не выставляет сам.
  const [discountReason, setDiscountReason] = useState<string | null>(null);
  const [status, setStatus] = useState<AppointmentStatus>("scheduled");
  const [comment, setComment] = useState("");
  // Заметка, как набрана СЕЙЧАС: поле отдаёт её сюда на каждую букву без
  // перерисовки формы, состояние догоняет после паузы (`LocalDraftNoteField`).
  // Сохранение читает отсюда — нажатое посреди набора «Создать» не теряет
  // последние буквы.
  const commentNow = useRef("");
  useEffect(() => {
    commentNow.current = comment;
  }, [comment]);
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
  const businessNow = useBusinessNow(teamId);
  // Номер новой записи — один на всю жизнь формы (см. `booking.save`).
  const newRecordIdRef = useRef(randomUuid());
  // Файлы новой записи ждут её id, как ждёт оплата (STORY-070).
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const tenantIdForFiles = useTenantId();
  const queryClientForFiles = useQueryClient();
  const recordPayment = useRecordPayment();
  const refundOverpayment = useRefundOverpayment(editId);
  // Номер попытки возврата переплаты — один на это нажатие «Сохранить» и
  // его повторы после обрыва: сервер второго возврата не запишет.
  const overpayRequestRef = useRef<string | null>(null);
  const [reminderOn, setReminderOn] = useState(false);
  const [colorOverride, setColorOverride] = useState<string | null>(null);
  // МЕТКА ЭТОЙ ЗАПИСИ. Новая запись берёт метку дня СРАЗУ (владелец
  // 2026-09-04: «метка подставляется туда автоматически, то есть выбирается
  // по дню, а потом я уже вручную могу выбрать другую именно на запись»), и
  // с этого момента она принадлежит записи: диспетчер переставит метку дня —
  // уже назначенные работы своей метки не потеряют. `null` остаётся только у
  // записей, созданных до этого правила: они по-прежнему читаются как «как у
  // дня». Флаг `cityTouched` держит руку человека сильнее любого автомата.
  const [city, setCity] = useState<string | null>(null);
  const [cityTouched, setCityTouched] = useState(false);
  const updateClient = useUpdateClientById();

  // ФЛАГ ГОТОВНОСТИ, А НЕ REF. Эффекты «авто-конец» и «сумма по услугам»
  // объявлены НИЖЕ гидрации, поэтому в том же коммите отрабатывают следом за
  // ней — но со СТАРЫМ состоянием: конец записи становился 10:30 от дефолтных
  // 10:00, а итог обнулялся. Ref здесь не спасает: он выставляется синхронно и
  // к моменту их запуска уже истинен. Флаг состояния переключается только со
  // следующим рендером — то есть ровно тогда, когда гидрация УЖЕ легла.
  // Создание готово сразу: доопределять там нечего.
  const [hydrated, setHydrated] = useState(!isEdit);

  // ═══ ГИДРАЦИЯ ПРАВКИ ═══ — what the once-only effect in `use-book-prefill.ts`
  // writes into the draft. Stable: it only touches setters and a ref.
  //
  // ЗАМОК СТРОК ОБЯЗАТЕЛЕН. Сохранённая строка отдаёт числа того дня, когда
  // её записали, а не сегодняшний прайс. Без `locked` открытие майской
  // записи пересобирало бы её из нынешнего каталога: подняли цену «Чистки» —
  // и любой, кто просто заглянул в запись, переписал её деньги и долг
  // клиента. Тот же снимок, что держит карточка записи.
  const hydrate = useCallback(
    (editing: Appointment) => {
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
      setRecordVatMode(
        editing.vat_mode === "inclusive" || editing.vat_mode === "exclusive"
          ? editing.vat_mode
          : "none",
      );
      setRecordVatRate(editing.vat_rate ?? null);
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
        // Одна строка «адрес или ссылка»: у прежнего события с одним пином
        // поле показывает пин, а не пустоту.
        setEventAddress(editing.address || editing.event_url || "");
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
    },
    [setTeamId],
  );

  return {
    editId,
    selfReminder,
    setSelfReminderRule,
    isEdit,
    editing,
    updateMut,
    kind,
    setKind,
    clientId,
    setClientId,
    date,
    setDate,
    dateTouchedRef,
    timeStart,
    setTimeStart,
    timeEnd,
    setTimeEnd,
    durationTouched,
    setDurationTouched,
    durationByHand,
    setDurationByHand,
    serviceIds,
    setServiceIds,
    overrides,
    setOverrides,
    teamScheduleQuery,
    teamCities,
    masterId,
    setMasterId,
    locationId,
    setLocationId,
    address,
    setAddress,
    customTotal,
    setCustomTotal,
    totalDraft,
    setTotalDraft,
    discountType,
    setDiscountType,
    discountValue,
    setDiscountValue,
    teamVatRate,
    rememberedVatRate,
    recordVatMode,
    setRecordVatMode,
    recordVatRate,
    setRecordVatRate,
    discountReason,
    status,
    setStatus,
    comment,
    setComment,
    commentNow,
    eventTitle,
    setEventTitle,
    eventColor,
    setEventColor,
    eventTypeId,
    setEventTypeId,
    eventNotes,
    setEventNotes,
    eventAddress,
    setEventAddress,
    eventUrl,
    eventReminderOffset,
    repeat,
    allDay,
    setAllDay,
    pendingPayment,
    setPendingPayment,
    businessNow,
    newRecordIdRef,
    pendingFiles,
    setPendingFiles,
    tenantIdForFiles,
    queryClientForFiles,
    recordPayment,
    refundOverpayment,
    overpayRequestRef,
    reminderOn,
    colorOverride,
    setColorOverride,
    city,
    setCity,
    cityTouched,
    setCityTouched,
    updateClient,
    hydrated,
    hydrate,
  };
}

export type BookDraft = ReturnType<typeof useBookDraft>;
