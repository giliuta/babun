// CSV import — column → client field mapping.
//
// Mobile port of apps/web/src/components/clients/import/csv-mapping.ts.
// Pure logic: MappingStep binds pickers to FIELD_OPTIONS; the auto-detect
// runs on first parse to suggest sensible defaults. Field set matches the
// mobile Client shape we can bulk-write today (full_name/phone/email/city/
// address/comment) — plus «skip».

import type { CountryCode } from "libphonenumber-js";

export type ImportableField =
  | "skip"
  | "full_name"
  | "phone"
  | "email"
  | "city"
  | "address"
  | "comment";

/** Display labels for the mapping picker — RU per the UI rule. */
export const FIELD_LABEL: Record<ImportableField, string> = {
  skip: "— не импортировать —",
  full_name: "Имя *",
  phone: "Телефон",
  email: "Email",
  city: "Город",
  address: "Адрес",
  comment: "Заметка",
};

/** The order matters — first matched header wins for the auto-mapper. */
export const FIELD_OPTIONS: ImportableField[] = [
  "skip",
  "full_name",
  "phone",
  "email",
  "city",
  "address",
  "comment",
];

/** Header substring → field. All comparisons are lowercased + trimmed. */
const AUTO_MAP_RULES: Array<{ field: ImportableField; patterns: string[] }> = [
  {
    field: "full_name",
    patterns: ["full name", "client name", "имя", "фио", "name", "клиент", "название"],
  },
  { field: "phone", patterns: ["mobile", "телефон", "phone", "тел", "моб", "номер"] },
  { field: "email", patterns: ["e-mail", "email", "почта", "емейл", "mail"] },
  { field: "city", patterns: ["city", "город"] },
  { field: "address", patterns: ["address", "адрес"] },
  {
    field: "comment",
    patterns: ["comment", "заметки", "заметка", "примечан", "notes", "note", "комментар"],
  },
];

/** Best-effort guess for one CSV header. Returns 'skip' when nothing
 *  matches — the user can override in the UI. */
export function autoMapHeader(header: string): ImportableField {
  const h = header.trim().toLowerCase();
  if (!h) return "skip";
  for (const rule of AUTO_MAP_RULES) {
    if (rule.patterns.some((p) => h === p || h.includes(p))) {
      return rule.field;
    }
  }
  return "skip";
}

/** First-pass mapping for an entire header row. Ensures each non-skip
 *  field lands on at most one column even if two headers look alike;
 *  later duplicates demote to 'skip' so the user picks deliberately. */
export function autoMapHeaders(headers: string[]): ImportableField[] {
  const mapped = headers.map(autoMapHeader);
  const seen = new Set<ImportableField>();
  return mapped.map((field) => {
    if (field === "skip") return field;
    if (seen.has(field)) return "skip";
    seen.add(field);
    return field;
  });
}

/** Country options for phone normalisation. libphonenumber-js keys on the
 *  ISO country code (CY, RU…), so we store ISO + show the dial hint. The
 *  order puts the tenant default (Cyprus) first. */
export const COUNTRY_OPTIONS: Array<{ value: CountryCode; label: string }> = [
  { value: "CY", label: "Кипр (+357)" },
  { value: "RU", label: "Россия (+7)" },
  { value: "KZ", label: "Казахстан (+7)" },
  { value: "GR", label: "Греция (+30)" },
  { value: "GB", label: "Великобритания (+44)" },
  { value: "US", label: "США / Канада (+1)" },
];

/** Default tenant-wide country — mirrors phone.ts DEFAULT_COUNTRY (Cyprus). */
export const DEFAULT_COUNTRY: CountryCode = "CY";
