import { money } from "@babun/shared/common/utils/money";

// «ИСТОРИЯ ИЗМЕНЕНИЙ» — КАК ЧИТАТЬ СТРОКУ ЖУРНАЛА (любое изменение записывается
// в историю, чтобы чётко отслеживать, что делает сам человек и каждый из его партнёров).
//
// Журнал пишет сервер (`change_log`, триггер `log_change()`): таблица,
// действие, имя предмета на тот момент, подпись (дата, сумма) и поля
// {поле: [было, стало]}. Здесь — только слова: «Запись изменена · Анастасия
// · Начало 09:30 → 10:00». Род причастия — от предмета: глагола в мужском
// роде у автора нет, у партнёра может быть любой.
//
// Лист без React — правила под тестом.
//
// Row shape and nouns, field words, field wording and filters live in
// `./change-log/`; this path stays the public entry.

import { PARTICIPLES, entityNoun, type ChangeLogRow } from "./change-log/row";
import { LEVEL_WORDS } from "./change-log/words";
import { shortDate } from "./change-log/fields";

export { entityNoun, type ChangeLogRow } from "./change-log/row";
export {
  allChanges,
  changesSummary,
  describeField,
  shortDate,
} from "./change-log/fields";
export {
  CHANGE_ACTIONS,
  CHANGE_KINDS,
  EMPTY_HISTORY_FILTER,
  HISTORY_PERIODS,
  changeKind,
  collapseBursts,
  filterChanges,
  historyFacetCounts,
  historyFilterCount,
  periodRange,
  type ChangeKind,
  type ChangeLogItem,
  type HistoryFilter,
  type HistoryPeriod,
} from "./change-log/filters";

/** Заголовок строки: «Запись изменена», «Партнёр добавлен», «Права изменены». */
export function changeTitle(row: Pick<ChangeLogRow, "entity" | "meta" | "action" | "changes">): string {
  switch (row.entity) {
    case "member_access":
      return "Права изменены";
    case "member_calendars":
      return row.action === "delete" ? "Доступ к календарю закрыт" : "Доступ к календарю открыт";
    case "tenant_members":
      return row.action === "insert" ? "Партнёр добавлен" : row.action === "delete" ? "Партнёр удалён" : "Партнёр изменён";
    case "client_tag_assignments":
      return row.action === "delete" ? "Тег снят" : "Тег поставлен";
    case "client_attachments":
      return row.action === "delete" ? "Файл удалён" : row.action === "insert" ? "Файл добавлен" : "Файл изменён";
    case "appointment_photos":
      return row.action === "delete" ? "Фото удалено" : row.action === "insert" ? "Фото добавлено" : "Фото изменено";
    case "invitations":
      if (row.action === "insert") return "Приглашение отправлено";
      if (row.action === "delete") return "Приглашение отозвано";
      return row.changes && "accepted_at" in row.changes ? "Приглашение принято" : "Приглашение изменено";
  }
  const noun = entityNoun(row);
  return `${noun.word} ${PARTICIPLES[row.action][noun.gender]}`;
}

/** Вторая строка: имя предмета и подпись — «Анастасия · 4 окт, 10:00»,
 *  «Топливо · €40». */
export function changeSubject(row: Pick<ChangeLogRow, "entity" | "label" | "meta">): string {
  const meta = row.meta ?? {};
  const parts: string[] = [];
  if (row.label) parts.push(row.label);
  if (row.entity === "client_tag_assignments" && meta.tag) parts.push(String(meta.tag));
  if (row.entity === "client_attachments" && meta.client) parts.push(String(meta.client));
  if (row.entity === "day_cities" && meta.date) parts.push(shortDate(meta.date));
  if (row.entity === "member_access" && meta.block_title) {
    const level = LEVEL_WORDS[String(meta.level ?? "")];
    parts.push(level ? `${String(meta.block_title)}: ${level}` : String(meta.block_title));
  }
  if (row.entity === "appointments" || row.entity === "appointment_photos") {
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

/** Куда ведёт тап: запись и клиент открываются, удалённое — никуда. */
export function changeTarget(row: Pick<ChangeLogRow, "entity" | "entity_id" | "action">):
  | { kind: "appointment"; id: string }
  | { kind: "client"; id: string }
  | null {
  if (!row.entity_id || row.action === "delete") return null;
  if (row.entity === "appointments" || row.entity === "appointment_photos") {
    return { kind: "appointment", id: row.entity_id };
  }
  if (row.entity === "clients" || row.entity === "client_tag_assignments") {
    return { kind: "client", id: row.entity_id };
  }
  return null;
}
