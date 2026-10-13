// Clients data layer — форма клиента, объекты, техника и долг по записям.

import { generateId } from "./masters";
import { getDebtAmount, type Appointment } from "./appointments";

import type {
  AcquisitionSource,
  ACType,
  Client,
  ClientMembership,
  PropertyType,
} from "./clients/types";

export type {
  AcquisitionSource,
  ACType,
  ACUnit,
  AddressParts,
  Client,
  ClientContactsHidden,
  ClientMembership,
  ClientNote,
  ClientRequisites,
  ClientSourceValue,
  ClientTag,
  Location,
  PhoneEntry,
  PropertyType,
} from "./clients/types";

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

export const PROPERTY_LABELS: Record<PropertyType, string> = {
  apartment: "Квартира",
  house: "Дом",
  office: "Офис",
  restaurant: "Ресторан",
  shop: "Магазин",
  other: "Другое",
};

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

/** Связи клиента; у старых объектов — пусто. */
export function clientMemberships(
  client: Pick<Client, "memberships">,
): ClientMembership[] {
  return Array.isArray(client.memberships) ? client.memberships : [];
}

export function createBlankClient(overrides: Partial<Client> = {}): Client {
  return {
    id: newClientId(),
    full_name: "",
    phone: "",
    memberships: [],
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
