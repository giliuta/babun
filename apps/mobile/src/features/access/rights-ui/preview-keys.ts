// КАКИЕ ПРАВА ИМЕЮТ СВОЙ ВИД БЛОКА В ШТОРКЕ — без React: список читают и
// экран, и сторож словаря (у каждого права команды вид обязан быть).

export const RECORD_PREVIEW_KEYS: readonly string[] = [
  "record.team",
  "record.label",
  "record.when",
  "record.color",
  "record.client",
  "record.object",
  "record.services",
  "record.amount",
  "record.payment",
  "record.status",
  "record.files",
];

export const CALENDAR_PREVIEW_KEYS: readonly string[] = [
  "calendar.records",
  "calendar.create",
  "calendar.move",
  "calendar.cancel",
  "calendar.events",
  "calendar.day_labels",
  "calendar.schedule",
];

export const MONEY_PREVIEW_KEYS: readonly string[] = [
  "finance.income",
  "finance.expense",
  "finance.operations",
  "finance.accounts",
  "finance.debts",
];

export const CLIENTS_PREVIEW_KEYS: readonly string[] = ["clients", "clients.scope", "clients.contacts"];

/** Строки шестерёнки календаря — вид «как в настройках команды». */
export const SETTINGS_PREVIEW_KEYS: readonly string[] = [
  "calendar.identity",
  "calendar.timezone",
  "calendar.hours",
  "calendar.booking_form",
  "calendar.services",
  "calendar.labels",
];

export function hasBlockPreview(key: string): boolean {
  return (
    RECORD_PREVIEW_KEYS.includes(key) ||
    CALENDAR_PREVIEW_KEYS.includes(key) ||
    MONEY_PREVIEW_KEYS.includes(key) ||
    CLIENTS_PREVIEW_KEYS.includes(key) ||
    SETTINGS_PREVIEW_KEYS.includes(key)
  );
}
