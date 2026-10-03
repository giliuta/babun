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
  "record.note",
  "record.files",
  "record.sms",
  "event.label",
  "event.type",
  "event.client",
  "event.object",
  "event.note",
  "event.files",
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
  "finance.accounts",
  "finance.debts",
  // Плитки «Документы» и «Прибыль» (владелец 03.10).
  "finance.documents",
  "finance.profit",
];

export const CLIENTS_PREVIEW_KEYS: readonly string[] = [
  "clients",
  "clients.scope",
  "clients.create",
  "clients.menu",
  "clients.delete",
];

/** Блоки карточки клиента (владелец 30.09: «страница клиентов по правам —
 *  полностью»): вид — сам блок карточки. */
export const CLIENT_CARD_PREVIEW_KEYS: readonly string[] = [
  "clients.note",
  "clients.people",
  "clients.objects",
  "clients.labels",
  "clients.tags",
  "clients.personal",
  "clients.files",
  "clients.requisites",
  "clients.client",
  "clients.history",
  "clients.sms",
];

/** Строки шестерёнки календаря — вид «как в настройках команды». */
export const SETTINGS_PREVIEW_KEYS: readonly string[] = [
  "calendar.identity",
  "calendar.timezone",
  "calendar.hours",
  "calendar.booking_form",
  "calendar.services",
  "calendar.labels",
  // Строки шестерёнки клиентов (владелец 01.10) — тот же вид строки.
  "clients.settings_card",
  "clients.settings_ways",
  "clients.settings_objects",
  "clients.settings_maps",
  "clients.settings_tags",
  "clients.settings_sources",
  // Строки шестерёнки финансов (владелец 03.10) — тот же вид строки.
  "finance.settings_accounts",
  "finance.settings_trash",
  "finance.settings_categories_income",
  "finance.settings_categories_expense",
  "finance.settings_categories_debts",
  "finance.settings_currency",
];

/** Права «Кабинета» (04.10) — строкой блока аккаунта в Кабинете партнёра.
 *  «Реквизиты» — здесь же: их строка живёт в Кабинете с 03.10. */
export const CABINET_PREVIEW_KEYS: readonly string[] = [
  "cabinet.tariff",
  "cabinet.tariff_payments",
  "cabinet.sms",
  "finance.settings_requisites",
];

/** «Ограничения» записей и финансов (03.10) — общий вид сроков. */
export const WINDOW_PREVIEW_KEYS: readonly string[] = ["calendar.window", "finance.window"];

export function hasBlockPreview(key: string): boolean {
  return (
    WINDOW_PREVIEW_KEYS.includes(key) ||
    RECORD_PREVIEW_KEYS.includes(key) ||
    CALENDAR_PREVIEW_KEYS.includes(key) ||
    MONEY_PREVIEW_KEYS.includes(key) ||
    CLIENTS_PREVIEW_KEYS.includes(key) ||
    CLIENT_CARD_PREVIEW_KEYS.includes(key) ||
    SETTINGS_PREVIEW_KEYS.includes(key) ||
    CABINET_PREVIEW_KEYS.includes(key)
  );
}
