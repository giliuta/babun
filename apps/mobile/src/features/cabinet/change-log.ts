import { money } from "@babun/shared/common/utils/money";

// «ИСТОРИЯ ИЗМЕНЕНИЙ» — КАК ЧИТАТЬ СТРОКУ ЖУРНАЛА (владелец 03.10: «любое
// изменение записывается в историю… чётко отслеживать, что делаю я и что
// делает каждый из моих партнёров»).
//
// Журнал пишет сервер (`change_log`, триггер `log_change()`): таблица,
// действие, имя предмета на тот момент, подпись (дата, сумма) и поля
// {поле: [было, стало]}. Здесь — только слова: «Запись изменена · Анастасия
// · Начало 09:30 → 10:00». Род причастия — от предмета: глагола в мужском
// роде у автора нет, у партнёра может быть любой.
//
// Лист без React — правила под тестом.

export interface ChangeLogRow {
  id: number;
  team_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  entity: string;
  entity_id: string | null;
  action: "insert" | "update" | "delete" | "restore";
  label: string | null;
  meta: Record<string, unknown> | null;
  changes: Record<string, unknown> | null;
  created_at: string;
}

type Gender = "m" | "f" | "n" | "pl";

interface Noun {
  word: string;
  gender: Gender;
}

const PARTICIPLES: Record<ChangeLogRow["action"], Record<Gender, string>> = {
  insert: { m: "создан", f: "создана", n: "создано", pl: "созданы" },
  update: { m: "изменён", f: "изменена", n: "изменено", pl: "изменены" },
  delete: { m: "удалён", f: "удалена", n: "удалено", pl: "удалены" },
  restore: { m: "возвращён", f: "возвращена", n: "возвращено", pl: "возвращены" },
};

const NOUNS: Record<string, Noun> = {
  clients: { word: "Клиент", gender: "m" },
  debts: { word: "Долг", gender: "m" },
  receipts: { word: "Чек", gender: "m" },
  teams: { word: "Календарь", gender: "m" },
  accounts: { word: "Счёт", gender: "m" },
  services: { word: "Услуга", gender: "f" },
  cities: { word: "Метка", gender: "f" },
  client_tags: { word: "Тег", gender: "m" },
  client_sources: { word: "Источник", gender: "m" },
  location_labels: { word: "Тип объекта", gender: "m" },
  finance_categories: { word: "Категория", gender: "f" },
  personal_event_types: { word: "Тип события", gender: "m" },
  team_design: { word: "Настройки записей", gender: "pl" },
  team_schedules: { word: "График", gender: "m" },
};

const TX_NOUNS: Record<string, Noun> = {
  income: { word: "Доход", gender: "m" },
  expense: { word: "Расход", gender: "m" },
  transfer: { word: "Перевод", gender: "m" },
  refund: { word: "Возврат", gender: "m" },
};

/** Что за предмет: «Запись», «Событие», «Доход», «Кредит-нота»… */
export function entityNoun(row: Pick<ChangeLogRow, "entity" | "meta">): Noun {
  const meta = row.meta ?? {};
  if (row.entity === "appointments") {
    return meta.kind === "event" ? { word: "Событие", gender: "n" } : { word: "Запись", gender: "f" };
  }
  if (row.entity === "finance_transactions") {
    return TX_NOUNS[String(meta.type)] ?? { word: "Операция", gender: "f" };
  }
  if (row.entity === "invoices") {
    return meta.kind === "credit_note" ? { word: "Кредит-нота", gender: "f" } : { word: "Инвойс", gender: "m" };
  }
  return NOUNS[row.entity] ?? { word: "Данные", gender: "pl" };
}

/** Заголовок строки: «Запись изменена», «Партнёр добавлен», «Права изменены». */
export function changeTitle(row: Pick<ChangeLogRow, "entity" | "meta" | "action" | "changes">): string {
  switch (row.entity) {
    case "member_access":
      return "Права изменены";
    case "member_calendars":
      return row.action === "delete" ? "Доступ к календарю закрыт" : "Доступ к календарю открыт";
    case "tenant_members":
      return row.action === "insert" ? "Партнёр добавлен" : row.action === "delete" ? "Партнёр удалён" : "Партнёр изменён";
    case "invitations":
      if (row.action === "insert") return "Приглашение отправлено";
      if (row.action === "delete") return "Приглашение отозвано";
      return row.changes && "accepted_at" in row.changes ? "Приглашение принято" : "Приглашение изменено";
  }
  const noun = entityNoun(row);
  return `${noun.word} ${PARTICIPLES[row.action][noun.gender]}`;
}

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** «2026-10-04» → «4 окт». Не дата — как есть. */
export function shortDate(value: unknown): string {
  const s = String(value ?? "");
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""}`.trim();
}

/** Вторая строка: имя предмета и подпись — «Анастасия · 4 окт, 10:00»,
 *  «Топливо · €40». */
export function changeSubject(row: Pick<ChangeLogRow, "entity" | "label" | "meta">): string {
  const meta = row.meta ?? {};
  const parts: string[] = [];
  if (row.label) parts.push(row.label);
  if (row.entity === "appointments") {
    const when = [meta.date ? shortDate(meta.date) : "", meta.time ? String(meta.time) : ""]
      .filter(Boolean)
      .join(", ");
    if (when) parts.push(when);
  }
  if (typeof meta.amount === "number" || (typeof meta.amount === "string" && meta.amount !== "")) {
    const n = Number(meta.amount);
    if (Number.isFinite(n)) parts.push(money(n));
  }
  return parts.join(" · ");
}

const FIELD_WORDS: Record<string, string> = {
  name: "Название",
  full_name: "Имя",
  label: "Название",
  phone: "Телефон",
  phones: "Телефоны",
  email: "Почта",
  comment: "Заметка",
  notes: "Заметка",
  note: "Заметка",
  event_notes: "Заметка",
  color: "Цвет",
  icon: "Значок",
  is_active: "Активность",
  amount: "Сумма",
  total_amount: "Сумма",
  total: "Сумма",
  paid_amount: "Оплачено",
  payments: "Оплата",
  payment: "Оплата",
  prepayments: "Предоплата",
  prepaid_amount: "Предоплата",
  payment_status: "Оплата",
  payment_method: "Способ оплаты",
  payment_account_id: "Счёт оплаты",
  discount_amount: "Скидка",
  global_discount: "Скидка",
  date: "Дата",
  occurred_on: "Дата",
  occurred_time: "Время",
  time_start: "Начало",
  time_end: "Конец",
  status: "Статус",
  team_id: "Команда",
  client_id: "Клиент",
  location_id: "Объект",
  master_id: "Мастер",
  category_id: "Категория",
  account_id: "Счёт",
  services: "Услуги",
  service_ids: "Услуги",
  material_lines: "Материалы",
  expenses: "Расходы",
  address: "Адрес",
  city: "Метка",
  vat_mode: "VAT",
  vat_rate: "Ставка VAT",
  birthday: "День рождения",
  acquisition_source: "Источник",
  blacklisted: "Чёрный список",
  reminder_at: "Напоминание",
  locations: "Объекты",
  requisites: "Реквизиты",
  sms_opt_out: "SMS",
  sms_name: "Имя для SMS",
  level: "Уровень",
  role: "Роль",
  price: "Цена",
  duration_minutes: "Длительность",
  timezone: "Часовой пояс",
  calendar_window_start: "Часы календаря",
  calendar_window_end: "Часы календаря",
  disabled_blocks: "Блоки",
  contact_ways: "Связь",
  map_services: "Карты",
  client_list_off: "Строка в списке",
  record_color_rule: "Цвет записей",
  counterparty: "Кому",
  direction: "Направление",
  event_all_day: "Весь день",
  cancel_reason: "Причина отмены",
  number: "Номер",
  accepted_at: "Принято",
  // Записи и события — прочее, что меняют руками.
  address_note: "Уточнение адреса",
  color_override: "Цвет записи",
  custom_total: "Своя сумма",
  service_price_overrides: "Цены услуг",
  total_duration: "Длительность",
  reminder_enabled: "SMS-напоминание",
  reminder_offsets: "SMS-напоминание",
  event_push_enabled: "Напоминание",
  event_push_offsets: "Напоминание",
  event_push_at: "Напоминание",
  event_repeat: "Повтор",
  event_url: "Ссылка",
  payment_id: "Оплата",
  // Клиенты.
  whatsapp_phone: "WhatsApp",
  telegram_username: "Telegram",
  instagram_username: "Instagram",
  discount: "Скидка",
  language: "Язык",
  referred_by_client_id: "Кто привёл",
  first_contact_date: "Первое обращение",
  city_manual: "Метка",
  memberships: "Абонементы",
  legal_name: "Юр. название",
  vat_number: "VAT номер",
  reg_number: "Рег. номер",
  billing_address: "Адрес для счетов",
  avatar_url: "Фото",
  favorite_master_id: "Любимый мастер",
  tag_ids: "Теги",
  // Календарь, график, команда.
  schedule: "Часы работы",
  breaks: "Перерывы",
  default_slot_minutes: "Шаг сетки",
  buffer_minutes: "Пауза между записями",
  hide_cancelled: "Отменённые",
  allow_overtime: "Сверхурочные",
  default_city: "Метка по умолчанию",
  tint_days_by_label: "Цвет дней по метке",
  appointment_blocks: "Блоки записи",
  legal_entity_id: "Реквизиты",
  record_color_palette: "Палитра записей",
  record_color_fallback: "Цвет записей",
  // Финансы и справочники.
  receipt_url: "Чек",
  vat_amount: "VAT",
  opening_balance: "Начальный остаток",
  balance_hidden: "Скрытый остаток",
  is_primary: "Основной",
  is_hidden: "Скрыт",
  show_in_payments: "В оплатах",
  kind: "Вид",
  type: "Тип",
  description: "Описание",
  unit: "Единица",
  duration_tiers: "Длительность",
  price_tiers: "Цены",
  cost_tiers: "Себестоимость",
  material_costs: "Материалы",
  budget: "Бюджет",
  monthly_budget: "Бюджет",
  hidden: "Скрыт",
  key: "Вид источника",
  block: "Блок",
  team_ids: "Команды",
};

const STATUS_WORDS: Record<string, string> = {
  scheduled: "запланирована",
  completed: "выполнена",
  cancelled: "отменена",
  in_progress: "в работе",
  no_show: "не пришёл",
};

const PAYMENT_STATUS_WORDS: Record<string, string> = {
  unpaid: "не оплачена",
  partial: "частично",
  paid: "оплачена",
  refunded: "возврат",
};

const PAYMENT_METHOD_WORDS: Record<string, string> = {
  cash: "наличные",
  card: "карта",
  transfer: "перевод",
  bank: "перевод",
};

const MONEY_FIELDS = new Set(["amount", "total_amount", "total", "paid_amount", "prepaid_amount", "discount_amount", "price"]);

function fieldValue(field: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return "—";
  if (field.endsWith("_id") || (field.endsWith("_at") && field !== "reminder_at")) return null;
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (field === "status") return STATUS_WORDS[String(value)] ?? String(value);
  if (field === "payment_status") return PAYMENT_STATUS_WORDS[String(value)] ?? String(value);
  if (field === "payment_method") return PAYMENT_METHOD_WORDS[String(value)] ?? String(value);
  if (MONEY_FIELDS.has(field)) {
    const n = Number(value);
    return Number.isFinite(n) ? money(n) : String(value);
  }
  if (field === "date" || field === "occurred_on" || field === "birthday" || field === "reminder_at") {
    return shortDate(value);
  }
  return String(value);
}

/** Одно поле правки словами: «Начало 09:30 → 10:00», «Услуги». */
export function describeField(field: string, change: unknown): string | null {
  const word = FIELD_WORDS[field];
  if (!word) return null;
  const list = listDiff(field, change);
  if (list) return `${word} ${list}`;
  if (!Array.isArray(change)) return word;
  const [before, after] = change;
  const a = fieldValue(field, before);
  const b = fieldValue(field, after);
  if (a === null || b === null) return word;
  return `${word} ${a} → ${b}`;
}

/** Третья строка: что поменялось — до трёх полей и «ещё N». Неизвестные
 *  полю слова не получают, но в «ещё» считаются. */
export function changesSummary(changes: Record<string, unknown> | null): string {
  if (!changes) return "";
  // Одно слово — одна строка; из двух полей с одним словом («Предоплата» —
  // список и сумма) остаётся то, где видно «было → стало».
  const byWord = new Map<string, string>();
  let unknown = 0;
  for (const [field, change] of Object.entries(changes)) {
    const text = describeField(field, change);
    if (!text) {
      unknown += 1;
      continue;
    }
    const word = FIELD_WORDS[field];
    const prev = byWord.get(word);
    if (prev === undefined || (prev === word && text !== word)) byWord.set(word, text);
  }
  const known = [...byWord.values()];
  const shown = known.slice(0, 3);
  const rest = known.length - shown.length + unknown;
  if (shown.length === 0) return rest > 0 ? "Служебные поля" : "";
  return rest > 0 ? `${shown.join(" · ")} · ещё ${rest}` : shown.join(" · ");
}

/** Деньги в списках (оплаты, предоплаты, расходы): имя элемента — сумма. */
const MONEY_LISTS = new Set(["payments", "prepayments", "expenses"]);
/** Текстовые списки — имена в кавычках: «новая заметка». */
const QUOTED_LISTS = new Set(["notes"]);

/** СПИСОК: что добавили и что убрали (журнал пишет {"+": [...], "-": [...]},
 *  миграция 20261003214500): «+ «ключ под ковриком» · − «Zaikaitsa»». */
function listDiff(field: string, change: unknown): string | null {
  if (!change || typeof change !== "object" || Array.isArray(change)) return null;
  const c = change as Record<string, unknown>;
  const added = Array.isArray(c["+"]) ? (c["+"] as unknown[]) : [];
  const removed = Array.isArray(c["-"]) ? (c["-"] as unknown[]) : [];
  if (added.length === 0 && removed.length === 0) return null;
  const show = (value: unknown) => {
    const text = String(value ?? "");
    if (MONEY_LISTS.has(field)) {
      const n = Number(text);
      if (Number.isFinite(n) && text !== "") return money(n);
    }
    return QUOTED_LISTS.has(field) ? `«${text}»` : text;
  };
  return [
    ...added.map((v) => `+ ${show(v)}`),
    ...removed.map((v) => `− ${show(v)}`),
  ].join(" · ");
}

/** ВСЕ ПОЛЯ ПРАВКИ — для подробностей: по строке на поле, «было → стало»
 *  или «что добавили и убрали». Поля без слова — одной строкой «Служебные
 *  поля: N». */
export function allChanges(changes: Record<string, unknown> | null): string[] {
  if (!changes) return [];
  const byWord = new Map<string, string>();
  let unknown = 0;
  for (const [field, change] of Object.entries(changes)) {
    const text = describeField(field, change);
    if (!text) {
      unknown += 1;
      continue;
    }
    const word = FIELD_WORDS[field];
    const prev = byWord.get(word);
    if (prev === undefined || (prev === word && text !== word)) byWord.set(word, text);
    else if (prev !== text && text !== word) byWord.set(word, `${prev} · ${text.slice(word.length + 1)}`);
  }
  const lines = [...byWord.values()];
  if (unknown > 0) lines.push(`Служебные поля: ${unknown}`);
  return lines;
}

const MONTHS_FULL = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/** Точное время строки журнала по часам телефона: «3 октября 2026, 18:49:06». */
export function fullWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ── ФИЛЬТРЫ ИСТОРИИ (владелец 03.10: «фильтрацию как в клиентах — просто
//    красивые фильтры всех изменений») ─────────────────────────────────────

/** Что изменили — крупными видами, а не по таблицам. */
export type ChangeKind = "records" | "events" | "clients" | "money" | "people" | "settings";

export const CHANGE_KINDS: { value: ChangeKind; label: string }[] = [
  { value: "records", label: "Записи" },
  { value: "events", label: "События" },
  { value: "clients", label: "Клиенты" },
  { value: "money", label: "Деньги" },
  { value: "people", label: "Партнёры и права" },
  { value: "settings", label: "Настройки и справочники" },
];

const MONEY_ENTITIES = new Set(["finance_transactions", "debts", "invoices", "receipts", "accounts"]);
const PEOPLE_ENTITIES = new Set(["member_access", "member_calendars", "tenant_members", "invitations"]);

export function changeKind(row: Pick<ChangeLogRow, "entity" | "meta">): ChangeKind {
  if (row.entity === "appointments") {
    return row.meta?.kind === "event" || row.meta?.kind === "personal" ? "events" : "records";
  }
  if (row.entity === "clients") return "clients";
  if (MONEY_ENTITIES.has(row.entity)) return "money";
  if (PEOPLE_ENTITIES.has(row.entity)) return "people";
  return "settings";
}

export const CHANGE_ACTIONS: { value: ChangeLogRow["action"]; label: string }[] = [
  { value: "insert", label: "Создано" },
  { value: "update", label: "Изменено" },
  { value: "delete", label: "Удалено" },
  { value: "restore", label: "Возвращено" },
];

export type HistoryPeriod = "today" | "yesterday" | "week" | "month" | "all";

export const HISTORY_PERIODS: { value: HistoryPeriod; label: string }[] = [
  { value: "today", label: "Сегодня" },
  { value: "yesterday", label: "Вчера" },
  { value: "week", label: "7 дней" },
  { value: "month", label: "30 дней" },
  { value: "all", label: "Всё время" },
];

/** Границы периода по часам телефона: с какого момента и до какого. */
export function periodRange(period: HistoryPeriod, now: Date = new Date()): { from: string | null; to: string | null } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const day = 24 * 60 * 60 * 1000;
  switch (period) {
    case "today":
      return { from: start.toISOString(), to: null };
    case "yesterday":
      return { from: new Date(start.getTime() - day).toISOString(), to: start.toISOString() };
    case "week":
      return { from: new Date(start.getTime() - 6 * day).toISOString(), to: null };
    case "month":
      return { from: new Date(start.getTime() - 29 * day).toISOString(), to: null };
    default:
      return { from: null, to: null };
  }
}

/** Набор фильтров. Пусто в фасете — «Все». Автор `"system"` — сервер. */
export interface HistoryFilter {
  actors: string[];
  teams: string[];
  kinds: ChangeKind[];
  actions: ChangeLogRow["action"][];
}

export const EMPTY_HISTORY_FILTER: HistoryFilter = { actors: [], teams: [], kinds: [], actions: [] };

const actorKey = (row: Pick<ChangeLogRow, "actor_id">) => row.actor_id ?? "system";
const teamKey = (row: Pick<ChangeLogRow, "team_id">) => row.team_id ?? "none";

type Facet = keyof HistoryFilter;

function passes(row: ChangeLogRow, filter: HistoryFilter, skip?: Facet): boolean {
  if (skip !== "actors" && filter.actors.length > 0 && !filter.actors.includes(actorKey(row))) return false;
  if (skip !== "teams" && filter.teams.length > 0 && !filter.teams.includes(teamKey(row))) return false;
  if (skip !== "kinds" && filter.kinds.length > 0 && !filter.kinds.includes(changeKind(row))) return false;
  if (skip !== "actions" && filter.actions.length > 0 && !filter.actions.includes(row.action)) return false;
  return true;
}

export function filterChanges(rows: readonly ChangeLogRow[], filter: HistoryFilter): ChangeLogRow[] {
  return rows.filter((row) => passes(row, filter));
}

/** Счётчики вариантов, как в клиентах: у каждого фасета — с учётом всех
 *  остальных фильтров, но не своего (иначе выбранный ряд гасил бы соседей). */
export function historyFacetCounts(
  rows: readonly ChangeLogRow[],
  filter: HistoryFilter,
): Record<Facet, Record<string, number>> {
  const out: Record<Facet, Record<string, number>> = { actors: {}, teams: {}, kinds: {}, actions: {} };
  const bump = (facet: Facet, key: string) => {
    out[facet][key] = (out[facet][key] ?? 0) + 1;
  };
  for (const row of rows) {
    if (passes(row, filter, "actors")) bump("actors", actorKey(row));
    if (passes(row, filter, "teams")) bump("teams", teamKey(row));
    if (passes(row, filter, "kinds")) bump("kinds", changeKind(row));
    if (passes(row, filter, "actions")) bump("actions", row.action);
  }
  return out;
}

export function historyFilterCount(filter: HistoryFilter): number {
  return filter.actors.length + filter.teams.length + filter.kinds.length + filter.actions.length;
}

export interface ChangeLogItem {
  key: string;
  row: ChangeLogRow;
  /** Сколько строк склеено (пачка импорта, права по блокам). */
  count: number;
  /** Имена предметов пачки, без повторов. */
  labels: string[];
}

const BURST_MS = 3 * 60_000;

/** СКЛЕЙКА ПАЧЕК: подряд идущие строки одного автора, предмета и действия
 *  в пределах трёх минут — одна строка «×N». Импорт двухсот клиентов — одна
 *  строка, права по десяти блокам — одна «Права изменены · Иван». У прав
 *  склеивается только один человек; кроме прав, пачка — от трёх строк: две
 *  записи, созданные подряд руками, остаются двумя. Строки — свежие сверху. */
export function collapseBursts(rows: readonly ChangeLogRow[]): ChangeLogItem[] {
  const groups: { items: ChangeLogRow[] }[] = [];
  const out: ChangeLogItem[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    const sameKind =
      last &&
      last.row.actor_id === row.actor_id &&
      last.row.entity === row.entity &&
      last.row.action === row.action &&
      (row.entity !== "member_access" || last.row.label === row.label) &&
      (row.action !== "update" || row.entity === "member_access") &&
      Math.abs(Date.parse(last.row.created_at) - Date.parse(row.created_at)) <= BURST_MS;
    if (last && sameKind) {
      last.count += 1;
      if (row.label && !last.labels.includes(row.label)) last.labels.push(row.label);
      groups[groups.length - 1].items.push(row);
      continue;
    }
    out.push({ key: String(row.id), row, count: 1, labels: row.label ? [row.label] : [] });
    groups.push({ items: [row] });
  }
  // Пара — не пачка (кроме прав): раскладываем обратно.
  return out.flatMap((item, i) =>
    item.count === 2 && item.row.entity !== "member_access"
      ? groups[i].items.map((row) => ({
          key: String(row.id),
          row,
          count: 1,
          labels: row.label ? [row.label] : [],
        }))
      : [item],
  );
}

/** Куда ведёт тап: запись и клиент открываются, удалённое — никуда. */
export function changeTarget(row: Pick<ChangeLogRow, "entity" | "entity_id" | "action">):
  | { kind: "appointment"; id: string }
  | { kind: "client"; id: string }
  | null {
  if (!row.entity_id || row.action === "delete") return null;
  if (row.entity === "appointments") return { kind: "appointment", id: row.entity_id };
  if (row.entity === "clients") return { kind: "client", id: row.entity_id };
  return null;
}
