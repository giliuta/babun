import type { Json } from "@babun/shared/db/database.types";
import type {
  Appointment,
  AppointmentKind,
  AppointmentSource,
  AppointmentStatus,
  PersonalEventRepeat,
} from "@babun/shared/local/appointments";

const KINDS = new Set<AppointmentKind>(["work", "event", "personal"]);
const STATUSES = new Set<AppointmentStatus>([
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);
const SOURCES = new Set<AppointmentSource>([
  "instagram",
  "whatsapp",
  "online",
  "phone",
  "referral",
  "repeat",
  "walk_in",
  "other",
]);

type JsonRecord = Record<string, Json | undefined>;

function asRecord(value: Json): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Сервер вернул некорректную заявку");
  }
  return value as JsonRecord;
}

function stringField(row: JsonRecord, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error("Сервер вернул некорректную заявку");
  }
  return value;
}

function nullableStringField(row: JsonRecord, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error("Сервер вернул некорректную заявку");
  }
  return value;
}

function booleanField(row: JsonRecord, key: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") {
    throw new Error("Сервер вернул некорректную заявку");
  }
  return value;
}

function nullableNumberField(row: JsonRecord, key: string): number | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Сервер вернул некорректную заявку");
  }
  return value;
}

function numberField(row: JsonRecord, key: string): number {
  const value = nullableNumberField(row, key);
  if (value === null) throw new Error("Сервер вернул некорректную заявку");
  return value;
}

function stringArray(value: Json | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberArray(value: Json | undefined): number[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is number =>
          typeof item === "number" && Number.isFinite(item),
      )
    : [];
}

function kindField(row: JsonRecord): AppointmentKind {
  const value = stringField(row, "kind") as AppointmentKind;
  if (!KINDS.has(value)) throw new Error("Сервер вернул неизвестный тип заявки");
  return value;
}

function statusField(row: JsonRecord): AppointmentStatus {
  const value = stringField(row, "status") as AppointmentStatus;
  if (!STATUSES.has(value)) {
    throw new Error("Сервер вернул неизвестный статус заявки");
  }
  return value;
}

function sourceField(row: JsonRecord): AppointmentSource | null {
  const value = nullableStringField(row, "source");
  if (value === null) return null;
  if (!SOURCES.has(value as AppointmentSource)) {
    throw new Error("Сервер вернул неизвестный источник заявки");
  }
  return value as AppointmentSource;
}

function repeatField(value: Json | undefined): PersonalEventRepeat {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "none" };
  }
  const kind = value.kind;
  if (
    kind === "none" ||
    kind === "daily" ||
    kind === "weekdays" ||
    kind === "weekly" ||
    kind === "biweekly" ||
    kind === "monthly" ||
    kind === "yearly" ||
    kind === "custom_weekdays"
  ) {
    return value as unknown as PersonalEventRepeat;
  }
  return { kind: "none" };
}

/** Rebuilds an RPC row and forces every finance field to an inert value. */
export function masterAppointmentJsonToAppointment(value: Json): Appointment {
  const row = asRecord(value);
  stringField(row, "tenant_id");
  return {
    id: stringField(row, "id"),
    created_by: nullableStringField(row, "created_by"),
    date: stringField(row, "date"),
    time_start: stringField(row, "time_start"),
    time_end: stringField(row, "time_end"),
    client_id: nullableStringField(row, "client_id"),
    location_id: nullableStringField(row, "location_id"),
    team_id: nullableStringField(row, "team_id"),
    master_id: nullableStringField(row, "master_id"),
    service_ids: stringArray(row.service_ids),
    total_amount: 0,
    custom_total: false,
    discount_amount: 0,
    expenses: [],
    service_price_overrides: {},
    prepaid_amount: 0,
    payments: [],
    payment: null,
    payment_status: "unpaid",
    payment_method: undefined,
    paid_amount: 0,
    services: [],
    global_discount: null,
    total_duration: numberField(row, "total_duration"),
    color_override: nullableStringField(row, "color_override"),
    comment: stringField(row, "comment"),
    address: stringField(row, "address"),
    address_note: stringField(row, "address_note"),
    address_lat: nullableNumberField(row, "address_lat"),
    address_lng: nullableNumberField(row, "address_lng"),
    source: sourceField(row),
    is_online_booking: booleanField(row, "is_online_booking"),
    cancel_reason: nullableStringField(row, "cancel_reason"),
    kind: kindField(row),
    photos: [],
    consent_given: booleanField(row, "consent_given"),
    reminder_enabled: booleanField(row, "reminder_enabled"),
    reminder_offsets: numberArray(row.reminder_offsets),
    reminder_template: stringField(row, "reminder_template"),
    event_all_day: booleanField(row, "event_all_day"),
    event_notes: stringField(row, "event_notes"),
    event_url: stringField(row, "event_url"),
    event_push_enabled: booleanField(row, "event_push_enabled"),
    event_push_offsets: numberArray(row.event_push_offsets),
    event_push_at: nullableStringField(row, "event_push_at"),
    event_repeat: repeatField(row.event_repeat),
    status: statusField(row),
    created_at: stringField(row, "created_at"),
    updated_at: stringField(row, "updated_at"),
  };
}
