// STORY-062 slice 2 — pure formatters for the sync queue UI.
//
// Verbatim port of apps/web/src/lib/sync/format.ts. The only change is
// the import path for `QueuedOp` — it now comes from the SQL cache
// module (which re-exports the identical type from the web cache), so
// this file has zero web-only dependencies and runs on RN unchanged.

import type { QueuedOp } from "../db/cache/sql";

export function labelForOp(op: Pick<QueuedOp, "table" | "op">): string {
  const noun =
    op.table === "clients"
      ? "Клиент"
      : op.table === "appointments"
        ? "Запись"
        : "Тег";
  const verb =
    op.op === "insert"
      ? "создание"
      : op.op === "update"
        ? "обновление"
        : "удаление";
  return `${noun} / ${verb}`;
}

export function relativeTime(ms: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs - ms);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин назад`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ч назад`;
  const days = Math.floor(hrs / 24);
  return `${days} дн назад`;
}

export function pluralizeOps(n: number): string {
  // RU: 1 операция, 2-4 операции, 5+ операций. The mod-100 carve-out
  // covers 11-14 which are «-надцать» nouns and always use the
  // many-form regardless of the last digit.
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "операция";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    return "операции";
  return "операций";
}
