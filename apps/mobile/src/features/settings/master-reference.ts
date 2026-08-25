import type { Database, Json } from "@babun/shared/db/database.types";
import type { Client } from "@babun/shared/local/clients";

type Service = Database["public"]["Tables"]["services"]["Row"];
type Team = Database["public"]["Tables"]["teams"]["Row"];
type Master = Database["public"]["Tables"]["masters"]["Row"];

type JsonRecord = Record<string, Json | undefined>;

function record(value: Json): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Сервер вернул некорректные рабочие данные");
  }
  return value as JsonRecord;
}

function requiredString(row: JsonRecord, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error("Сервер вернул некорректные рабочие данные");
  }
  return value;
}

/** Число из проекции или дефолт: старый сервер мог не прислать колонку. */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableString(row: JsonRecord, key: string): string | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new Error("Сервер вернул некорректные рабочие данные");
  }
  return value;
}

function requiredBoolean(row: JsonRecord, key: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") {
    throw new Error("Сервер вернул некорректные рабочие данные");
  }
  return value;
}

function requiredNumber(row: JsonRecord, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Сервер вернул некорректные рабочие данные");
  }
  return value;
}

function nullableNumber(row: JsonRecord, key: string): number | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Сервер вернул некорректные рабочие данные");
  }
  return value;
}

function nullableBoolean(row: JsonRecord, key: string): boolean | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value !== "boolean") {
    throw new Error("Сервер вернул некорректные рабочие данные");
  }
  return value;
}

/** Minimal client identity needed on an assigned job. No finance, tags,
 * internal notes, social handles, birthday, blacklist or secondary contacts. */
export function masterClientJsonToClient(value: Json): Client {
  const row = record(value);
  requiredString(row, "tenant_id");
  return {
    id: requiredString(row, "id"),
    full_name: requiredString(row, "full_name"),
    phone: requiredString(row, "phone"),
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
    first_contact_date: null,
    address: "",
    city: "",
    property_type: "",
    equipment: [],
    locations: [],
    notes: [],
    birthday: "",
    blacklisted: false,
    pinned_at: null,
    reminder_at: null,
    phone_e164: null,
    avatar_url: null,
    deleted_at: null,
    favorite_master_id: null,
    created_at: requiredString(row, "created_at"),
  };
}

/** Name/color-only service row. Every price, cost and tier is overwritten so
 * an accidental SQL projection change cannot expose service economics. */
export function masterServiceJsonToService(value: Json): Service {
  const row = record(value);
  return {
    id: requiredString(row, "id"),
    tenant_id: requiredString(row, "tenant_id"),
    // Описание мастеру НЕ отдаётся: оно печатается в счёте, а бумаг мастер не
    // выставляет — проекция его и не возвращает.
    description: null,
    // Команда-владелец нужна мастеру не ради прав, а ради каталога: услуга
    // принадлежит ровно одной команде (2026-08-17).
    team_id: requiredString(row, "team_id"),
    name: requiredString(row, "name"),
    color: requiredString(row, "color"),
    category_id: null,
    duration_minutes: 0,
    price: 0,
    // ЕДИНИЦА — ЕДИНСТВЕННОЕ ЧИСЛО-ПОДПИСЬ, КОТОРОЕ МАСТЕР ВИДИТ. Количество
    // в наряде без неё читается как «4 чего?». В расчётах она не участвует
    // нигде, поэтому экономикой не является и проекцию не открывает.
    unit: nullableString(row, "unit"),
    // Режим показа чисел — вопрос владельца к самому себе; мастеру числа не
    // показывают вовсе, значит и режим ему не нужен.
    price_entry: "total",
    // ПЛАНИРОВАНИЕ МАСТЕРУ НЕ ОТДАЁМ. Буферы, состав бригады и пороги — это
    // то, как владелец считает деньги и загрузку; мастеру достаётся имя,
    // цвет и единица, чтобы прочесть наряд.
    service_type: "quantity",
    buffer_before_min: 0,
    buffer_after_min: 0,
    required_staff: 1,
    min_qty: 1,
    max_qty: null,
    overflow_price: null,
    overflow_duration_min: null,
    copied_from_service_id: null,
    available_weekdays: [],
    online_enabled: false,
    material_costs: [],
    is_active: true,
    created_at: "",
    updated_at: "",
    position: 0,
    bulk_threshold: 0,
    bulk_price: 0,
    cost_per_unit: 0,
    // Себестоимость — дело владельца: ни проекция, ни маппер её не несут.
    cost_tiers: [],
    brigade_ids: [],
    price_tiers: null,
    duration_tiers: null,
  };
}

/** Sale-side catalogue for a dispatcher. Pricing and duration tiers are
 * operational booking inputs; cost_per_unit/material_costs are overwritten
 * even if a future server projection accidentally adds them. */
export function dispatcherServiceJsonToService(value: Json): Service {
  const row = record(value);
  const priceTiers = row.price_tiers;
  const durationTiers = row.duration_tiers;
  return {
    id: requiredString(row, "id"),
    tenant_id: requiredString(row, "tenant_id"),
    team_id: requiredString(row, "team_id"),
    // Диспетчер собирает счёт — описание ему нужно.
    description: nullableString(row, "description"),
    category_id: null,
    name: requiredString(row, "name"),
    price: requiredNumber(row, "price"),
    duration_minutes: requiredNumber(row, "duration_minutes"),
    color: requiredString(row, "color"),
    price_tiers:
      priceTiers == null || Array.isArray(priceTiers) ? priceTiers ?? null : null,
    duration_tiers:
      durationTiers == null || Array.isArray(durationTiers)
        ? durationTiers ?? null
        : null,
    bulk_threshold: requiredNumber(row, "bulk_threshold"),
    bulk_price: requiredNumber(row, "bulk_price"),
    brigade_ids: [],
    is_active: requiredBoolean(row, "is_active"),
    position: requiredNumber(row, "position"),
    created_at: requiredString(row, "created_at"),
    updated_at: requiredString(row, "updated_at"),
    // Диспетчер выбирает услугу в записи и собирает счёт — он обязан видеть
    // единицу, режим показа чисел и дни, по которым услугу делают. Скрыта от
    // него по-прежнему только себестоимость.
    unit: nullableString(row, "unit"),
    price_entry: row.price_entry === "unit" ? "unit" : "total",
    // Диспетчер продаёт и записывает: ему нужны буферы (из них складывается
    // слот в календаре), пороги и правило «свыше». Себестоимость — нет.
    service_type: row.service_type === "variant" ? "variant" : "quantity",
    buffer_before_min: numberOr(row.buffer_before_min, 0),
    buffer_after_min: numberOr(row.buffer_after_min, 0),
    required_staff: numberOr(row.required_staff, 1),
    min_qty: numberOr(row.min_qty, 1),
    max_qty: row.max_qty == null ? null : numberOr(row.max_qty, 0),
    overflow_price: row.overflow_price == null ? null : numberOr(row.overflow_price, 0),
    overflow_duration_min:
      row.overflow_duration_min == null ? null : numberOr(row.overflow_duration_min, 0),
    copied_from_service_id: null,

    available_weekdays: Array.isArray(row.available_weekdays)
      ? row.available_weekdays
      : [],
    online_enabled: false,
    material_costs: [],
    cost_per_unit: 0,
    // Себестоимость — дело владельца: ни проекция, ни маппер её не несут.
    cost_tiers: [],
  };
}

/** Operational team calendar with all payout and workforce membership data
 * overwritten locally even if a future RPC accidentally includes it. */
export function operationalTeamJsonToTeam(value: Json): Team {
  const row = record(value);
  const cities = row.cities;
  return {
    id: requiredString(row, "id"),
    tenant_id: requiredString(row, "tenant_id"),
    name: requiredString(row, "name"),
    region: nullableString(row, "region"),
    color: nullableString(row, "color"),
    is_active: requiredBoolean(row, "is_active"),
    position: requiredNumber(row, "position"),
    timezone: nullableString(row, "timezone"),
    default_city: nullableString(row, "default_city"),
    cities: Array.isArray(cities) ? cities : [],
    tint_days_by_label: nullableBoolean(row, "tint_days_by_label"),
    hide_cancelled: nullableBoolean(row, "hide_cancelled"),
    allow_overtime: nullableBoolean(row, "allow_overtime"),
    appointment_blocks: row.appointment_blocks ?? null,
    buffer_minutes: nullableNumber(row, "buffer_minutes"),
    calendar_window_start: nullableString(row, "calendar_window_start"),
    calendar_window_end: nullableString(row, "calendar_window_end"),
    default_scroll_time: nullableString(row, "default_scroll_time"),
    default_slot_minutes: nullableNumber(row, "default_slot_minutes"),
    created_at: requiredString(row, "created_at"),
    updated_at: requiredString(row, "updated_at"),
    payout_percentage: 0,
    roles: [],
    members: [],
    lead_id: null,
    lead_ids: [],
    helper_ids: [],
  };
}

/** Booking picker identity for an employee. HR/profile jsonb and creator id
 * are never allowed into a dispatcher/master query cache. */
export function operationalMasterJsonToMaster(value: Json): Master {
  const row = record(value);
  return {
    id: requiredString(row, "id"),
    tenant_id: requiredString(row, "tenant_id"),
    full_name: requiredString(row, "full_name"),
    phone: nullableString(row, "phone"),
    avatar_url: nullableString(row, "avatar_url"),
    team_id: nullableString(row, "team_id"),
    role: requiredString(row, "role"),
    title: nullableString(row, "title"),
    color: nullableString(row, "color"),
    account_status: nullableString(row, "account_status"),
    is_active: requiredBoolean(row, "is_active"),
    position: requiredNumber(row, "position"),
    created_at: requiredString(row, "created_at"),
    updated_at: requiredString(row, "updated_at"),
    created_by: null,
    profile: {},
  };
}
