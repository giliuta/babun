// Parsers for the immutable seller/client snapshots frozen at issue time.

import type {
  InvoiceClientSnapshot,
  InvoiceObjectAddressParts,
  InvoiceObjectSnapshot,
  InvoiceSellerSnapshot,
} from "./types";

export function parseInvoiceSellerSnapshot(
  value: unknown,
): InvoiceSellerSnapshot | null {
  const row = asObject(value);
  if (!row) return null;
  return {
    schema_version: numberValue(row.schema_version) ?? 1,
    tenant_id: stringValue(row.tenant_id),
    name: stringValue(row.name),
    display_name: stringValue(row.display_name),
    legal_name: stringValue(row.legal_name),
    vat_number: stringValue(row.vat_number),
    // РАЗБОР — ЭТО ТОЖЕ ПЕЧАТЬ. Сервер клал `reg_number` и `logo_url` в
    // снимок, а разбор их не читал: поля физически не доезжали до бумаги, и
    // документ печатал СЕГОДНЯШНИЙ логотип арендатора вместо того, с которым
    // его выслали.
    reg_number: stringValue(row.reg_number),
    logo_url: stringValue(row.logo_url),
    business_address: stringValue(row.business_address),
    address: stringValue(row.address),
    city: stringValue(row.city),
    country: stringValue(row.country),
    contact_email: stringValue(row.contact_email),
    contact_phone: stringValue(row.contact_phone),
    iban: stringValue(row.iban),
    bank_name: stringValue(row.bank_name),
    currency: stringValue(row.currency),
  };
}

export function parseInvoiceClientSnapshot(
  value: unknown,
): InvoiceClientSnapshot | null {
  const row = asObject(value);
  if (!row) return null;
  return {
    schema_version: numberValue(row.schema_version) ?? 1,
    client_id: stringValue(row.client_id),
    full_name: stringValue(row.full_name),
    phone: stringValue(row.phone),
    phone_e164: stringValue(row.phone_e164),
    whatsapp_phone: stringValue(row.whatsapp_phone),
    email: stringValue(row.email),
    address: stringValue(row.address),
    city: stringValue(row.city),
    primary_address: stringValue(row.primary_address),
    legal_name: stringValue(row.legal_name),
    vat_number: stringValue(row.vat_number),
    reg_number: stringValue(row.reg_number),
    billing_address: stringValue(row.billing_address),
    ...("object" in row ? { object: parseInvoiceObjectSnapshot(row.object) } : {}),
    archived: row.archived === true,
    deleted_at: stringValue(row.deleted_at),
  };
}

function parseInvoiceObjectSnapshot(value: unknown): InvoiceObjectSnapshot | null {
  const row = asObject(value);
  if (!row) return null;
  const partsRow = asObject(row.address_parts);
  let parts: InvoiceObjectAddressParts | null = null;
  if (partsRow) {
    parts = {};
    for (const key of ["street", "complex", "entrance", "floor", "apartment", "city", "zip"] as const) {
      const part = stringValue(partsRow[key]);
      if (part) parts[key] = part;
    }
  }
  return { id: stringValue(row.id), label: stringValue(row.label), address_parts: parts };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
