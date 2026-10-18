import type { AccessBlock, AccessLevel, MemberAccessMap } from "@/session/access-map";
import type { EventBlocks, RecordBlocks, RecordLevel } from "./record-blocks/levels";
import { asRecordWindow, type RecordWindow } from "./record-window";

// ОДНА СТРАНИЦА ЗАПИСИ ДЛЯ ВСЕХ — БЛОКИ ПО ПРАВАМ (визуал идентичный, меняется только разрешение на
// блоки). Мастер открывает ту же страницу записи, что и владелец; каждый блок
// показывается по уровню своего права в календаре записи:
//   • hidden — блока нет вовсе;
//   • read   — тот же блок, без нажатий и стрелок выбора;
//   • write  — как у владельца.
//
// STORY-088: сервер проверяет каждое поле правки сотрудника своим
// блоком (`member_appointment_update`), поэтому «Меняет» здесь — обещание,
// которое сервер держит. Блок, который сервер ещё не проверяет, сотрудник
// видит без правки: сменить его ему сервер не даст.
// Запись без календаря сотруднику закрыта целиком — сервер её тоже прячет.

type Role = "owner" | "dispatcher" | "master";

// Level types and the `/book` rights live in `./record-blocks/`; this file
// stays the public entry.
export type { EventBlocks, RecordBlocks, RecordLevel } from "./record-blocks/levels";
export { bookRights, readOnlyBookRights, type BookRights } from "./record-blocks/book-rights";

/** Что человек может сделать с записями календаря — кнопки сетки и меню. */
export interface CalendarActions {
  /** Новая рабочая запись: тап по пустому месту, «+», копия записи. */
  create: boolean;
  /** Перенос: перетаскивание, «Перенести», смена времени и даты. */
  move: boolean;
  /** Отмена, возврат отменённой и удаление рабочей записи. */
  cancel: boolean;
  /** Перекрасить запись из меню. */
  color: boolean;
  /** «Записи клиентов»: видит ли он записи этого календаря вообще. */
  records: RecordLevel;
  /** События команды в сетке: скрыты, видны или свои заводит и правит. */
  events: RecordLevel;
  /** Метка дня над колонкой. */
  dayLabels: RecordLevel;
  /** График команды: рабочие часы и перерывы. */
  schedule: RecordLevel;
  /** «Ограничения»: за какой срок назад видна прошедшая работа. */
  window: RecordWindow;
}

type Registry = readonly Pick<AccessBlock, "key" | "live" | "levels">[];

interface Input {
  role: Role | null | undefined;
  map: MemberAccessMap | undefined;
  /** Реестр блоков: живость и умолчания. `undefined` — едет. */
  registry: Registry | undefined;
  teamId: string | null;
}

const EVERYTHING: RecordBlocks = {
  team: "write",
  label: "write",
  when: "write",
  client: "write",
  object: "write",
  services: "write",
  amount: "write",
  payment: "write",
  files: "write",
  note: "write",
  color: "write",
  sms: "write",
};

const NOTHING: RecordBlocks = {
  team: "hidden",
  label: "hidden",
  when: "hidden",
  client: "hidden",
  object: "hidden",
  services: "hidden",
  amount: "hidden",
  payment: "hidden",
  files: "hidden",
  note: "hidden",
  color: "hidden",
  sms: "hidden",
};

const ALL_ACTIONS: CalendarActions = {
  create: true,
  move: true,
  cancel: true,
  color: true,
  records: "write",
  events: "write",
  dayLabels: "write",
  schedule: "write",
  window: "own",
};

const NO_ACTIONS: CalendarActions = {
  create: false,
  move: false,
  cancel: false,
  color: false,
  records: "hidden",
  events: "hidden",
  dayLabels: "hidden",
  schedule: "hidden",
  window: "own",
};

const asRecordLevel = (level: AccessLevel | undefined): RecordLevel =>
  level === "write" ? "write" : level === "read" ? "read" : "hidden";

/** Читатель положения блока в календаре записи. `null` — сотруднику этот
 *  календарь закрыт целиком (или что-то ещё едет). Неживой блок читается как
 *  `undefined`: сервер его не проверяет, и страница решает сама. */
function calendarReader(input: Input): ((key: string) => AccessLevel | undefined) | null {
  const { role, map, registry, teamId } = input;
  // Роль, карта или реестр ещё едут — закрытая сторона: блок появится, когда
  // всё приедет, а не мигнёт лишним.
  if (!role || !map || !registry || teamId === null) return null;
  // Чужой календарь — ничего, даже блоков, которых сервер не проверяет.
  if (!map.attachedCalendars.includes(teamId)) return null;
  const byKey = new Map(registry.map((block) => [block.key, block]));
  const levels = map.calendars[teamId] ?? {};
  return (key) => {
    const block = byKey.get(key);
    if (!block?.live) return undefined;
    // В карте только выставленное; нет строки — умолчание реестра, как на
    // сервере (`access_calendars_of`: `coalesce(level, levels[1])`).
    const level = levels[key] ?? block.levels[0] ?? "off";
    return block.levels.includes(level) ? level : (block.levels[0] ?? "off");
  };
}

const isOwnerSide = (input: Input) => input.role === "owner" || input.map?.isOwner === true;

export function recordBlocks(input: Input): RecordBlocks {
  if (isOwnerSide(input)) return EVERYTHING;
  const read = calendarReader(input);
  if (!read) return NOTHING;
  /** Блок записи: неживой — «без правки», живой — по своему положению. */
  const level = (key: string): RecordLevel => {
    const value = read(key);
    return value === undefined ? "read" : asRecordLevel(value);
  };
  /** Два положения «Не меняет / Меняет»: видят всегда, меняет — по праву. */
  const writeOrRead = (key: string): RecordLevel => (read(key) === "write" ? "write" : "read");

  const amount = level("record.amount");
  const services = level("record.services");
  return {
    team: level("record.team"),
    // Метка записи — под «Меткой дня»: день скрыт — метки записи нет.
    label: read("calendar.day_labels") === "off" ? "hidden" : level("record.label"),
    when: writeOrRead("calendar.move"),
    client: level("record.client"),
    object: level("record.object"),
    // Состав работ меняет сумму, поэтому его правит «Сумма и услуги: Меняет»;
    // скрытые услуги не открывает и она.
    services: services === "hidden" ? "hidden" : amount === "write" ? "write" : "read",
    amount,
    payment: level("record.payment"),
    files: level("record.files"),
    // «Заметка» — своё право с 30.09; неживое — прежнее правило.
    note: read("record.note") === undefined ? "read" : level("record.note"),
    color: writeOrRead("record.color"),
    // «SMS» записи: сервер отдаёт историю только вместе с «Клиентом»
    // (`sms_for_appointment`) — без клиента блок пустой, его нет.
    sms: level("record.client") === "hidden" ? "hidden" : level("record.sms"),
  };
}

const ALL_EVENT: EventBlocks = {
  label: "write",
  type: "write",
  client: "write",
  object: "write",
  note: "write",
  files: "write",
};

const NO_EVENT: EventBlocks = {
  label: "hidden",
  type: "hidden",
  client: "hidden",
  object: "hidden",
  note: "hidden",
  files: "hidden",
};

export function eventBlocks(input: Input): EventBlocks {
  if (isOwnerSide(input)) return ALL_EVENT;
  const read = calendarReader(input);
  if (!read) return NO_EVENT;
  /** Живой блок — по положению; неживой — как было до прав блоков события:
   *  всё видно, своё событие автор правит, кроме клиента и объекта; файлы
   *  события — по «Файлам» записи. */
  const level = (key: string, before: RecordLevel): RecordLevel => {
    const value = read(key);
    return value === undefined ? before : asRecordLevel(value);
  };
  const filesBefore: RecordLevel = asRecordLevel(read("record.files")) === "hidden" ? "hidden" : "write";
  return {
    // Метка события — под «Меткой дня».
    label: read("calendar.day_labels") === "off" ? "hidden" : level("event.label", "write"),
    type: level("event.type", "write"),
    client: level("event.client", "read"),
    object: level("event.object", "read"),
    note: level("event.note", "write"),
    files: level("event.files", filesBefore),
  };
}

export function calendarActions(input: Input): CalendarActions {
  if (isOwnerSide(input)) return ALL_ACTIONS;
  const read = calendarReader(input);
  if (!read) return NO_ACTIONS;
  // Неживой блок сервер не проверяет — и не пускает сотрудника в двери
  // записи: обещать кнопку, которая кончится отказом, нельзя.
  const can = (key: string) => read(key) === "write";
  return {
    create: can("calendar.create"),
    move: can("calendar.move"),
    cancel: can("calendar.cancel"),
    color: can("record.color"),
    records: asRecordLevel(read("calendar.records")),
    events: asRecordLevel(read("calendar.events")),
    dayLabels: asRecordLevel(read("calendar.day_labels")),
    schedule: asRecordLevel(read("calendar.schedule")),
    // Реестр на телефоне ещё не знает права — окна нет: прятать записи по
    // догадке хуже, чем показать (сервер режет сам).
    window: read("calendar.window") === undefined ? "own" : asRecordWindow(read("calendar.window")),
  };
}
