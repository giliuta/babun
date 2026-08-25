// Clients data layer — форма клиента, объекты, техника и долг по записям.

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

/** Что подставить в «Адрес» заявки при выборе объекта. Поле заявки принимает
 *  и текст, и ссылку на карту, поэтому присланный пин честнее подписи: по
 *  «Дом» команда никуда не доедет, а по ссылке — доедет. Подпись остаётся
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
