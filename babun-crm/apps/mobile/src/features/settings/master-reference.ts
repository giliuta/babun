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
    name: requiredString(row, "name"),
    color: requiredString(row, "color"),
    category_id: null,
    duration_minutes: 0,
    price: 0,
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
    is_countable: false,
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
  const brigadeIds = row.brigade_ids;
  const priceTiers = row.price_tiers;
  const durationTiers = row.duration_tiers;
  return {
    id: requiredString(row, "id"),
    tenant_id: requiredString(row, "tenant_id"),
    category_id: nullableString(row, "category_id"),
    name: requiredString(row, "name"),
    price: requiredNumber(row, "price"),
    duration_minutes: requiredNumber(row, "duration_minutes"),
    color: requiredString(row, "color"),
    is_countable: requiredBoolean(row, "is_countable"),
    price_tiers:
      priceTiers == null || Array.isArray(priceTiers) ? priceTiers ?? null : null,
    duration_tiers:
      durationTiers == null || Array.isArray(durationTiers)
        ? durationTiers ?? null
        : null,
    bulk_threshold: requiredNumber(row, "bulk_threshold"),
    bulk_price: requiredNumber(row, "bulk_price"),
    brigade_ids: Array.isArray(brigadeIds)
      ? brigadeIds.filter((item): item is string => typeof item === "string")
      : [],
    is_active: requiredBoolean(row, "is_active"),
    position: requiredNumber(row, "position"),
    created_at: requiredString(row, "created_at"),
    updated_at: requiredString(row, "updated_at"),
    available_weekdays: [],
    online_enabled: false,
    material_costs: [],
    cost_per_unit: 0,
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
