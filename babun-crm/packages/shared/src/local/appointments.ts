// Appointments data layer.
//
// Single source of truth for service appointments. Persisted in localStorage
// for now; will move to Supabase later.

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

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
  other: "Другое",
  // Brief 1 #15: «Сплит» reads as the HVAC equipment type (used
  // elsewhere as ACType.split = «Сплит»). For the payment-method
  // surface use the plain RU word.
  split: "Раздельно",
  invoice: "Счёт",
};

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: "Запланирована",
  in_progress: "В работе",
  completed: "Выполнена",
  cancelled: "Отменена",
};

// ─── Storage ───────────────────────────────────────────────────────────

const STORAGE_KEY = "babun-appointments";

export function loadAppointments(): Appointment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Lightweight migration: fill in fields added after the record was stored
    return parsed.map((p: Partial<Appointment>) => ({
      ...p,
      discount_amount: p.discount_amount ?? 0,
      expenses: p.expenses ?? [],
      service_price_overrides: p.service_price_overrides ?? {},
      color_override: p.color_override ?? null,
      reminder_enabled: p.reminder_enabled ?? false,
      reminder_offsets: p.reminder_offsets ?? [1440, 60],
      reminder_template:
        p.reminder_template ??
        "Здравствуйте, {name}! Напоминаем: {date} в {time} по адресу {address}. Babun CRM",
      location_id: p.location_id ?? null,
      address_note: p.address_note ?? "",
      consent_given: p.consent_given ?? true,
      // Defensive: normalize each legacy AppointmentPhoto so the viewer
      // never crashes on undefined kind / taken_at.
      photos: (p.photos ?? []).map((ph) => ({
        ...ph,
        kind: ph.kind ?? "other",
        taken_at: ph.taken_at ?? ph.uploaded_at,
      })),
      services: p.services ?? [],
      global_discount: p.global_discount ?? null,
      total_duration: p.total_duration ?? 0,
      cancel_reason: p.cancel_reason ?? null,
      source: (p.source ?? null) as AppointmentSource | null,
      event_notes: p.event_notes ?? "",
      event_url: p.event_url ?? "",
      event_all_day: p.event_all_day ?? false,
      event_push_enabled: p.event_push_enabled ?? false,
      event_push_offsets: Array.isArray(p.event_push_offsets)
        ? p.event_push_offsets
        : [],
      event_push_at: p.event_push_at ?? null,
      event_repeat: p.event_repeat ?? { kind: "none" },
      // Migrate legacy payments[] → payment (single object). Sum up
      // cash / card payments; anything else collapses to invoice.
      payment:
        p.payment ??
        (p.payments && p.payments.length > 0
          ? (() => {
              const cash = p.payments
                .filter((x) => x.method === "cash")
                .reduce((s, x) => s + x.amount, 0);
              const card = p.payments
                .filter((x) => x.method === "card")
                .reduce((s, x) => s + x.amount, 0);
              const total = cash + card;
              if (total === 0) return null;
              const method: AppointmentPayment["method"] =
                cash > 0 && card > 0 ? "split" : cash > 0 ? "cash" : "card";
              return {
                method,
                cashAmount: cash,
                cardAmount: card,
                paid_at: p.payments[p.payments.length - 1].paid_at,
              };
            })()
          : null),
    })) as Appointment[];
  } catch {
    return [];
  }
}

export function saveAppointments(list: Appointment[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

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

// ─── Validation: required fields config (settings) ─────────────────────

export interface FormFieldVisibility {
  show_address: boolean;
  show_comment: boolean;
  show_prepaid: boolean;
  show_payments: boolean;
  show_source: boolean;
  show_reminder: boolean;
}

export interface RequiredFields {
  require_client: boolean;
  require_phone: boolean;
  require_services: boolean;
  require_address: boolean;
  require_comment: boolean;
}

export const DEFAULT_FIELD_VISIBILITY: FormFieldVisibility = {
  show_address: true,
  show_comment: true,
  show_prepaid: true,
  show_payments: true,
  show_source: false, // позже
  show_reminder: false, // позже
};

export const DEFAULT_REQUIRED_FIELDS: RequiredFields = {
  require_client: true,
  require_phone: true,
  require_services: true,
  require_address: false,
  require_comment: false,
};

const FIELD_VIS_KEY = "babun-field-visibility";
const REQUIRED_KEY = "babun-required-fields";

export function loadFieldVisibility(): FormFieldVisibility {
  if (typeof window === "undefined") return DEFAULT_FIELD_VISIBILITY;
  try {
    const raw = window.localStorage.getItem(FIELD_VIS_KEY);
    return raw ? { ...DEFAULT_FIELD_VISIBILITY, ...JSON.parse(raw) } : DEFAULT_FIELD_VISIBILITY;
  } catch {
    return DEFAULT_FIELD_VISIBILITY;
  }
}

export function saveFieldVisibility(value: FormFieldVisibility): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FIELD_VIS_KEY, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function loadRequiredFields(): RequiredFields {
  if (typeof window === "undefined") return DEFAULT_REQUIRED_FIELDS;
  try {
    const raw = window.localStorage.getItem(REQUIRED_KEY);
    return raw ? { ...DEFAULT_REQUIRED_FIELDS, ...JSON.parse(raw) } : DEFAULT_REQUIRED_FIELDS;
  } catch {
    return DEFAULT_REQUIRED_FIELDS;
  }
}

export function saveRequiredFields(value: RequiredFields): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REQUIRED_KEY, JSON.stringify(value));
  } catch {
    // ignore
  }
}

// ─── Validation result ─────────────────────────────────────────────────

export type ValidationLevel = "ok" | "warning" | "error";

export interface ValidationResult {
  level: ValidationLevel;
  missing: string[]; // human-readable list, e.g. ['Адрес', 'Услуги']
}

export function validateAppointment(
  apt: Appointment,
  required: RequiredFields,
  hasClientPhone: boolean
): ValidationResult {
  const missing: string[] = [];

  if (required.require_client && !apt.client_id) missing.push("Клиент");
  if (required.require_phone && !hasClientPhone) missing.push("Телефон клиента");
  if (required.require_services && apt.service_ids.length === 0) missing.push("Услуги");
  if (required.require_address && !apt.address.trim()) missing.push("Адрес");
  if (required.require_comment && !apt.comment.trim()) missing.push("Комментарий");

  return {
    level: missing.length === 0 ? "ok" : "warning",
    missing,
  };
}

// ─── Color logic for calendar block ────────────────────────────────────

export type AppointmentColorKind =
  | "scheduled"     // blue — стандартная запись (жилой дом)
  | "commercial"    // orange — коммерция (офис/ресторан/магазин)
  | "no_address"    // yellow — нет адреса! Дима забыл / клиент не скинул
  | "tentative"     // light blue dashed — предварительная (будущая, не подтверждена)
  | "completed"     // gray — выполнена, в прошлом
  | "cancelled"     // red — отменена / отказался
  | "in_progress"   // green — в работе прямо сейчас
  | "event"         // slate — личное событие / задача для команды
  | "past";         // faded gray — прошлая, не выполнена

/**
 * AUTO-COLOR: цвет определяется АВТОМАТИЧЕСКИ по данным записи.
 * Дима не должен ничего выбирать вручную — система сама понимает.
 *
 * Приоритет (сверху вниз, первое совпадение побеждает):
 *   1. cancelled → красный
 *   2. event/personal → серый (задача для команды)
 *   3. completed → приглушённый серый
 *   4. in_progress → зелёный (команда работает)
 *   5. нет адреса → ЖЁЛТЫЙ (⚠ нужно получить адрес!)
 *   6. коммерция (office/restaurant/shop) → оранжевый (другая лестница!)
 *   7. предварительная (дата > 30 дней) → голубой пунктир
 *   8. прошлая но не выполнена → серый выцветший
 *   9. обычная запись → синий
 */
// Commercial property types — team needs a different ladder + other
// gear than a residential visit. Kept as strings to avoid a cyclic
// import of PropertyType from clients.ts (clients imports appointments
// for its Appointment type).
const COMMERCIAL_PROPERTY_TYPES = ["office", "restaurant", "shop"] as const;

export function getAppointmentColorKind(
  apt: Appointment,
  _validation: ValidationResult,
  now: Date = new Date(),
  clientPropertyType?: string | null
): AppointmentColorKind {
  if (apt.status === "cancelled") return "cancelled";
  if (apt.kind === "event" || apt.kind === "personal") return "event";
  if (apt.status === "completed") return "completed";
  if (apt.status === "in_progress") return "in_progress";

  // Past but never completed — faded
  const aptDate = new Date(`${apt.date}T${apt.time_end}:00`);
  if (aptDate.getTime() < now.getTime()) return "past";

  // No address = YELLOW WARNING — the most common pain point.
  // Dima forgets to follow up, team doesn't know where to go.
  if (!apt.address || apt.address.trim().length < 3) return "no_address";

  // Commercial property — team needs different ladder + equipment.
  // Checked before `tentative` so a far-out office visit still gets
  // the orange warning (equipment matters more than tentative-ness).
  if (
    clientPropertyType &&
    (COMMERCIAL_PROPERTY_TYPES as readonly string[]).includes(clientPropertyType)
  ) {
    return "commercial";
  }

  // Tentative — appointment more than 30 days away, probably
  // a "come back in November" booking that needs confirmation.
  const daysUntil = (aptDate.getTime() - now.getTime()) / 86400000;
  if (daysUntil > 30) return "tentative";

  return "scheduled";
}

export const COLOR_KIND_TAILWIND: Record<
  AppointmentColorKind,
  { bg: string; border: string; text: string }
> = {
  scheduled: {
    // Forest green — клиент записан, адрес известен, всё готово.
    // Primary accent of the Old Money palette; reads as "confirmed".
    bg: "bg-[var(--accent)]",
    border: "border-[var(--accent-pressed)]",
    text: "text-[var(--label-on-accent)]",
  },
  commercial: {
    // Warm gold — office/restaurant/shop. Team: bring commercial ladder!
    bg: "bg-[var(--system-orange)]",
    border: "border-[var(--system-orange)]",
    text: "text-[var(--label-on-accent)]",
  },
  no_address: {
    // Mustard — ADDRESS MISSING! Still warm, still stands out.
    bg: "bg-[var(--system-yellow)]",
    border: "border-[var(--system-yellow)]",
    text: "text-[var(--label)]",
  },
  tentative: {
    // Muted mint — предварительная запись (>30 дней вперёд, требует
    // подтверждения). Calmer than in_progress to signal future.
    bg: "bg-[var(--system-mint)]",
    border: "border-[var(--system-teal)]",
    text: "text-[var(--label-on-accent)]",
  },
  completed: {
    // Taupe — done, faded so it doesn't distract from today's work.
    bg: "bg-[var(--fill-secondary)]",
    border: "border-[var(--separator-opaque)]",
    text: "text-[var(--label-secondary)]",
  },
  cancelled: {
    // Burgundy — отменена. Line-through applied in the block component.
    bg: "bg-[var(--system-red)]",
    border: "border-[var(--system-red)]",
    text: "text-[var(--label-on-accent)]",
  },
  in_progress: {
    // Sage green — team is ON SITE working right now.
    bg: "bg-[var(--system-green)]",
    border: "border-[var(--system-green)]",
    text: "text-[var(--label-on-accent)]",
  },
  event: {
    // Plum — internal task: "buy supplies", "team meeting".
    bg: "bg-[var(--system-purple)]",
    border: "border-[var(--system-purple)]",
    text: "text-[var(--label-on-accent)]",
  },
  past: {
    // Dusty navy — время записи прошло, но команда ещё не отметила
    // выполнение. Separate hue from completed (taupe) and scheduled
    // (forest) so «надо добить» reads instantly.
    bg: "bg-[var(--system-blue)]",
    border: "border-[var(--system-blue)]",
    text: "text-[var(--label-on-accent)]",
  },
};

// ─── SMS reminder helpers ──────────────────────────────────────────────

export const REMINDER_OFFSET_OPTIONS: { label: string; value: number }[] = [
  { label: "за 24ч", value: 1440 },
  { label: "за 12ч", value: 720 },
  { label: "за 6ч", value: 360 },
  { label: "за 3ч", value: 180 },
  { label: "за 1ч", value: 60 },
  { label: "за 30мин", value: 30 },
  { label: "за 15мин", value: 15 },
];

// Render SMS preview text by substituting {name}, {date}, {time}, {address}.
// Safe to call with partial context — missing placeholders stay as-is so the
// user sees which variables are unresolved.
export function renderReminderPreview(
  template: string,
  ctx: { name?: string; date?: string; time?: string; address?: string }
): string {
  return template
    .replace(/\{name\}/g, ctx.name || "{name}")
    .replace(/\{date\}/g, ctx.date || "{date}")
    .replace(/\{time\}/g, ctx.time || "{time}")
    .replace(/\{address\}/g, ctx.address || "{address}");
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

export function createPayment(method: PaymentMethod, amount: number): Payment {
  return {
    id: generateId("pay"),
    method,
    amount,
    paid_at: new Date().toISOString(),
  };
}

// ─── STORY-060 §F1.3 ───────────────────────────────────────────────
// Unified appointment selectors. Used by the dashboard grid, the
// date-picker dots, and /dashboard/unclosed so the three consumers
// can never drift on a record (the bug that surfaced "Анна Петрова,
// 15.05 11:00 visible in unclosed + dot but missing from grid").
//
// Dates are compared as YYYY-MM-DD strings — string-lex matches the
// chronological order for ISO dates and avoids the TZ pitfalls of
// `new Date()` inside a hot path.

export interface AppointmentRangeFilters {
  /** undefined = no team filter (combined view); null = personal tab
   *  (master_id set AND team_id null); string = strict team match. */
  teamId?: string | null;
  /** Narrows the personal-tab subset to a single master's events. */
  masterId?: string | null;
  /** Default false. Ignored when `includeStatuses` is provided. */
  includeCancelled?: boolean;
  /** Explicit allow-list of statuses. Overrides `includeCancelled`. */
  includeStatuses?: AppointmentStatus[];
}

function matchesFilters(
  apt: Appointment,
  filters: AppointmentRangeFilters | undefined,
): boolean {
  if (!filters) {
    return apt.status !== "cancelled";
  }
  if (filters.includeStatuses && filters.includeStatuses.length > 0) {
    if (!filters.includeStatuses.includes(apt.status)) return false;
  } else if (apt.status === "cancelled" && !filters.includeCancelled) {
    return false;
  }
  if (filters.teamId === null) {
    // Personal scope: master_id set AND team_id null.
    if (!apt.master_id) return false;
    if (apt.team_id) return false;
    if (filters.masterId !== undefined && apt.master_id !== filters.masterId) {
      return false;
    }
  } else if (filters.teamId !== undefined) {
    if (apt.team_id !== filters.teamId) return false;
  }
  return true;
}

/** STORY-060 §F1.3 — single source of truth for "appointments in
 *  this window". Inclusive on both ends. Sorted by (date, time). */
export function getAppointmentsForRange(
  all: Appointment[],
  fromYmd: string,
  toYmd: string,
  filters?: AppointmentRangeFilters,
): Appointment[] {
  const lo = fromYmd <= toYmd ? fromYmd : toYmd;
  const hi = fromYmd <= toYmd ? toYmd : fromYmd;
  const out = all.filter(
    (a) => a.date >= lo && a.date <= hi && matchesFilters(a, filters),
  );
  out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.time_start < b.time_start ? -1 : a.time_start > b.time_start ? 1 : 0;
  });
  return out;
}

/** STORY-060 §F1.3 — single-day variant. */
export function getAppointmentsByDate(
  all: Appointment[],
  ymd: string,
  filters?: AppointmentRangeFilters,
): Appointment[] {
  return getAppointmentsForRange(all, ymd, ymd, filters);
}

/** STORY-060 §F1.3 — date → count, for date-picker dot indicators.
 *  Days with zero appointments are omitted from the map; callers
 *  should `map.get(ymd) ?? 0`. */
export function getDatesWithAppointments(
  all: Appointment[],
  fromYmd: string,
  toYmd: string,
  filters?: AppointmentRangeFilters,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const a of all) {
    if (!matchesFilters(a, filters)) continue;
    if (a.date < fromYmd || a.date > toYmd) continue;
    result.set(a.date, (result.get(a.date) ?? 0) + 1);
  }
  return result;
}
