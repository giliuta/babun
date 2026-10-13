// Shape of an appointment and its parts (services, payments, photos).

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
  /** ПРЕДОПЛАТЫ КАК СОБЫТИЯ (STORY-066). Сумма живёт в `prepaid_amount`,
   *  здесь — откуда она: id платежа, счёт, время. Пишет только сервер
   *  (`record_appointment_payment`); старые записи и старые пути
   *  («Изменить предоплату») колонку не ведут — тогда сумма строк не сходится
   *  с `prepaid_amount`, и блок показывает одну общую строку без «Снять». */
  prepayments?: Payment[];
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
  /** НДС ЗАПИСИ (2026-09-15, миграция `appointment_vat_choice`): «с НДС» или
   *  «без НДС» для денег этой записи — сильнее счёта. null — как у счёта,
   *  команды и компании. Меняется только до первой оплаты и только дверью
   *  `set_appointment_vat_mode`: в патч записи поле не пишется. */
  vat_mode?: "on" | "off" | "none" | "inclusive" | "exclusive" | null;
  /** СТАВКА VAT ЗАПИСИ (22.09, миграция 20260922040000). Вместе с
   *  `vat_mode` 'exclusive' | 'inclusive' | 'none' — выбор «Итого» записи:
   *  «К оплате» (`total_amount`) уже включает налог, а оплата ложится на
   *  счёт с выделенным налогом по этой ставке. Старые 'on' | 'off' пишет
   *  только дверь `set_appointment_vat_mode`. */
  vat_rate?: number | null;
  /** Материалы по ценам дня закрытия — пишет только сервер
   *  (`freeze_appointment_materials`); `null` — считать по справочнику
   *  (`appointmentMaterialCostLines`). */
  material_lines?: unknown;
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
