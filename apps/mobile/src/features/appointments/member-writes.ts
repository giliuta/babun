import type { Appointment } from "@babun/shared/local/appointments";

// ЗАПИСЬ СОТРУДНИКА — ЧЕРЕЗ ДВЕРИ, ПОЛЕ ЗА ПОЛЕМ (STORY-088, волна 1).
//
// Владелец пишет запись в таблицу сам. Сотрудник — только тремя дверями
// сервера (`member_appointment_update / _create / _delete`), и каждое поле
// там проверяется СВОИМ блоком в календаре записи: время — «Переносить»,
// клиент — «Клиент: Меняет», сумма и услуги — «Сумма: Меняет» и т. д. Поле,
// у которого блока нет, сервер не принимает вовсе.
//
// Здесь — зеркало этой карты для телефона: что отправлять (только
// изменённое и только знакомое серверу) и как сказать отказ словами. Лист
// без React и без сети: правила проверяются тестом.

/** Поле рабочей записи → блок, который его меняет. Копия
 *  `member_check_appointment_field` (миграция 20260924150000); статус решается
 *  отдельно (`statusBlock`). */
export const WORK_FIELD_BLOCK: Readonly<Record<string, string>> = {
  date: "calendar.move",
  time_start: "calendar.move",
  time_end: "calendar.move",
  total_duration: "calendar.move",
  comment: "record.status",
  cancel_reason: "calendar.cancel",
  client_id: "record.client",
  location_id: "record.object",
  address: "record.object",
  address_note: "record.object",
  address_lat: "record.object",
  address_lng: "record.object",
  services: "record.amount",
  service_ids: "record.amount",
  total_amount: "record.amount",
  custom_total: "record.amount",
  discount_amount: "record.amount",
  global_discount: "record.amount",
  service_price_overrides: "record.amount",
  vat_mode: "record.amount",
  vat_rate: "record.amount",
  city: "record.label",
  color_override: "record.color",
  team_id: "record.team",
  master_id: "record.team",
};

/** Поля НОВОЙ рабочей записи (миграция 20260924170000): «Новые записи:
 *  Может» — авторство записи целиком, блоки решают только правку созданной. */
export const WORK_CREATE_FIELDS: ReadonlySet<string> = new Set([
  "comment",
  "client_id",
  "location_id",
  "address",
  "address_note",
  "address_lat",
  "address_lng",
  "services",
  "service_ids",
  "total_amount",
  "custom_total",
  "discount_amount",
  "global_discount",
  "service_price_overrides",
  "vat_mode",
  "vat_rate",
  "city",
  "color_override",
  "master_id",
]);

/** Поля своего события, которые автор правит при «События: Меняет». */
export const EVENT_FIELDS: ReadonlySet<string> = new Set([
  "date",
  "time_start",
  "time_end",
  "total_duration",
  "status",
  "comment",
  "color_override",
  "city",
  "event_all_day",
  "event_notes",
  "event_url",
  "event_push_enabled",
  "event_push_offsets",
  "event_push_at",
  "event_repeat",
  "cancel_reason",
  "address",
  "address_note",
  "address_lat",
  "address_lng",
]);

const isEvent = (kind: Appointment["kind"] | undefined) => kind === "event" || kind === "personal";

/** Блок статуса: отмена и возврат из отмены — «Отменять», остальное —
 *  «Статус записи». */
export function statusBlock(next: string, previous: string | undefined): string {
  return next === "cancelled" || previous === "cancelled" ? "calendar.cancel" : "record.status";
}

/** Какой блок нужен, чтобы поменять поле. `null` — поле сотруднику не
 *  меняется никогда (деньги, оплата, служебное). */
export function fieldBlock(
  key: string,
  kind: Appointment["kind"] | undefined,
  value?: unknown,
  previousStatus?: string,
): string | null {
  if (isEvent(kind)) return EVENT_FIELDS.has(key) ? "calendar.events" : null;
  if (key === "status") return statusBlock(String(value ?? ""), previousStatus);
  return WORK_FIELD_BLOCK[key] ?? null;
}

/** Патч правки → тело двери: без `undefined` (их JSON и так бы потерял, но
 *  пустой патч сервер отвергает) и без полей, которых дверь не знает. Второе
 *  возвращается отдельно: молча выбросить поле нельзя — это потерянная
 *  правка, звать сервер с ним тоже нельзя — это отказ всей правки. */
export function memberPatch(
  patch: Partial<Appointment>,
  kind: Appointment["kind"] | undefined,
): { body: Record<string, unknown>; foreign: string[] } {
  const body: Record<string, unknown> = {};
  const foreign: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || key === "id") continue;
    const known = isEvent(kind) ? EVENT_FIELDS.has(key) : key === "status" || key in WORK_FIELD_BLOCK;
    if (known) body[key] = value;
    else foreign.push(key);
  }
  return { body, foreign };
}

/** Пустое ли значение: такое поле при создании не отправляется — его и так
 *  ставит сервер, а отправленное оно потребовало бы права на свой блок
 *  («без клиента» не должно требовать «Клиент: Меняет»). */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === "" || value === 0) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

/** Новая запись → тело двери создания: обязательное (календарь, дата, время)
 *  и только то из остального, что человек правда заполнил. */
export function memberCreateRow(a: Appointment): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: a.id,
    kind: isEvent(a.kind) ? "event" : "work",
    team_id: a.team_id,
    date: a.date,
    time_start: a.time_start,
    time_end: a.time_end,
  };
  if (typeof a.total_duration === "number" && a.total_duration > 0) {
    row.total_duration = a.total_duration;
  }
  const fields = isEvent(a.kind) ? [...EVENT_FIELDS] : [...WORK_CREATE_FIELDS];
  const source = a as unknown as Record<string, unknown>;
  for (const key of fields) {
    if (key in row || key === "status") continue;
    const value = source[key];
    if (!isBlank(value)) row[key] = value;
  }
  return row;
}

/** Отказ двери → слова. `titleOf` — название блока из реестра. */
export function memberWriteRefusal(
  message: string,
  titleOf: (blockKey: string) => string | undefined,
): string | null {
  const block = /access:block:([a-z_.]+)/.exec(message)?.[1];
  if (block) {
    const title = titleOf(block);
    return title ? `Нет права «${title}» в этом календаре` : "Нет права на это в этом календаре";
  }
  if (/access:field:/.test(message)) return "Это поле меняет только владелец";
  if (/access:client/.test(message)) return "Этот клиент вам недоступен";
  if (/not found or not in your calendars/.test(message)) {
    return "Запись больше не в ваших календарях";
  }
  return null;
}

/** Правка сотрудника несёт ТОЛЬКО изменённое: форма собирает запись целиком,
 *  а каждое поле в двери требует своего права — неизменённый клиент в патче
 *  потребовал бы «Клиент: Меняет» у того, кто его не трогал. `before` —
 *  снимок формы сразу после загрузки записи. */
export function changedFields(
  before: Partial<Appointment>,
  after: Partial<Appointment>,
): Partial<Appointment> {
  const out: Record<string, unknown> = {};
  const was = before as Record<string, unknown>;
  for (const [key, value] of Object.entries(after)) {
    if (value === undefined) continue;
    if (JSON.stringify(value) !== JSON.stringify(was[key])) out[key] = value;
  }
  return out as Partial<Appointment>;
}
