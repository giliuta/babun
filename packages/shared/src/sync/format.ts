// Подписи очереди синхронизации для экрана «Кабинет › Синхронизация».
// Чистые функции без платформенных зависимостей: `QueuedOp` приезжает из
// SQLite-кэша, который работает и на устройстве, и в вебе.

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
