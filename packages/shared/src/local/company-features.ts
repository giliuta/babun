// ФУНКЦИИ КОМПАНИИ (STORY-088, владелец 24.09: «кому-то вообще не нужно
// добавление объекта — можно будет тумблер выключить, и его не будет ни у
// кого видно, даже у владельца»).
//
// Функция — то, что в компании ВООБЩЕ есть. Это не право сотрудника (права
// решают, КТО что видит), а форма бизнеса: у мастера маникюра объектов нет,
// у кого-то нет долгов и инвойсов. Выключенная функция пропадает у всех, и у
// владельца; её данные не стираются и возвращаются при включении.
//
// Хранится в `calendar_settings.disabled_features` (одна строка на компанию,
// миграция 20260924140000). Сервер проверяет ключи по этому же списку —
// ключ, которого нет здесь, база не примет.

export type CompanyFeatureKey =
  | "objects"
  | "day_labels"
  | "record_label"
  | "events"
  | "record_payment"
  | "record_files"
  | "record_note"
  | "debts"
  | "accounts"
  | "documents"
  | "client_people"
  | "client_requisites"
  | "client_files"
  // Блоки формы СОБЫТИЯ — свои, не общие с записью (владелец 24.09,
  // миграция 20260924230000).
  | "event_label"
  | "event_type"
  | "event_client"
  | "event_object"
  | "event_note"
  | "event_files";

export type CompanyFeatureGroup =
  | "record"
  | "event"
  | "calendar"
  | "money"
  | "clients";

export interface CompanyFeatureDef {
  key: CompanyFeatureKey;
  /** Слово на странице «Функции». */
  label: string;
  group: CompanyFeatureGroup;
  /** Блок формы записи, который эта функция включает и выключает. */
  bookingBlock?: string;
  /** Блок формы события, который эта функция включает и выключает. */
  eventBlock?: string;
}

export const COMPANY_FEATURE_GROUP_TITLE: Record<CompanyFeatureGroup, string> = {
  record: "Запись",
  event: "Событие",
  calendar: "Календарь",
  money: "Деньги",
  clients: "Клиенты",
};

/** В порядке страницы «Функции». */
export const COMPANY_FEATURES: readonly CompanyFeatureDef[] = [
  { key: "objects", label: "Объекты", group: "record", bookingBlock: "object" },
  { key: "record_label", label: "Метка записи", group: "record", bookingBlock: "label" },
  { key: "record_payment", label: "Оплата", group: "record", bookingBlock: "payment" },
  { key: "record_note", label: "Заметка", group: "record", bookingBlock: "note" },
  { key: "record_files", label: "Файлы", group: "record", bookingBlock: "files" },
  { key: "day_labels", label: "Метка дня", group: "calendar" },
  { key: "events", label: "События", group: "calendar" },
  { key: "debts", label: "Долги", group: "money" },
  { key: "accounts", label: "Счета и переводы", group: "money" },
  { key: "documents", label: "Инвойсы и чеки", group: "money" },
  { key: "client_people", label: "Люди и связи", group: "clients" },
  { key: "client_requisites", label: "Реквизиты клиента", group: "clients" },
  { key: "client_files", label: "Файлы клиента", group: "clients" },
  { key: "event_label", label: "Метка события", group: "event", eventBlock: "label" },
  // Тип у события НЕОБЯЗАТЕЛЕН (владелец 24.09: «можно вообще без типа —
  // событие останется как обычная запись с заметкой»).
  { key: "event_type", label: "Тип события", group: "event", eventBlock: "type" },
  { key: "event_client", label: "Клиент события", group: "event", eventBlock: "client" },
  { key: "event_object", label: "Объект события", group: "event", eventBlock: "object" },
  { key: "event_note", label: "Заметка события", group: "event", eventBlock: "note" },
  { key: "event_files", label: "Файлы события", group: "event", eventBlock: "files" },
];

const KNOWN = new Set<string>(COMPANY_FEATURES.map((feature) => feature.key));

/** Чистка того, что пришло с сервера или из кэша: незнакомое выбрасывается,
 *  повторы — тоже. Неизвестный ключ не может выключить ничего. */
export function sanitizeDisabledFeatures(raw: unknown): CompanyFeatureKey[] {
  if (!Array.isArray(raw)) return [];
  const out: CompanyFeatureKey[] = [];
  for (const value of raw) {
    if (typeof value === "string" && KNOWN.has(value) && !out.includes(value as CompanyFeatureKey)) {
      out.push(value as CompanyFeatureKey);
    }
  }
  return out;
}

/** Включена ли функция. Пустой или незнакомый список — включено всё. */
export function isFeatureOn(
  disabled: readonly string[] | undefined,
  key: CompanyFeatureKey,
): boolean {
  return !disabled || !disabled.includes(key);
}

/** Список после переключения одной функции: без повторов, в порядке
 *  страницы — чтобы одинаковое состояние всегда писалось одинаково. */
export function withFeature(
  disabled: readonly string[] | undefined,
  key: CompanyFeatureKey,
  on: boolean,
): CompanyFeatureKey[] {
  const current = new Set(sanitizeDisabledFeatures(disabled ?? []));
  if (on) current.delete(key);
  else current.add(key);
  return COMPANY_FEATURES.map((feature) => feature.key).filter((k) => current.has(k));
}

/** Функция, которая включает блок формы записи (`object` → `objects`). */
export function featureOfBookingBlock(blockId: string): CompanyFeatureKey | null {
  return COMPANY_FEATURES.find((feature) => feature.bookingBlock === blockId)?.key ?? null;
}

/** Функция, которая включает блок формы события (`note` → `event_note`). */
export function featureOfEventBlock(blockId: string): CompanyFeatureKey | null {
  return COMPANY_FEATURES.find((feature) => feature.eventBlock === blockId)?.key ?? null;
}
