// History filters, facet counts and burst collapsing. No React, like
// the entry.

import { entityNoun, type ChangeLogRow } from "./row";

// ── ФИЛЬТРЫ ИСТОРИИ (как в клиентах — просто
//    красивые фильтры всех изменений) ─────────────────────────────────────

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
  if (row.entity === "appointment_photos") return "records";
  if (row.entity === "client_tag_assignments" || row.entity === "client_attachments") return "clients";
  if (row.entity === "masters") return "people";
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
  // Календарными днями, а не «минус 24 часа»: в ночь перехода на зимнее время
  // сутки длятся 25 часов, и вычитание сдвигало границу на час.
  const dayStart = (back: number) => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - back);
    return d.toISOString();
  };
  switch (period) {
    case "today":
      return { from: dayStart(0), to: null };
    case "yesterday":
      return { from: dayStart(1), to: dayStart(0) };
    case "week":
      return { from: dayStart(6), to: null };
    case "month":
      return { from: dayStart(29), to: null };
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
      // Одна команда и один вид предмета: событие и записи, доход и расход в
      // одну «×3» не склеиваются.
      last.row.team_id === row.team_id &&
      entityNoun(last.row).word === entityNoun(row).word &&
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
