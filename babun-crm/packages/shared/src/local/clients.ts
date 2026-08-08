// Clients data layer — balance, discount, tags, analytics segmentation.

import { generateId } from "./masters";

// STORY-036: client ids must be uuid-shaped because the canonical
// store is now Supabase (clients.id is uuid pk). `crypto.randomUUID`
// is available in every browser we ship to + Node 19+. Falls back to
// the legacy `cli-…` id only in environments where crypto is missing
// (very old browsers, certain SSR contexts) — those clients won't
// round-trip to Supabase but will at least stay readable in
// localStorage.
function newClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return generateId("cli");
}
import { getDebtAmount, type Appointment } from "./appointments";
import { MOCK_CLIENTS, type MockClient } from "./mock/seed";

export interface ClientTag {
  id: string;
  name: string;
  color: string;
}

/**
 * Acquisition channel — how did the client find us.
 * Inspired by Monica's "how_we_met" model, adapted for service businesses.
 */
export type AcquisitionSource =
  | "referral" // друг/знакомый привёл
  | "instagram"
  | "whatsapp"
  | "google_maps"
  | "website"
  | "repeat" // повторный клиент
  | "walk_in" // «просто проезжали мимо»
  | "other"
  | "unknown";

export const ACQUISITION_LABELS: Record<AcquisitionSource, string> = {
  referral: "Рекомендация",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  google_maps: "Google Maps",
  website: "Сайт",
  repeat: "Повторный",
  walk_in: "Проездом",
  other: "Другое",
  unknown: "Неизвестно",
};

export type PropertyType = "apartment" | "house" | "office" | "restaurant" | "shop" | "other";

export const PROPERTY_LABELS: Record<PropertyType, string> = {
  apartment: "Квартира",
  house: "Дом",
  office: "Офис",
  restaurant: "Ресторан",
  shop: "Магазин",
  other: "Другое",
};

export type ACType = "split" | "ducted" | "cassette";

export const AC_TYPE_LABELS: Record<ACType, string> = {
  split: "Сплит",
  ducted: "Канальный",
  cassette: "Кассетный",
};

/** Порядок типов в выборе — от самого частого. Живёт рядом с подписями,
 *  чтобы мобила и веб предлагали один и тот же список в одном порядке. */
export const AC_TYPE_ORDER: ACType[] = ["split", "ducted", "cassette"];

/** Что подставить в «Адрес» заявки при выборе объекта. Поле заявки принимает
 *  и текст, и ссылку на карту, поэтому присланный пин честнее подписи: по
 *  «Дом» бригада никуда не доедет, а по ссылке — доедет. Подпись остаётся
 *  последним фолбэком, чтобы адрес заявки не был пустым. */
export function locationAddressForBooking(loc: {
  address?: string;
  mapUrl?: string;
  label?: string;
}): string {
  return (
    loc.address?.trim() || loc.mapUrl?.trim() || loc.label?.trim() || ""
  );
}

/** Позиция НА ОБЪЕКТЕ — то, что обслуживают повторно: кондиционер, пылесос,
 *  бассейн, автомобиль, зона уборки. Продукт продаётся не только
 *  кондиционерщикам (владелец 2026-08-06), поэтому здесь НЕТ ни закрытого
 *  списка типов, ни «внутреннего/внешнего блока»: тип — свободное слово
 *  бизнеса, а смысл уровня — график обслуживания и напоминание «пора». */
export interface ACUnit {
  id: string;
  /** Где стоит: комната, этаж, участок. Необязательно. */
  room: string;
  brand?: string;
  model?: string;
  /** Слово бизнеса: «Сплит», «Пылесос», «Бассейн». Пусто — тип не важен. */
  type_name?: string;
  /** @deprecated Наследие HVAC-версии: закрытый список сплит/канальный/
   *  кассетный. Больше не пишется и не показывается; читается только чтобы
   *  перенести старое значение в `type_name`. */
  ac_type?: ACType;
  /** @deprecated Внутренний/внешний блок — устройство кондиционера, у
   *  пылесоса или маникюрного стола такого нет. */
  has_indoor?: boolean;
  /** @deprecated см. has_indoor. */
  has_outdoor?: boolean;
  /** Beta #49 (CRM Core brief) — equipment service schedule. When
   *  `service_interval_months` is set, the system computes
   *  `next_service_date = max(installed_at, last_service_at) +
   *  interval` and flags the unit as «пора обслуживать» when the
   *  due date is within ≤ 14 days. */
  installed_at?: string;        // YYYY-MM-DD
  last_service_at?: string;     // YYYY-MM-DD
  service_interval_months?: number;
}

export interface ClientNote {
  id: string;
  text: string;
  created_at: string;
}

// ─── Client locations (objects) ────────────────────────────────────────
// Один клиент может иметь несколько объектов — дом, офис, вилла —
// со своим адресом и **своим оборудованием**. v309: equipment
// переехало с клиента на объект, потому что у одной семьи может
// быть 3 кондея в квартире и 5 в офисе — это разное оборудование
// одного и того же клиента.
export interface Location {
  id: string;
  label: string;         // "Дом", "Офис", "Вилла"
  address: string;
  /** P0 #6 (CRM Core brief) — per-object property type so a client
   *  with «дом + офис» doesn't have to repurpose one global
   *  client.property_type. Optional + additive: old localStorage
   *  rows that don't have this field read as `undefined`, which the
   *  shared `<ObjectFormFields />` treats as «not picked yet». */
  property_type?: PropertyType;
  /** MEGA-UPDATE: ссылка на Google Maps / Apple Maps.
   *  Когда задана — кнопка «Навигация» ведёт по ссылке (точнее,
   *  клиент мог прислать нестандартный pin). Без неё —
   *  google.com/maps/dir по текстовому адресу. */
  mapUrl?: string;
  isPrimary: boolean;    // первый объект для автовыбора
  /** v309 — заметка к объекту, видна команде у порога:
   *  «зелёная дверь, домофон 25», «снимать обувь», «собака во дворе». */
  note?: string;
  /** v309 — A/C юниты на этом объекте. До v309 хранилось на клиенте;
   *  миграция переносит client.equipment → locations[primary].equipment. */
  equipment?: ACUnit[];
  /** РЕГУЛЯРНОЕ ОБСЛУЖИВАНИЕ ОБЪЕКТА, В МЕСЯЦАХ (2026-08-07).
   *
   *  Клининг раз в месяц, бассейн раз в месяц, кондиционеры раз в полгода —
   *  регулярность есть у ОБЪЕКТА, а не у техники на нём. Прежний график ТО
   *  жил на юнитах с брендами и моделями: для клининга или бьюти это был
   *  пустой раздел с чужими словами, и вместе с юнитами он ушёл.
   *
   *  Срок считается от ПОСЛЕДНЕГО ВИЗИТА на этот объект — календарь и так
   *  это знает, поэтому отдельного поля «когда обслужили» нет: его
   *  невозможно забыть проставить. Пусто/0 — не регулярный объект. */
  serviceEveryMonths?: number;
}

export interface PhoneEntry {
  id: string;
  number: string;
  /** "Основной", "WhatsApp", "Жена", "Рабочий" etc. */
  label: string;
  /** v309 — имя контакта на этом номере. Реальный сценарий: одна
   *  карточка клиента, основной — муж, второй номер — «Жена · Мария».
   *  Для отображения в строке и подстановки в SMS-обращение. */
  name?: string;
}

export interface Client {
  id: string;
  full_name: string;
  phone: string;
  /** Дополнительные номера — супруг(а), арендатор, помощник, рабочий, WhatsApp на другом номере. */
  phones: PhoneEntry[];
  /** Если WhatsApp зарегистрирован на другой номер, не основной. */
  whatsapp_phone: string;
  email: string;
  sms_name: string;
  telegram_username: string;
  instagram_username: string;
  balance: number;
  discount: number;
  comment: string;
  tag_ids: string[];
  acquisition_source: AcquisitionSource;
  referred_by_client_id: string | null;
  first_contact_date: string | null;
  address: string;
  /** Метка клиента — имя из библиотеки меток Кабинета (cities). Пишется
   *  автоматически из метки дня при записи, пока не выбрана вручную. */
  city: string;
  /** true — метку выбрали руками, автоприсвоение её не перезаписывает.
   *  «Убрать метку» сбрасывает во false (возврат в авто-режим). */
  city_manual?: boolean;
  property_type: PropertyType | "";
  /** DEPRECATED with v309 — equipment moved onto Location. Field kept
   *  for legacy reads; `loadClients` migrates into the primary
   *  location's `equipment` array on first load. */
  equipment: ACUnit[];
  /** v309 — язык клиента для SMS-шаблонов (ru/en/el на Кипре чаще всего). */
  /** Объекты клиента (дом/офис/вилла) — новое поле для STORY-002.
   *  Если у клиента несколько объектов, при записи явно выбирается
   *  один. Legacy-поле `address` оставлено для миграции. */
  locations: Location[];
  notes: ClientNote[];
  /** YYYY-MM-DD, empty = unknown. */
  birthday: string;
  /** Блокировка: клиент в чёрном списке. */
  blacklisted: boolean;
  /** v313 — закреплён вверху списка. ISO timestamp когда закрепили. */
  pinned_at?: string | null;
  /** v313 — отметка «напомнить про клиента» (ISO). Когда наступит,
   *  должно сработать push-уведомление; для launch-MVP просто
   *  отображается на карточке. */
  reminder_at?: string | null;
  /** clients-99: canonical E.164 phone for dedup + indexing. NULL
   *  until the row is touched by a libphonenumber-aware writer. */
  phone_e164?: string | null;
  /** clients-99: optional avatar image. Empty/null → fall back to
   *  deterministic initials. */
  avatar_url?: string | null;
  /** Клиент убран из рабочего списка. NULL = живой.
   *
   *  ДВА СОСТОЯНИЯ НЕВИДИМОСТИ различаются ПАРОЙ полей, а не отдельной
   *  таблицей — клиент остаётся клиентом со своей историей:
   *    deleted_at есть, purge_at пуст  → АРХИВ, бессрочно;
   *    deleted_at есть, purge_at стоит → КОРЗИНА, сотрётся в эту дату. */
  deleted_at?: string | null;
  /** Дата полного стирания (корзина «Недавно удалённые», 30 дней как в
   *  Фото на iPhone). Чистит ночное задание purge_expired_clients.
   *  У активных и у архивных — NULL. */
  purge_at?: string | null;
  /** clients-99: tenant_state master id. No FK on DB because masters
   *  live in tenant_state, not a physical table. */
  favorite_master_id?: string | null;
  created_at: string;
}

export const DEFAULT_TAGS: ClientTag[] = [
  { id: "tag-vip", name: "VIP", color: "#f59e0b" },
  { id: "tag-regular", name: "Постоянный", color: "#10b981" },
  { id: "tag-new", name: "Новый", color: "#3b82f6" },
  { id: "tag-problem", name: "Проблемный", color: "#ef4444" },
];

const CLIENTS_KEY = "babun-clients";
const TAGS_KEY = "babun-client-tags";

// STORY-002: демо-набор multi-location клиентов для показа
// LocationPicker. Keyed by MOCK_CLIENTS id. Сид только для новых
// установок (когда localStorage пуст) — не навязывает реальным
// данным.
const DEMO_LOCATIONS: Record<string, Location[]> = {
  "5": [
    {
      id: "loc-5-home",
      label: "Дом",
      address: "Лимассол, Agios Tychonas 21",
      isPrimary: true,
    },
    {
      id: "loc-5-office",
      label: "Офис",
      address: "Лимассол, Makarios Ave 134",
      isPrimary: false,
    },
  ],
  "12": [
    {
      id: "loc-12-villa",
      label: "Вилла",
      address: "Пафос, Coral Bay 8",
      isPrimary: true,
    },
    {
      id: "loc-12-office",
      label: "Офис",
      address: "Пафос, Mesogis 45",
      isPrimary: false,
    },
    {
      id: "loc-12-flat",
      label: "Квартира",
      address: "Пафос, Posidonos 12",
      isPrimary: false,
    },
  ],
};

function mockToClient(m: MockClient): Client {
  const demo = DEMO_LOCATIONS[m.id];
  return {
    id: m.id,
    full_name: m.full_name,
    phone: m.phone,
    phones: [],
    whatsapp_phone: "",
    email: "",
    sms_name: m.sms_name,
    telegram_username: "",
    instagram_username: "",
    balance: m.balance,
    discount: m.discount,
    comment: m.comment,
    tag_ids: [],
    acquisition_source: "unknown",
    referred_by_client_id: null,
    first_contact_date: null,
    address: "",
    city: "",
    property_type: "",
    equipment: [],
    locations: demo ?? [
      {
        id: generateId("loc"),
        label: "Основной",
        address: "",
        isPrimary: true,
      },
    ],
    notes: [],
    birthday: "",
    blacklisted: false,
    phone_e164: null,
    avatar_url: null,
    deleted_at: null,
    purge_at: null,
    favorite_master_id: null,
    created_at: new Date().toISOString(),
  };
}

export function loadClients(): Client[] {
  // STORY-072 leak fix — never auto-seed MOCK_CLIENTS on empty load.
  // Those records are AirFix-specific demo data ("Григорьев Олег",
  // "Захарова Ирина" etc); a fresh tenant signing up MUST start with
  // an empty list. Demo data still loadable explicitly from
  // Settings → Account → "Загрузить демо-данные" (DemoDataSection).
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CLIENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [];
    }
    // Lightweight migration for fields added after records were stored
    return parsed.map((c: Partial<Client>) => {
      const equipmentLegacy = (c.equipment ?? []).map((u: Partial<ACUnit>) => ({
        ...u,
        // Старый жёсткий тип переносим в свободное слово ОДИН РАЗ при
        // чтении: «сплит» у клинингового пылесоса был чистой выдумкой.
        type_name: u.type_name ?? (u.ac_type ? AC_TYPE_LABELS[u.ac_type] : undefined),
      })) as ACUnit[];
      // STORY-002 migration: legacy single-address clients get a
      // one-location array inferred from their stored address.
      const baseLocations: Location[] =
        c.locations && c.locations.length > 0
          ? c.locations.map((l) => ({
              id: l.id,
              label: l.label,
              address: l.address,
              mapUrl: l.mapUrl,
              isPrimary: l.isPrimary,
              note: l.note,
              equipment: l.equipment,
            }))
          : [
              {
                id: generateId("loc"),
                label: "Основной",
                address: c.address ?? "",
                isPrimary: true,
              },
            ];
      // v309 migration: if any legacy equipment exists on the client
      // and no location yet has equipment, move it onto the primary
      // location. Subsequent loads see equipment already on locations
      // and skip the move silently.
      const anyLocHasEquipment = baseLocations.some(
        (l) => (l.equipment ?? []).length > 0,
      );
      const migratedLocations = baseLocations.map((l) => ({
        ...l,
        equipment: l.equipment ?? [],
      }));
      if (!anyLocHasEquipment && equipmentLegacy.length > 0) {
        const primaryIdx = migratedLocations.findIndex((l) => l.isPrimary);
        const targetIdx = primaryIdx >= 0 ? primaryIdx : 0;
        migratedLocations[targetIdx] = {
          ...migratedLocations[targetIdx],
          equipment: equipmentLegacy,
        };
      }
      return {
        ...c,
        email: c.email ?? "",
        telegram_username: c.telegram_username ?? "",
        instagram_username: c.instagram_username ?? "",
        property_type: c.property_type ?? "",
        equipment: equipmentLegacy,
        notes: c.notes ?? [],
        birthday: c.birthday ?? "",
        blacklisted: c.blacklisted ?? false,
        pinned_at: c.pinned_at ?? null,
        reminder_at: c.reminder_at ?? null,
        phones: c.phones ?? [],
        whatsapp_phone: c.whatsapp_phone ?? "",
        phone_e164: c.phone_e164 ?? null,
        avatar_url: c.avatar_url ?? null,
        deleted_at: c.deleted_at ?? null,
        purge_at: c.purge_at ?? null,
        favorite_master_id: c.favorite_master_id ?? null,
        locations: migratedLocations,
      };
    }) as Client[];
  } catch {
    // STORY-078 leak fix — corrupt localStorage previously fell back
    // to MOCK_CLIENTS (AirFix demo names). Empty list is safer.
    return [];
  }
}

export function saveClients(list: Client[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLIENTS_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

// STORY-007: single-write helper callable from outside the dashboard
// context (e.g. ClientPickerSheet) that also dispatches
// babun:clients-changed so the layout's reactive clients state picks
// up the new record without waiting for the next [appointments] tick.
export function upsertClient(client: Client): void {
  const existing = loadClients();
  const next = existing.filter((c) => c.id !== client.id);
  next.push(client);
  saveClients(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("babun:clients-changed"));
  }
}

export function loadClientTags(): ClientTag[] {
  // STORY-079 leak fix — DEFAULT_TAGS (VIP / Постоянный / Новый /
  // Проблемный) were leaking RU labels into every new tenant. The
  // Postgres trigger handle_new_user() now seeds the same four tags
  // into the `client_tags` table per-tenant, so the localStorage
  // layer can default to empty.
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TAGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveClientTags(list: ClientTag[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TAGS_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export function createBlankClient(overrides: Partial<Client> = {}): Client {
  return {
    id: newClientId(),
    full_name: "",
    phone: "",
    phones: [],
    whatsapp_phone: "",
    email: "",
    sms_name: "",
    telegram_username: "",
    instagram_username: "",
    balance: 0,
    discount: 0,
    comment: "",
    tag_ids: [],
    acquisition_source: "unknown",
    referred_by_client_id: null,
    first_contact_date: new Date().toISOString().slice(0, 10),
    address: "",
    city: "",
    property_type: "",
    equipment: [],
    // STORY-007: no seed location. Addresses live on each appointment's
    // location and are captured when the dispatcher actually has them.
    locations: [],
    notes: [],
    birthday: "",
    blacklisted: false,
    pinned_at: null,
    reminder_at: null,
    phone_e164: null,
    avatar_url: null,
    deleted_at: null,
    purge_at: null,
    favorite_master_id: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Alphabetical grouping ─────────────────────────────────────────────

export interface ClientGroup {
  letter: string;
  clients: Client[];
}

export function groupClientsByLetter(clients: Client[]): ClientGroup[] {
  const map = new Map<string, Client[]>();
  for (const c of clients) {
    const first = (c.full_name.trim()[0] || "#").toUpperCase();
    const letter = /[A-ZА-ЯЁ]/.test(first) ? first : "#";
    if (!map.has(letter)) map.set(letter, []);
    map.get(letter)!.push(c);
  }
  const sorted = Array.from(map.entries()).sort(([a], [b]) => {
    if (a === "#") return 1;
    if (b === "#") return -1;
    return a.localeCompare(b, "ru");
  });
  return sorted.map(([letter, clients]) => ({
    letter,
    clients: clients.sort((a, b) => a.full_name.localeCompare(b.full_name, "ru")),
  }));
}

// ─── Analytics segmentation ────────────────────────────────────────────

export type ClientSegment =
  | "all"
  | "active" // has record in future or last 3 months
  | "sleeping" // had records, none in future or last 3 months
  | "lost" // no records in last 6 months
  | "new" // first record in future or last 30 days
  | "upcoming" // has future records
  | "single" // only 1 record ever
  | "none" // never booked (no records) or all cancelled
  | "debtors" // negative balance
  | "prepaid" // positive balance
  | "discounted"; // has discount

export interface SegmentStats {
  segment: ClientSegment;
  label: string;
  count: number;
  percent: number;
  clients: Client[];
}

export const SEGMENT_LABELS: Record<ClientSegment, string> = {
  all: "Все клиенты",
  active: "Активные",
  sleeping: "Спящие",
  lost: "Потерянные",
  new: "Новые",
  upcoming: "С предстоящими записями",
  single: "С одной записью",
  none: "Без записей",
  debtors: "Должники",
  prepaid: "С предоплатой",
  discounted: "Со скидкой",
};

function daysAgoDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function dateKeyToDate(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

function clientAppointments(
  client: Client,
  appointments: Appointment[]
): Appointment[] {
  return appointments.filter(
    (a) => a.client_id === client.id && a.status !== "cancelled"
  );
}

/**
 * Sum of outstanding debts across every completed appointment belonging
 * to a client. Debts are derived (not stored) — `max(0, total - paid)`
 * per appointment. A full first-class ClientDebt table lands with the
 * Supabase migration; this helper is the single source until then.
 */
export function getClientDebt(
  clientId: string,
  appointments: Appointment[]
): number {
  let total = 0;
  for (const apt of appointments) {
    if (apt.client_id !== clientId) continue;
    if (apt.status !== "completed") continue;
    total += getDebtAmount(apt);
  }
  return Math.round(total);
}

export function segmentClient(
  client: Client,
  appointments: Appointment[],
  now: Date = new Date()
): ClientSegment[] {
  const segments: ClientSegment[] = ["all"];
  const apts = clientAppointments(client, appointments);
  const dates = apts.map((a) => dateKeyToDate(a.date)).sort((a, b) => a.getTime() - b.getTime());

  const threeMonthsAgo = daysAgoDate(90);
  const sixMonthsAgo = daysAgoDate(180);
  const thirtyDaysAgo = daysAgoDate(30);

  const hasFuture = dates.some((d) => d.getTime() >= now.getTime());
  const hasAny = dates.length > 0;
  const mostRecent = dates[dates.length - 1];
  const earliest = dates[0];

  if (!hasAny) {
    segments.push("none");
  } else {
    // Active: any future OR any in last 3 months
    if (hasFuture || (mostRecent && mostRecent >= threeMonthsAgo)) {
      segments.push("active");
    }
    // Sleeping: has records, no future and no last-3-months
    else if (mostRecent && mostRecent < threeMonthsAgo) {
      segments.push("sleeping");
    }
    // Lost: no records in last 6 months
    if (mostRecent && mostRecent < sixMonthsAgo && !hasFuture) {
      segments.push("lost");
    }
    // New: earliest in future or last 30 days
    if (earliest && (earliest >= thirtyDaysAgo || earliest >= now)) {
      segments.push("new");
    }
    if (hasFuture) segments.push("upcoming");
    if (dates.length === 1) segments.push("single");
  }

  if (client.balance < 0) segments.push("debtors");
  if (client.balance > 0) segments.push("prepaid");
  if (client.discount > 0) segments.push("discounted");

  return segments;
}

/** Attribution breakdown by acquisition source. */
export interface AcquisitionStats {
  source: AcquisitionSource;
  label: string;
  count: number;
  percent: number;
}

export function computeAcquisitionStats(clients: Client[]): AcquisitionStats[] {
  const map = new Map<AcquisitionSource, number>();
  for (const c of clients) {
    map.set(c.acquisition_source, (map.get(c.acquisition_source) ?? 0) + 1);
  }
  const total = clients.length || 1;
  return (Object.keys(ACQUISITION_LABELS) as AcquisitionSource[])
    .map((source) => {
      const count = map.get(source) ?? 0;
      return {
        source,
        label: ACQUISITION_LABELS[source],
        count,
        percent: Math.round((count / total) * 100),
      };
    })
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function computeSegmentStats(
  clients: Client[],
  appointments: Appointment[]
): SegmentStats[] {
  const now = new Date();
  const segmentMap = new Map<ClientSegment, Client[]>();
  for (const seg of Object.keys(SEGMENT_LABELS) as ClientSegment[]) {
    segmentMap.set(seg, []);
  }

  for (const client of clients) {
    const segs = segmentClient(client, appointments, now);
    for (const seg of segs) {
      segmentMap.get(seg)!.push(client);
    }
  }

  const total = clients.length || 1;
  return (Object.keys(SEGMENT_LABELS) as ClientSegment[]).map((segment) => {
    const list = segmentMap.get(segment) ?? [];
    return {
      segment,
      label: SEGMENT_LABELS[segment],
      count: list.length,
      percent: Math.round((list.length / total) * 100),
      clients: list,
    };
  });
}
