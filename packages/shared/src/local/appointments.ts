// Appointments data layer.
//
// Форма записи и правила чтения денег по ней. Хранит записи Supabase
// (db/repositories/appointments.ts) — здесь только shape и селекторы.

import { generateId } from "./masters";

export type AppointmentStatus =
  | "scheduled" // запланирована, ещё не выполнена
  | "in_progress" // мастер на месте, работает
  | "completed" // выполнена
  | "cancelled"; // отменена

export type PaymentMethod =
  | "cash"
  | "card"
  | "transfer"
  | "other"
  | "split"
  | "invoice";

export interface Payment {
  id: string;
  method: PaymentMethod;
  amount: number;
  paid_at: string; // ISO date
  /** Счёт, на который легли ИМЕННО ЭТИ деньги. Витрина для карточки записи:
   *  леджер финансов owner-only и требует сети, а «куда положили» видно
   *  всем и офлайн. Старые платежи без поля — «счёт определён автоматически». */
  account_id?: string | null;
}

// STORY-002-FINAL: единый объект оплаты вместо массива payments.
// Описывает как клиент заплатил: полностью наличкой/картой, сплит
// (часть нал + часть карта), или счёт компании (оплата по инвойсу
// позже, деньги в кассу не поступили).
export interface AppointmentPayment {
  method: "cash" | "card" | "split" | "invoice";
  cashAmount: number;
  cardAmount: number;
  /** ISO timestamp когда провели оплату. */
  paid_at: string;
}

// MEGA-UPDATE: multi-services + discounts on appointment.
export interface Discount {
  type: "fixed" | "percent";
  value: number;       // EUR for fixed, 0–100 for percent
  reason?: string;     // "Постоянный", "VIP", "Промо", свободный текст
}

export interface AppointmentService {
  serviceId: string;
  quantity: number;
  pricePerUnit: number;    // фактическая цена за шт (может отличаться от каталога)
  originalPrice: number;   // цена из каталога — для зачёркивания
  totalPrice: number;      // qty × pricePerUnit − discount
  duration: number;        // qty × baseDuration
  discount?: Discount;
  /** ИМЯ И ЕДИНИЦА НА ДЕНЬ ЗАПИСИ (2026-08-25). Услугу могли переименовать —
   *  «Чистка» стала «Чисткой сплит-системы», — и прошлая запись обязана
   *  называть работу так, как её назвали тогда. Ещё важнее: услугу могли
   *  стереть насовсем, и тогда имя не восстановить ниоткуда (в базе прода уже
   *  лежат четыре такие). Необязательные: у записей, сделанных до этого дня,
   *  их нет, и читатель падает обратно на справочник. */
  serviceName?: string;
  unit?: string | null;
  /** Выбранный вариант услуги, если она типа «варианты». */
  variantId?: string | null;
}

export type AppointmentKind = "work" | "event" | "personal"; // event = встреча/обед/перерыв

/** v454 — repeat rule for personal events. Discriminated union so
 *  the runtime never has to parse an RRULE string. `until` is an
 *  optional ISO date (YYYY-MM-DD); when omitted the event repeats
 *  indefinitely. v454 added "weekdays" (Mon–Fri) and "biweekly". */
export type PersonalEventRepeat =
  | { kind: "none" }
  | { kind: "daily"; until?: string; count?: number }
  | { kind: "weekdays"; until?: string; count?: number }   // Mon–Fri
  | { kind: "weekly"; until?: string; count?: number }
  | { kind: "biweekly"; until?: string; count?: number }
  | { kind: "monthly"; until?: string; count?: number }
  | { kind: "yearly"; until?: string; count?: number }
  /** Brief 2 #18 (STORY-091): custom weekday set, e.g. Mon+Wed+Fri.
   *  `days` is an array of weekday numbers (0=Sun..6=Sat). When empty
   *  the rule behaves like "none". */
  | { kind: "custom_weekdays"; days: number[]; until?: string; count?: number };

/** Откуда пришла заявка. Совмещена со списком клиента
 *  (AcquisitionSource в lib/clients), но отдельный тип потому что у
 *  заявки может быть «phone» (позвонили напрямую), а у клиента этой
 *  опции нет. */
export type AppointmentSource =
  | "instagram"
  | "whatsapp"
  | "online"
  | "phone"
  | "referral"
  | "repeat"
  | "walk_in"
  | "other";

export const APPOINTMENT_SOURCE_LABELS: Record<AppointmentSource, string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  online: "Сайт",
  phone: "Звонок",
  referral: "Рекомендация",
  repeat: "Повторный",
  walk_in: "Проездом",
  other: "Другое",
};

export type PhotoKind = "before" | "after" | "other";

export interface AppointmentPhoto {
  id: string;
  data_url: string; // base64 — works without Supabase storage for now
  caption: string;
  kind: PhotoKind;
  /** Which object the photo belongs to (client.locations[].id). */
  location_id?: string;
  /** Time the photo was taken. Distinct from uploaded_at when imported
   *  from gallery long after the shoot. */
  taken_at?: string;
  uploaded_at: string;
}

export interface AppointmentExpense {
  id: string;
  name: string;
  amount: number; // EUR, positive value
}

export interface Appointment {
  id: string;
  /** Auth user who created the row. Server-owned; used to keep shared team
   * event controls aligned with creator-only UPDATE/DELETE policies. */
  created_by?: string | null;
  date: string; // YYYY-MM-DD
  time_start: string; // HH:MM
  time_end: string; // HH:MM

  client_id: string | null; // null = quick-anonymous (rare)
  /** STORY-002: id объекта клиента (из client.locations). null если
   *  клиент не выбран или у клиента один объект. */
  location_id: string | null;
  team_id: string | null;
  /** Sprint 033 Phase I37 — private / personal calendar owner. When
   *  set AND team_id is null, this is a personal event visible only
   *  to this master. Team events keep master_id null. */
  master_id?: string | null;
  service_ids: string[];

  // Финансы
  total_amount: number; // фактическая сумма (auto из услуг минус скидка)
  custom_total: boolean; // true если total_amount изменён вручную
  discount_amount: number; // скидка в EUR, вычитается из суммы услуг
  expenses: AppointmentExpense[]; // расходы по записи (материалы, транспорт и т.п.)
  service_price_overrides: Record<string, number>; // id → per-unit цена, если переопределена
  color_override: string | null; // hex — персональный цвет записи/события (палитра)
  /** МЕТКА ЭТОЙ ЗАПИСИ (владелец 2026-09-04). `null` — «как у дня»: запись
   *  берёт метку дня команды и переезжает вместе с ней. Строка — своя метка
   *  именно этой работы: день в Лимассоле, а последний клиент в Пафосе. */
  city: string | null;
  prepaid_amount: number; // аванс / предоплата
  payments: Payment[]; // legacy массив платежей — постепенно вытесняется payment-объектом
  /** STORY-002-FINAL: единый объект оплаты. Заполняется при
   *  переводе записи в status=completed через PaymentBlock. */
  payment: AppointmentPayment | null;
  /** P0 #14 (CRM Core brief) — explicit status enum so reports +
   *  the auto-sync trigger (Supabase 20260517_001) can branch
   *  without summing the `payments` array. Defaults to 'unpaid' for
   *  fresh rows; 'partial' / 'paid' / 'refunded' written by the
   *  payment block when the operator marks the appointment paid. */
  payment_status?: "unpaid" | "partial" | "paid" | "refunded";
  /** Mirror of the Supabase column. Lets the UI badge surface
   *  «Карта / Нал / Перевод» on the appointment block without
   *  reading the `payment` jsonb. */
  payment_method?: "cash" | "card" | "transfer" | "other";
  /** СЧЁТ, НА КОТОРЫЙ КЛАДУТ ДЕНЬГИ ПРЯМО СЕЙЧАС.
   *
   *  Поле-курьер, а не постоянное свойство записи: сервер читает его в момент
   *  проводки и навсегда записывает счёт В САМУ ТРАНЗАКЦИЮ. Аванс картой и
   *  остаток наличными — два разных счёта у одной записи, поэтому «куда легло»
   *  спрашивают у платежей (`payments[].account_id`), а не у этой колонки.
   *
   *  NULL — счёт угадывается по способу оплаты (старые записи, закрытие дня,
   *  импорт). Именно это угадывание и роняло приём денег у команд, у которых
   *  счёта нужного вида не оказалось. */
  payment_account_id?: string | null;
  /** Mirror — total actually received so far. The trigger uses
   *  total_amount for the income row; this field lets the UI show
   *  «частично оплачено» (paid_amount < total_amount). */
  paid_amount?: number;
  /** MEGA-UPDATE: список услуг со степпером количества и per-line
   *  скидкой. Постепенно заменяет service_ids. */
  services: AppointmentService[];
  /** Скидка на всю запись (применяется к subtotal). */
  global_discount: Discount | null;
  /** Суммарная длительность = sum(qty × baseDuration). Кешируется
   *  для быстрого отображения. */
  total_duration: number;

  // Доп. поля
  comment: string;
  address: string; // переопределяет client.address
  /** Короткая заметка к адресу (например «Зелёная дверь, звонок»).
   *  Хранится отдельно от общего comment, чтобы команда видела её
   *  прямо рядом с навигацией. */
  address_note: string;
  address_lat: number | null;
  address_lng: number | null;

  source: AppointmentSource | null; // канал обращения клиента
  is_online_booking: boolean; // true — клиент записался сам через онлайн-форму
  /** Причина отмены — заполняется когда status="cancelled". null если
   *  ещё не отменили или диспетчер не указал. */
  cancel_reason: string | null;
  kind: AppointmentKind; // 'event' / 'personal' = не услуга, а личное событие
  photos: AppointmentPhoto[]; // фото до/после работы
  /** Client agreed to photos being taken. Default true for AirFix
   *  single-tenant; becomes a visible toggle when multi-tenant SaaS
   *  arrives. */
  consent_given: boolean;

  reminder_enabled: boolean; // клиенту отправляется SMS-напоминание
  reminder_offsets: number[]; // смещения в минутах ДО начала (например [1440, 60])
  reminder_template: string; // шаблон SMS, поддерживает {name} {date} {time} {address}

  // ─── Personal-calendar fields (kind="event" + master_id set) ────────
  // Типы событий — пресеты (цвет/текст применяются при выборе, как
  // EventPresetChips на вебе), а не персистируемая ссылка: колонки
  // event_type_id в БД нет и все мапперы её отбрасывали.
  /** Long-form note distinct from `comment` (which doubles as title
   *  for legacy event records). Personal sheet writes notes here. */
  event_notes?: string;
  /** Optional URL — meeting link, document, map. Tappable in view. */
  event_url?: string;
  /** All-day flag. When true the time pickers are hidden and the
   *  event spans the whole day in the calendar grid. */
  event_all_day?: boolean;
  /** Push self-reminder toggle. Independent from `reminder_enabled`,
   *  which handles client SMS for work appointments. */
  event_push_enabled?: boolean;
  /** Offsets in minutes before start at which to fire a push. E.g.
   *  [15] → 15 min before. v453 — single-select; legacy multi-select
   *  saves still load (we just take the first entry). v454 — when
   *  `event_push_at` is set, this is ignored. */
  event_push_offsets?: number[];
  /** v454 — absolute ISO datetime at which to fire the push. Set
   *  when the user picks "Своё" and dials in a specific moment
   *  rather than a relative offset. Mutually exclusive with
   *  event_push_offsets — `at` wins when both are set. */
  event_push_at?: string | null;
  /** Recurrence rule. Stored as a discriminated union so the
   *  consumer doesn't need to parse RRULE strings. */
  event_repeat?: PersonalEventRepeat;

  status: AppointmentStatus;
  created_at: string;
  updated_at: string;
}

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: "Запланирована",
  in_progress: "В работе",
  completed: "Выполнена",
  cancelled: "Отменена",
};

// ─── Computed helpers ──────────────────────────────────────────────────

export function getPaidAmount(apt: Appointment): number {
  // A full refund is a terminal economic state for the appointment read
  // model. Historical receipt mirrors deliberately stay on the row for the
  // audit trail, but they must not be resurrected as current revenue.
  if (apt.payment_status === "refunded") return 0;

  // Получено СВЕРХ аванса считается по двум источникам и берётся максимум:
  // леджер payments[] (мобильные пути: buildDebtPaidPatch, close-day) и
  // веб-зеркала — payment-объект (нал+карта) либо колонка paid_amount
  // (actualPaid, web appointment-builders) — оба БЕЗ аванса. Именно max,
  // а не «леджер вытесняет зеркала»: у смешанных строк первый мобильный
  // платёж ложится в леджер поверх зеркальной истории веба, и приоритет
  // леджера «воскрешал» уже погашенный долг. paid_amount при
  // payment_status 'unpaid' игнорируем: бэкфилл миграции 20260517_001
  // записал туда prepaid_amount всех старых строк — чтение задваивало бы
  // аванс (prepaid_amount прибавляется отдельно строкой ниже).
  const ledger = apt.payments.reduce((sum, p) => sum + p.amount, 0);
  const mirror = apt.payment
    ? apt.payment.cashAmount + apt.payment.cardAmount
    : (apt.payment_status ?? "unpaid") !== "unpaid"
      ? apt.paid_amount ?? 0
      : 0;
  return apt.prepaid_amount + Math.max(ledger, mirror);
}

export function getDebtAmount(apt: Appointment): number {
  // Refunding a completed visit does not silently reopen customer debt. The
  // visit remains in history with the explicit «Возврат» status; collecting
  // it again requires a new payment lifecycle, not a derived balance.
  if (apt.payment_status === "refunded") return 0;
  return Math.max(0, apt.total_amount - getPaidAmount(apt));
}

export function isFullyPaid(apt: Appointment): boolean {
  return getPaidAmount(apt) >= apt.total_amount && apt.total_amount > 0;
}

/**
 * Revenue recognized by operational KPI screens. Those screens historically
 * value every completed job at its agreed total (even when collection is
 * still pending), which is intentionally different from getPaidAmount(). A
 * fully refunded job remains completed work in visit counters but contributes
 * zero to revenue and leaderboards.
 */
export function getRecognizedRevenue(apt: Appointment): number {
  if (apt.status !== "completed" || apt.payment_status === "refunded") return 0;
  return Math.max(0, apt.total_amount ?? 0);
}

// ─── Factory ───────────────────────────────────────────────────────────

export function createBlankAppointment(overrides: Partial<Appointment> = {}): Appointment {
  const now = new Date().toISOString();
  return {
    // v489 — generate a real UUID up front so the optimistic React /
    // localStorage / IDB row, the Supabase INSERT, and the sync-queue
    // replay all share the same id. Legacy `generateId("apt")` produced
    // `apt-mp2we5l1-ow18u` style strings; Supabase's `appointments.id`
    // is a uuid column, so the repo had to strip the id on insert and
    // reconcile. Worst case (network blip): the op got queued in IDB
    // with the apt-id payload, and replay then failed with «invalid
    // input syntax for type uuid», stranding the event in «Очередь
    // синхронизации». Using a UUID from the start removes the entire
    // failure mode. Falls back to the legacy generator on environments
    // without `crypto.randomUUID` (older Safari, but iOS 15.4+ has it).
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : generateId("apt"),
    created_by: null,
    date: "",
    time_start: "10:00",
    time_end: "11:00",
    client_id: null,
    location_id: null,
    team_id: null,
    service_ids: [],
    total_amount: 0,
    custom_total: false,
    discount_amount: 0,
    expenses: [],
    service_price_overrides: {},
    color_override: null,
    city: null,
    prepaid_amount: 0,
    payments: [],
    payment: null,
    services: [],
    global_discount: null,
    total_duration: 0,
    comment: "",
    address: "",
    address_note: "",
    address_lat: null,
    address_lng: null,
    source: null,
    is_online_booking: false,
    cancel_reason: null,
    kind: "work",
    photos: [],
    consent_given: true,
    reminder_enabled: false,
    reminder_offsets: [1440, 60],
    reminder_template:
      "Здравствуйте, {name}! Напоминаем: {date} в {time} по адресу {address}. Babun CRM",
    status: "scheduled",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

/** Clone an appointment with a fresh ID, blanked-out payments and scheduled status. */
export function duplicateAppointment(apt: Appointment): Appointment {
  const now = new Date().toISOString();
  // Состав (services / service_ids / global_discount / total_duration)
  // приходит спредом целиком — обнуление services при сохранённом
  // total_amount давало копию с рассинхроном суммы и состава услуг.
  // Сбрасываются только оплата (включая зеркала) и статус.
  return {
    ...apt,
    id: generateId("apt"),
    // The server stamps the authenticated copier as the new creator. Never
    // carry the source event's author into the optimistic copy.
    created_by: null,
    prepaid_amount: 0,
    payments: [],
    payment: null,
    payment_status: "unpaid",
    payment_method: undefined,
    paid_amount: undefined,
    status: "scheduled",
    cancel_reason: null,
    photos: [],
    created_at: now,
    updated_at: now,
  };
}
