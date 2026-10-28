// Field-level wording of a change: «Начало 09:30 → 10:00», list diffs,
// summaries. No React, like the entry.

import { money } from "@babun/shared/common/utils/money";
import {
  FIELD_WORDS,
  MONEY_FIELDS,
  PAYMENT_METHOD_WORDS,
  PAYMENT_STATUS_WORDS,
  STATUS_WORDS,
  VALUE_WORDS,
} from "./words";

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** «2026-10-04» → «4 окт». Не дата — как есть. */
export function shortDate(value: unknown): string {
  const s = String(value ?? "");
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""}`.trim();
}

/** Статуса записи у владельца нет:
 *  «запланирована → выполнена» ставит оплата сама, и журнал о нём молчит —
 *  не строкой и не «служебным полем». Словом остаётся только отмена. */
const VISIT_STATES = new Set(["scheduled", "in_progress", "completed"]);

function visitStatusChange(field: string, change: unknown): string | null | undefined {
  if (field !== "status" || !Array.isArray(change)) return undefined;
  const [before, after] = change.map(String);
  if (VISIT_STATES.has(before) && VISIT_STATES.has(after)) return null;
  if (VISIT_STATES.has(before) && after === "cancelled") return "Отменена";
  if (before === "cancelled" && VISIT_STATES.has(after)) return "Восстановлена";
  return undefined;
}

/** МАТЕРИАЛЫ ЗАПИСИ СТАВИТ СЕРВЕР, НЕ ЧЕЛОВЕК. `material_lines` — снимок
 *  материалов услуг по ценам дня закрытия: триггер
 *  `freeze_appointment_materials` заполняет его, когда визит закрывается
 *  (в том числе оплатой), и пересобирает при смене услуг, а присланное
 *  приложением отбрасывает. Человек его не правит — его правку видно по
 *  «Услугам» или по оплате, а строка «Материалы» у оплаты читалась как
 *  изменение, которого никто не делал. Журнал о нём молчит, как о статусе
 *  визита: не словом и не «служебным полем». */
const SERVER_FIELDS = new Set(["material_lines"]);

/** Поле, о котором журнал молчит совсем. */
function silent(field: string, change: unknown): boolean {
  return SERVER_FIELDS.has(field) || visitStatusChange(field, change) === null;
}

function fieldValue(field: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return "—";
  if (field.endsWith("_id") || (field.endsWith("_at") && field !== "reminder_at")) return null;
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (field === "status") {
    return STATUS_WORDS[String(value)] ?? VALUE_WORDS.invoice_status[String(value)] ?? String(value);
  }
  if (field === "payment_status") return PAYMENT_STATUS_WORDS[String(value)] ?? String(value);
  if (field === "payment_method") return PAYMENT_METHOD_WORDS[String(value)] ?? String(value);
  const words = VALUE_WORDS[field];
  if (words && String(value) in words) return words[String(value)];
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
  if (SERVER_FIELDS.has(field)) return null;
  const visit = visitStatusChange(field, change);
  if (visit !== undefined) return visit;
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
    if (silent(field, change)) continue;
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
    if (silent(field, change)) continue;
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
