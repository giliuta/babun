import type { AccessBlock, AccessLevel, MemberAccessMap } from "@/features/access/access-map";

// ОДНА СТРАНИЦА ЗАПИСИ ДЛЯ ВСЕХ — БЛОКИ ПО ПРАВАМ (владелец 21.09: «визуал
// должен быть идентичный… берёшь чётко те блоки, даёшь просто разрешение на
// них»). Мастер открывает ту же страницу записи, что и владелец; каждый блок
// показывается по уровню своего права в календаре записи:
//   • hidden — блока нет вовсе;
//   • read   — тот же блок, без нажатий и стрелок выбора;
//   • write  — как у владельца.
//
// STORY-088 (волна 1): сервер проверяет каждое поле правки сотрудника своим
// блоком (`member_appointment_update`), поэтому «Меняет» здесь — обещание,
// которое сервер держит. Блок, который сервер ещё не проверяет, сотрудник
// видит без правки: сменить его ему сервер не даст.
// Запись без календаря сотруднику закрыта целиком — сервер её тоже прячет.

type Role = "owner" | "dispatcher" | "master";

export type RecordLevel = "hidden" | "read" | "write";

export interface RecordBlocks {
  /** Команда и мастер записи. */
  team: RecordLevel;
  /** Метка записи. */
  label: RecordLevel;
  /** Дата, время и длительность: меняет тот, кто переносит («Переносить»). */
  when: RecordLevel;
  client: RecordLevel;
  object: RecordLevel;
  /** Услуги в записи — строки работ. Состав меняет «Сумма и услуги: Меняет». */
  services: RecordLevel;
  /** Сумма записи — цены в строках, скидка, «Итого». */
  amount: RecordLevel;
  payment: RecordLevel;
  files: RecordLevel;
  /** Статус записи. */
  status: RecordLevel;
  /** Заметка записи — своё право «Заметка» (30.09). Пока сервер его не
   *  проверяет — прежнее правило: пишет тот, кто меняет статус, читают все. */
  note: RecordLevel;
  /** Цвет записи: видят все, красит — «Цвет записи». */
  color: RecordLevel;
}

/** БЛОКИ СОБЫТИЯ (владелец 30.09: «и внутри события — что может видеть, что
 *  не может, что может редактировать»). Видит — во всех событиях команды;
 *  меняет — только своё событие при «Записи событий: Видит и создаёт»
 *  (`bookRights`). Команда и время видны всегда. */
export interface EventBlocks {
  label: RecordLevel;
  /** Тип — название и цвет события. */
  type: RecordLevel;
  client: RecordLevel;
  object: RecordLevel;
  note: RecordLevel;
  files: RecordLevel;
}

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
  /** Статус рабочей записи из меню: «В работу», «Выполнена». */
  status: boolean;
  /** События команды в сетке: скрыты, видны или свои заводит и правит. */
  events: RecordLevel;
  /** Метка дня над колонкой. */
  dayLabels: RecordLevel;
  /** График команды: рабочие часы и перерывы. */
  schedule: RecordLevel;
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
  status: "write",
  note: "write",
  color: "write",
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
  status: "hidden",
  note: "hidden",
  color: "hidden",
};

const ALL_ACTIONS: CalendarActions = {
  create: true,
  move: true,
  cancel: true,
  color: true,
  status: true,
  events: "write",
  dayLabels: "write",
  schedule: "write",
};

const NO_ACTIONS: CalendarActions = {
  create: false,
  move: false,
  cancel: false,
  color: false,
  status: false,
  events: "hidden",
  dayLabels: "hidden",
  schedule: "hidden",
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

  // Статус виден всегда (аудит 24.09: «Не видит» у него снято — отменённая
  // запись без статуса выглядела бы живой); меняет — по праву.
  const status = writeOrRead("record.status");
  const amount = level("record.amount");
  const services = level("record.services");
  return {
    team: level("record.team"),
    // Метка записи — под «Меткой дня» (30.09): день скрыт — метки записи нет.
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
    status,
    // «Заметка» — своё право с 30.09; неживое — прежнее правило.
    note: read("record.note") === undefined ? (status === "write" ? "write" : "read") : level("record.note"),
    color: writeOrRead("record.color"),
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
    // Метка события — под «Меткой дня» (30.09).
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
    status: can("record.status"),
    events: asRecordLevel(read("calendar.events")),
    dayLabels: asRecordLevel(read("calendar.day_labels")),
    schedule: asRecordLevel(read("calendar.schedule")),
  };
}

/** Что можно нажать на странице записи `/book` — один ответ на все двери
 *  страницы. Владельцу всё. Сотруднику — рабочая запись по блокам её
 *  календаря; своё событие при «События: Меняет» — всё, кроме клиента,
 *  объекта и календаря (сервер их у события сотрудника не принимает). */
export interface BookRights {
  editTeam: boolean;
  showLabel: boolean;
  editLabel: boolean;
  editWhen: boolean;
  showClient: boolean;
  editClient: boolean;
  showObject: boolean;
  editObject: boolean;
  showServices: boolean;
  editServices: boolean;
  editTotal: boolean;
  showMoney: boolean;
  editNote: boolean;
  editColor: boolean;
  editEventType: boolean;
  /** Блок заметки есть (у записи — «Заметка», у события — его «Заметка»). */
  showNote: boolean;
  /** Тип события показан. */
  showType: boolean;
  /** Блок файлов есть. */
  showFiles: boolean;
  /** Файлы добавляются. */
  editFiles: boolean;
}

export function bookRights(input: {
  isMember: boolean;
  kind: "work" | "event";
  isEdit: boolean;
  record: RecordBlocks;
  /** Блоки события в его календаре; нет — как было до прав блоков события. */
  event?: EventBlocks;
  /** Сотрудник может править это событие: своё и «События: Меняет». */
  eventWritable: boolean;
}): BookRights {
  const { isMember, kind, isEdit, record, eventWritable } = input;
  if (!isMember) {
    return {
      editTeam: true,
      showLabel: true,
      editLabel: true,
      editWhen: true,
      showClient: true,
      editClient: true,
      showObject: true,
      editObject: true,
      showServices: true,
      editServices: true,
      editTotal: true,
      showMoney: true,
      editNote: true,
      editColor: true,
      editEventType: true,
      showNote: true,
      showType: true,
      showFiles: true,
      editFiles: true,
    };
  }
  if (kind === "event") {
    // Блоки события (30.09): видит — по блоку; меняет — своё событие и
    // только открытый на «Видит и меняет» блок.
    const ev = input.event ?? {
      label: "write",
      type: "write",
      client: "read",
      object: "read",
      note: "write",
      files: "write",
    };
    const edits = (level: RecordLevel) => eventWritable && level === "write";
    return {
      // Календарь новой записи выбран слотом; у сохранённой — не меняется.
      editTeam: !isEdit && eventWritable,
      showLabel: ev.label !== "hidden",
      editLabel: edits(ev.label),
      editWhen: eventWritable,
      showClient: ev.client !== "hidden",
      editClient: edits(ev.client),
      showObject: ev.object !== "hidden",
      editObject: edits(ev.object),
      showServices: false,
      editServices: false,
      editTotal: false,
      showMoney: false,
      editNote: edits(ev.note),
      // Цвет события — цвет его типа.
      editColor: edits(ev.type),
      editEventType: edits(ev.type),
      showNote: ev.note !== "hidden",
      showType: ev.type !== "hidden",
      showFiles: ev.files !== "hidden",
      editFiles: edits(ev.files),
    };
  }
  const w = (level: RecordLevel) => level === "write";
  if (!isEdit) {
    // НОВАЯ ЗАПИСЬ — ЦЕЛИКОМ ЕГО (миграция 20260924170000): «Новые записи:
    // Может» — это клиент, объект, услуги, метка, цвет и заметка своей записи;
    // запись клиента без клиента не сохраняется. Ручная цена и скидка —
    // по-прежнему «Сумма: Меняет»: каталожные цены сотрудник не перебивает.
    return {
      editTeam: true,
      showLabel: true,
      editLabel: true,
      editWhen: true,
      showClient: true,
      editClient: true,
      showObject: true,
      editObject: true,
      showServices: true,
      editServices: true,
      editTotal: w(record.amount),
      showMoney: record.amount !== "hidden",
      editNote: true,
      editColor: true,
      editEventType: false,
      showNote: true,
      showType: false,
      showFiles: record.files !== "hidden",
      editFiles: w(record.files),
    };
  }
  return {
    editTeam: w(record.team),
    showLabel: record.label !== "hidden",
    editLabel: w(record.label),
    editWhen: w(record.when),
    showClient: record.client !== "hidden",
    editClient: w(record.client),
    showObject: record.object !== "hidden",
    editObject: w(record.object),
    showServices: record.services !== "hidden",
    editServices: w(record.services),
    editTotal: w(record.amount),
    showMoney: record.amount !== "hidden",
    editNote: w(record.note),
    editColor: w(record.color),
    editEventType: false,
    showNote: record.note !== "hidden",
    showType: false,
    showFiles: record.files !== "hidden",
    editFiles: w(record.files),
  };
}

/** ЗАПИСЬ КЛИЕНТА БЕЗ ТАРИФА — ТОЛЬКО ДЛЯ ПРОСМОТРА (владелец 02.10: «без
 *  тарифа нельзя добавлять объекты, услугу применить нельзя, менять нельзя
 *  ничего в целом на клиентах»). Видно то же, что и с тарифом; ни одна
 *  правка не нажимается — тот же вид, что у партнёра с «Только видит»:
 *  пустой блок (объект не выбран) уходит, заполненный стоит без двери.
 *  Сервер держит то же (`tenant_free_readonly_guard`). */
export function readOnlyBookRights(rights: BookRights): BookRights {
  return {
    ...rights,
    editTeam: false,
    editLabel: false,
    editWhen: false,
    editClient: false,
    editObject: false,
    editServices: false,
    editTotal: false,
    editNote: false,
    editColor: false,
    editEventType: false,
    editFiles: false,
  };
}
