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
import type { SelfReminder } from "@/lib/reminder-time";
import { useUpdateClientById } from "@/features/clients/queries";
import { useCities } from "@/features/reference/queries";
import { useTeamSchedule } from "@/features/reference/team-schedule";
import { useUpdateAppointment } from "@/features/calendar/mutations";
import type { PendingPayment } from "@/features/appointments/PaymentBlock";
import { useBusinessNow } from "@/features/appointments/business-now";
import type { PendingFile } from "@/features/appointments/pending-files";
import { useTenantId } from "@/lib/tenant";
import { useRecordPayment, useRefundOverpaymentAndSave } from "@/features/appointments/payment-mutations";
import {
  addMinutesHM,
  formatYMD,
  type ServiceOverride,
} from "@/features/appointments/helpers";
import type { BookReferences } from "./use-book-references";
import { first } from "./book-math";
import { pinOfCoords } from "./event-place";
import type { BookDraftSnapshot } from "./book-draft-store";

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
  /** Метка «начать заново»: «Удалить черновик» меняет её, и форма
   *  собирается с чистого листа (ключ `BookForm`). */
  fresh?: string;
  /** Копия события на весь день: НОВАЯ запись с полями этой. Создаётся
   *  только на «Создать» — вышел без него, и дубля в дне нет (CAL-33). */
  copyOf?: string;
};

interface BookDraftInput {
  params: BookParams;
  teamId: string | null;
  setTeamId: Dispatch<SetStateAction<string | null>>;
  allAppts: BookReferences["allAppts"];
  /** Черновик новой записи, поднятый с телефона (`book-draft-store.ts`).
   *  Команда, клиент, день и час приходят с ним через `params`. */
  restored?: BookDraftSnapshot | null;
}

/** Every field of the record / event being written, plus the edit target. */
export function useBookDraft({ params, teamId, setTeamId, allAppts, restored = null }: BookDraftInput) {
  // ── ПРАВКА СУЩЕСТВУЮЩЕЙ ЗАПИСИ (STORY-064) ──
  // Одна страница создаёт и правит. Запись берём из того же списка, что
  // рисует календарь: кеш уже тёплый, отдельный запрос завёл бы вторую
  // правду о той же записи.
  const editId = first(params.appointmentId) ?? null;
  // НАПОМНИТЬ СЕБЕ — колокольчик в шапке. Правило личное и
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

  // ── СКИДКА — ЧАСТЬ БЛОКА «СУММА»: её ставят только в шторке «Итого», а
  //    шторку открывает `can.editTotal` (`bookRights`) — сотруднику только с
  //    «Сумма и услуги записи: Меняет». Сервер проверяет то же поле за полем
  //    (`member_check_appointment_field` → `record.amount`). ──

  // ── состояние ──
  const initialKind = first(params.kind) === "event" ? "event" : "work";
  const [kind, setKind] = useState<"work" | "event">(initialKind);
  const [clientId, setClientId] = useState<string | null>(
    first(params.clientId) ?? null,
  );
  const [date, setDate] = useState<string>(
    first(params.date) ?? formatYMD(getCurrentCyprusTime()),
  );
  // Поднятый черновик — уже рука человека: день и конец его, умолчания
  // молчат.
  const dateTouchedRef = useRef(restored != null);
  const [timeStart, setTimeStart] = useState<string>(
    first(params.time_start) ?? "10:00",
  );
  const [timeEnd, setTimeEnd] = useState<string>(() =>
    restored?.timeEnd ?? addMinutesHM(first(params.time_start) ?? "10:00", 60),
  );
  const [durationTouched, setDurationTouched] = useState(restored?.durationTouched ?? false);
  // ДЛИТЕЛЬНОСТЬ, ВЫБРАННАЯ РУКАМИ, СИЛЬНЕЕ ДЛИТЕЛЬНОСТИ ТИПА (тип события — стандарт, но выбранное время,
  // скажем тридцать минут, главнее).
  // Отдельный флаг от `durationTouched`: тот взводит и сам выбор типа —
  // иначе второй тип уже не смог бы поставить свою длительность.
  const [durationByHand, setDurationByHand] = useState(restored?.durationByHand ?? false);
  const [serviceIds, setServiceIds] = useState<string[]>(restored?.serviceIds ?? []);
  const [overrides, setOverrides] = useState<Record<string, ServiceOverride>>(
    restored?.overrides ?? {},
  );
  const teamScheduleQuery = useTeamSchedule(teamId ?? undefined);
  // Метки принадлежат команде — те же, что предлагаются её дню.
  const { data: teamCities = [] } = useCities({ teamId });
  const [masterId, setMasterId] = useState<string | null>(restored?.masterId ?? null);
  const [locationId, setLocationId] = useState<string | null>(
    first(params.locationId) ?? null,
  );
  const [address, setAddress] = useState(restored?.address ?? "");
  const [customTotal, setCustomTotal] = useState(restored?.customTotal ?? false);
  const [totalDraft, setTotalDraft] = useState(restored?.totalDraft ?? "");
  const [discountType, setDiscountType] = useState<Discount["type"] | null>(
    restored?.discountType ?? null,
  );
  const [discountValue, setDiscountValue] = useState(restored?.discountValue ?? "");
  // VAT ЗАПИСИ — В «ИТОГО», КАК У ЧЕКА И ИНВОЙСА (скидка, потом VAT; к счёту привязывается — деньги
  // заходят туда плюсом VAT). Режим — клавишей VAT, ставка — цифрами,
  // написанная запоминается для следующих документов. «К оплате» записи
  // (`total_amount`) включает налог, а оплата ложится на счёт с выделенным
  // налогом по этой ставке (сервер, миграция 20260922040000).
  // Не писали ставку на этом телефоне — ставка команды из настроек.
  const teamVatRate = useTeamVatRate(teamId);
  const rememberedVatRate = useRememberedVatRate(teamVatRate);
  const [recordVatMode, setRecordVatMode] = useState<TxVatMode>(restored?.recordVatMode ?? "none");
  const [recordVatRate, setRecordVatRate] = useState<number | null>(restored?.recordVatRate ?? null);
  // Причина скидки осталась только у старых записей — программы лояльности
  // нет, и её больше никто не выставляет сам.
  const [discountReason, setDiscountReason] = useState<string | null>(null);
  const [status, setStatus] = useState<AppointmentStatus>(restored?.status ?? "scheduled");
  const [comment, setComment] = useState(restored?.comment ?? "");
  // Заметка, как набрана СЕЙЧАС: поле отдаёт её сюда на каждую букву без
  // перерисовки формы, состояние догоняет после паузы (`LocalDraftNoteField`).
  // Сохранение читает отсюда — нажатое посреди набора «Создать» не теряет
  // последние буквы.
  const commentNow = useRef(restored?.comment ?? "");
  useEffect(() => {
    commentNow.current = comment;
  }, [comment]);
  // Название события — отдельное состояние от заметки команде: раньше общий
  // `comment` перетекал между режимами Клиент/Событие.
  const [eventTitle, setEventTitle] = useState(restored?.eventTitle ?? "");
  const [eventColor, setEventColor] = useState<string | null>(restored?.eventColor ?? null);
  const [eventTypeId, setEventTypeId] = useState<string | null>(restored?.eventTypeId ?? null);
  const [eventNotes, setEventNotes] = useState(restored?.eventNotes ?? "");
  const [eventAddress, setEventAddress] = useState(restored?.eventAddress ?? "");
  // Объект события без клиента — точка и заметка рядом с адресом (`event-place.ts`).
  const [eventPlacePin, setEventPlacePin] = useState(restored?.eventPlacePin ?? "");
  const [eventPlaceNote, setEventPlaceNote] = useState(restored?.eventPlaceNote ?? "");
  const [eventUrl, setEventUrl] = useState(restored?.eventUrl ?? "");
  const [eventReminderOffset, setEventReminderOffset] = useState<number | null>(
    restored?.eventReminderOffset ?? null,
  );
  const [repeat, setRepeat] = useState<PersonalEventRepeat>(restored?.repeat ?? { kind: "none" });
  const [allDay, setAllDay] = useState(restored?.allDay ?? false);
  // Деньги новой записи: счёт выбран, запишется после «Создать запись».
  // У существующей записи блок пишет оплату сам и сразу (STORY-065).
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const businessNow = useBusinessNow(teamId);
  // Номер новой записи — один на всю жизнь формы (см. `booking.save`).
  const newRecordIdRef = useRef(restored?.newRecordId ?? randomUuid());
  // Файлы новой записи ждут её id, как ждёт оплата (STORY-070).
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const tenantIdForFiles = useTenantId();
  const queryClientForFiles = useQueryClient();
  const recordPayment = useRecordPayment();
  const refundOverpayment = useRefundOverpaymentAndSave(editId);
  // Номер попытки возврата переплаты — один на это нажатие «Сохранить» и
  // его повторы после обрыва: сервер второго возврата не запишет.
  const overpayRequestRef = useRef<string | null>(null);
  // Оплата новой записи — один номер попытки на жизнь формы, как и номер
  // самой записи: повтор «Создать» сервер второй проводкой не запишет.
  const paymentRequestIdRef = useRef(randomUuid());
  // «Уже сохраняю» — синхронно, в отличие от isPending мутаций: второй тап в
  // том же кадре видел старый рендер и уходил вторым сохранением.
  const savingRef = useRef(false);
  const [reminderOn, setReminderOn] = useState(restored?.reminderOn ?? false);
  const [colorOverride, setColorOverride] = useState<string | null>(restored?.colorOverride ?? null);
  // МЕТКА ЭТОЙ ЗАПИСИ. Новая запись берёт метку дня СРАЗУ (подставляется автоматически по дню, а
  // потом вручную можно выбрать другую именно на запись), и
  // с этого момента она принадлежит записи: диспетчер переставит метку дня —
  // уже назначенные работы своей метки не потеряют. `null` остаётся только у
  // записей, созданных до этого правила: они по-прежнему читаются как «как у
  // дня». Флаг `cityTouched` держит руку человека сильнее любого автомата.
  const [city, setCity] = useState<string | null>(restored?.city ?? null);
  const [cityTouched, setCityTouched] = useState(restored?.cityTouched ?? false);
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
        // Ссылка — сразу, а не эффектом следующего кадра: снимок «как было»
        // (`use-leave-guard`) снимается в этом же коммите и читает заметку
        // отсюда. С пустой ссылкой любая запись с заметкой считалась
        // изменённой, и «Назад» спрашивал «Сохранить изменения?» у того, кто
        // ничего не трогал.
        commentNow.current = editing.comment ?? "";
      } else {
        setEventTitle(editing.comment ?? "");
        setEventColor(editing.color_override ?? null);
        setEventNotes(editing.event_notes ?? "");
        // Одна строка «адрес или ссылка»: у прежнего события с одним пином
        // поле показывает пин, а не пустоту.
        setEventAddress(editing.address || editing.event_url || "");
        setEventPlacePin(pinOfCoords(editing.address_lat, editing.address_lng));
        setEventPlaceNote(editing.address_note ?? "");
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
    eventPlacePin,
    setEventPlacePin,
    eventPlaceNote,
    setEventPlaceNote,
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
    paymentRequestIdRef,
    savingRef,
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
