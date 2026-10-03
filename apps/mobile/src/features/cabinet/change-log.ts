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
    if (prev === undefined || (!prev.includes("→") && text.includes("→"))) byWord.set(word, text);
  }
  const known = [...byWord.values()];
  const shown = known.slice(0, 3);
  const rest = known.length - shown.length + unknown;
  if (shown.length === 0) return rest > 0 ? "Служебные поля" : "";
  return rest > 0 ? `${shown.join(" · ")} · ещё ${rest}` : shown.join(" · ");
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
