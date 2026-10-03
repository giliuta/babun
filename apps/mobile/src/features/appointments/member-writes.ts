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
 *  `member_check_appointment_field` (последнее определение — миграция
 *  20260930070000; тест находит его сам); статус решается отдельно
 *  (`statusBlock`). */
export const WORK_FIELD_BLOCK: Readonly<Record<string, string>> = {
  date: "calendar.move",
  time_start: "calendar.move",
  time_end: "calendar.move",
  total_duration: "calendar.move",
  // Заметка записи — своё право с 30.09 (раньше шла со статусом).
  comment: "record.note",
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

/** Поле своего события → блок (та же функция сервера, ветка события, 30.09).
 *  Время, статус, «весь день», напоминания и повтор идут вместе с самим
 *  событием («События: Меняет»); метка, клиент, объект, тип и заметка — по
 *  блокам события. Клиента и объекта здесь не было: партнёр, которому их
 *  открыли, создавал событие без них, а правка отвечала «Это поле меняет
 *  только владелец» (аудит формы записи 03.10). */
export const EVENT_FIELD_BLOCK: Readonly<Record<string, string>> = {
  date: "calendar.events",
  time_start: "calendar.events",
  time_end: "calendar.events",
  total_duration: "calendar.events",
  status: "calendar.events",
  event_all_day: "calendar.events",
  event_push_enabled: "calendar.events",
  event_push_offsets: "calendar.events",
  event_push_at: "calendar.events",
  event_repeat: "calendar.events",
  cancel_reason: "calendar.events",
  city: "event.label",
  client_id: "event.client",
  location_id: "event.object",
  address: "event.object",
  address_note: "event.object",
  address_lat: "event.object",
  address_lng: "event.object",
  comment: "event.type",
  color_override: "event.type",
  event_notes: "event.note",
  event_url: "event.note",
};

/** Поля своего события, которые сервер принимает от автора. */
export const EVENT_FIELDS: ReadonlySet<string> = new Set(Object.keys(EVENT_FIELD_BLOCK));

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
  if (isEvent(kind)) return EVENT_FIELD_BLOCK[key] ?? null;
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
  // ДЛИТЕЛЬНОСТЬ БЕЗ ПЕРЕНОСА — НЕ ПЕРЕНОС (аудит формы записи 03.10).
  // `total_duration` считается из услуг: партнёр поменял количество — она
  // сдвинулась, хотя дата и часы на месте. Сервер ведёт это поле правом
  // «Переносить», и правка суммы с «Сумма: Меняет» отвергалась целиком.
  // Слот не двигали — длительность не отправляем; двигали — она едет с ним.
  const moves = patch.date !== undefined || patch.time_start !== undefined || patch.time_end !== undefined;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || key === "id") continue;
    if (key === "total_duration" && !moves) continue;
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

/** Запись с этим номером УЖЕ вставлена: прошлый «Создать» дошёл до сервера,
 *  а ответ оборвался. Номер — наш, один на жизнь формы, поэтому это та же
 *  запись, и повтор — успех, а не вторая запись (аудит формы записи 03.10). */
export function isOwnRecordAlreadyCreated(
  error: { code?: string | null; message?: string | null } | null,
): boolean {
  if (!error) return false;
  return error.code === "23505" && /appointments_pkey/.test(error.message ?? "");
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
  // Запись не уходит из своей команды (владелец 30.09).
  if (/access:team_move/.test(message)) return "Запись остаётся в своей команде";
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
