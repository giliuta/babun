// ПРАВИЛА ОЧЕРЕДИ СОТРУДНИКА — без React, сети и SQLite, чтобы их держал тест.
//
// Очередь хранит вызовы дверей сервера (`member_queue`). Здесь решается:
// что отправлять следующим, что ждёт за отказом, что такое «нет связи», а что
// «сервер отказал», и как показать отложенные правки поверх списка записей,
// пока они не дошли.

import type { Appointment } from "@babun/shared/local/appointments";
import type { MemberQueuedOp } from "@babun/shared/db/cache/sql";
import { isTransientNetworkError } from "@babun/shared/sync/transient-error";

/** Чем кончилась отправка одного вызова. */
export type SendOutcome =
  | { kind: "sent" }
  /** Дошла часть (фото из пачки) — в очереди остаётся хвост. */
  | { kind: "partial"; args: Record<string, unknown>; error: string }
  | { kind: "offline"; error: string }
  | { kind: "refused"; error: string };

/** Ответ мутации, чья правка легла в очередь: экран оставляет мгновенный вид
 *  и не перечитывает список — без сети перечитка только упала бы. */
export const MEMBER_QUEUED = Object.freeze({ memberQueued: true as const });

export function isMemberQueued(value: unknown): boolean {
  return (
    !!value && typeof value === "object" && (value as { memberQueued?: unknown }).memberQueued === true
  );
}

/** Вид вызова, который убирает запись с экрана. */
const REMOVES_RECORD = new Set(["trash", "delete"]);

/** Следующий вызов к отправке в этой компании. Порядок — постановки; вызов
 *  записи, за которым стоит отказ сервера по ней же, ждёт человека: он
 *  строился поверх отклонённого и без него может лечь неверно. Записи без
 *  отказов идут дальше. */
export function nextMemberOp(
  ops: readonly MemberQueuedOp[],
  tenantId: string | null,
): MemberQueuedOp | null {
  if (!tenantId) return null;
  const blocked = new Set<string>();
  for (const op of ops) {
    if (op.tenant_id !== tenantId) continue;
    if (blocked.has(op.record_id)) continue;
    if (op.refused) {
      blocked.add(op.record_id);
      continue;
    }
    return op;
  }
  return null;
}

/** Вызовы, которые стоят за отказом по своей записи: в «Синхронизации» они
 *  говорят «ждёт» отклонённую правку, а не «отправляется». */
export function heldBehindRefusal(ops: readonly MemberQueuedOp[]): Set<number> {
  const refusedRecords = new Set<string>();
  const held = new Set<number>();
  for (const op of ops) {
    if (op.refused) {
      refusedRecords.add(op.record_id);
    } else if (refusedRecords.has(op.record_id)) {
      held.add(op.id);
    }
  }
  return held;
}

/** Текст ошибки любого вида: `Error`, ошибка PostgREST (объект с `message`)
 *  или что-то третье. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(error);
}

/** Ошибка отправки → «нет связи» (вызов ждёт и повторится сам) или «сервер
 *  отказал» (ждёт человека). Обрыв, таймаут и 5xx — связь; остальное — ответ
 *  сервера, повтор его не изменит. */
export function sendFailure(error: unknown): SendOutcome {
  const message = errorMessage(error);
  // Просроченный вход — тоже не отказ: токен обновится, и тот же вызов пройдёт.
  return isTransientNetworkError(error) || EXPIRED_LOGIN.test(message)
    ? { kind: "offline", error: message }
    : { kind: "refused", error: message };
}

const EXPIRED_LOGIN = /jwt expired|invalid jwt|jwt.*expired|refresh token/i;

/** Строка вызова в «Синхронизации» — словами по виду и полям правки. Считается
 *  при показе, а не хранится: так она переводится на язык интерфейса. */
export function memberOpLabel(op: Pick<MemberQueuedOp, "kind" | "args">): string {
  switch (op.kind) {
    case "create":
      return "Новая запись";
    case "copy":
      return "Копия записи";
    case "trash":
    case "delete":
      return "Удаление записи";
    case "pay":
      return "Оплата записи";
    case "unpay":
      return "Снятие оплаты";
    case "photos":
      return "Фото записи";
    case "update": {
      const patch = op.args.p_patch;
      const keys = patch && typeof patch === "object" ? Object.keys(patch) : [];
      if (keys.length > 0 && keys.every((k) => PLACE_KEYS.has(k))) return "Перенос записи";
      if (keys.length === 1 && keys[0] === "comment") return "Заметка записи";
      if (keys.length === 1 && keys[0] === "status") return "Статус записи";
      return "Правка записи";
    }
    default:
      return "Правка записи";
  }
}

const PLACE_KEYS = new Set(["date", "time_start", "time_end", "total_duration", "team_id"]);

/** Пауза перед повтором после обрыва: связь «есть», а сервер не отвечает —
 *  не долбить его каждую секунду. */
export function retryDelayMs(failuresInARow: number): number {
  const steps = [5_000, 15_000, 60_000];
  return steps[Math.min(Math.max(failuresInARow, 1), steps.length) - 1];
}

/** Как запись выглядит у вызова в очереди: новая — целиком, правка — её
 *  поля, оплата — денежные поля записи после оплаты. Кладёт отправитель в
 *  `args.view`; серверу это поле не уходит. */
function viewOf(op: MemberQueuedOp): Partial<Appointment> | null {
  const view = op.args.view;
  return view && typeof view === "object" ? (view as Partial<Appointment>) : null;
}

/** СПИСОК С СЕРВЕРА + ОТЛОЖЕННЫЕ ПРАВКИ. Перечитка календаря, пока очередь
 *  не дошла (сеть вернулась, обновился экран), иначе вернула бы прежнюю
 *  запись: перенос «отскочил» бы назад до отправки. Отклонённое сервером не
 *  накладывается — на экране правда сервера. */
export function overlayMemberOps(
  list: readonly Appointment[],
  ops: readonly MemberQueuedOp[],
  tenantId: string | null,
): Appointment[] {
  let out = [...list];
  for (const op of ops) {
    if (op.tenant_id !== tenantId || op.refused) continue;
    if (REMOVES_RECORD.has(op.kind)) {
      out = out.filter((a) => a.id !== op.record_id);
      continue;
    }
    const view = viewOf(op);
    if (!view) continue;
    const at = out.findIndex((a) => a.id === op.record_id);
    if (at >= 0) {
      out[at] = { ...out[at], ...view, id: op.record_id };
    } else if (op.kind === "create" || op.kind === "copy") {
      out.push({ ...(view as Appointment), id: op.record_id });
    }
  }
  return out;
}
