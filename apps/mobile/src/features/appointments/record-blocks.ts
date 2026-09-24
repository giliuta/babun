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
  /** Заметку пишет тот, кто меняет статус (владелец 21.09); читают все. */
  note: RecordLevel;
  /** Цвет записи: видят все, красит — «Цвет записи». */
  color: RecordLevel;
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
  events: "write",
  dayLabels: "write",
  schedule: "write",
};

const NO_ACTIONS: CalendarActions = {
  create: false,
  move: false,
  cancel: false,
  color: false,
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

  const status = level("record.status");
  const amount = level("record.amount");
  const services = level("record.services");
  return {
    team: level("record.team"),
    label: level("record.label"),
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
    note: status === "write" ? "write" : "read",
    color: writeOrRead("record.color"),
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
}

export function bookRights(input: {
  isMember: boolean;
  kind: "work" | "event";
  isEdit: boolean;
  record: RecordBlocks;
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
    };
  }
  if (kind === "event") {
    return {
      // Календарь новой записи выбран слотом; у сохранённой — не меняется.
      editTeam: !isEdit && eventWritable,
      showLabel: true,
      editLabel: eventWritable,
      editWhen: eventWritable,
      showClient: true,
      editClient: false,
      showObject: true,
      editObject: false,
      showServices: false,
      editServices: false,
      editTotal: false,
      showMoney: false,
      editNote: eventWritable,
      editColor: eventWritable,
      editEventType: eventWritable,
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
  };
}
