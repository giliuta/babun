// ОТПРАВКА ОЧЕРЕДИ СОТРУДНИКА.
//
// Правка без сети ложится в `member_queue` вызовом двери сервера; здесь она
// уходит, когда связь вернулась, — ТЕМ ЖЕ вызовом, и сервер проверяет право
// по блоку так же, как без очереди. Вызовы идут по одному в порядке
// постановки (`nextMemberOp`): правки одной записи не обгоняют друг друга.
//   • нет связи — вызов остаётся, повтор сам по себе: по возврату сети, по
//     возврату в приложение, по таймеру с нарастающей паузой;
//   • сервер отказал — вызов ждёт человека в «Синхронизации», причина
//     словами, и тост сразу (`subscribeMemberQueueEvents`);
//   • дошла часть (фото из пачки) — в очереди остаётся только хвост.
// Фоновой отправки при закрытом приложении нет: это нативная работа.

import { AppState } from "react-native";
import { onlineManager } from "@tanstack/react-query";
import {
  enqueueMemberOp,
  hasMemberOps,
  listMemberOps,
  markMemberOpRefused,
  noteMemberOpAttempt,
  removeMemberOp,
  replaceMemberOpArgs,
  type MemberQueuedOp,
} from "@babun/shared/db/cache/sql";
import { emitQueueChange } from "@babun/shared/sync";
import { getActiveTenantId } from "@/lib/active-tenant";
import type { Appointment } from "@babun/shared/local/appointments";
import {
  nextMemberOp,
  overlayMemberOps,
  retryDelayMs,
  sendFailure,
  type SendOutcome,
} from "./plan";

export type MemberOpSender = (op: MemberQueuedOp) => Promise<SendOutcome>;

export interface MemberQueueHost {
  /** Отправщик на каждый вид вызова. */
  senders: Readonly<Record<string, MemberOpSender>>;
  /** Ответ сервера → слова (какого блока не хватило). */
  describeRefusal: (op: MemberQueuedOp, error: string) => string;
  /** Вызов дошёл — перечитать то, что он поменял. */
  onSent: (op: MemberQueuedOp) => void;
}

type MemberQueueEvent = { kind: "refused"; op: MemberQueuedOp; words: string };

const listeners = new Set<(event: MemberQueueEvent) => void>();

/** Тост об отказе рисуется в дереве React (`ToastProvider`), а отправка идёт
 *  вне его — событие доносит отказ до экрана. */
export function subscribeMemberQueueEvents(cb: (event: MemberQueueEvent) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

let host: MemberQueueHost | null = null;
let draining = false;
let again = false;
let failuresInARow = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export function isMemberQueueRunning(): boolean {
  return host !== null;
}

/** Слить очередь сейчас. Повторный вызов во время слива не запускает второй
 *  параллельный — он просит ещё один проход после текущего. */
export function kickMemberQueue(): void {
  void drain();
}

async function drain(): Promise<void> {
  if (!host) return;
  if (draining) {
    again = true;
    return;
  }
  draining = true;
  try {
    do {
      again = false;
      await drainPass();
    } while (again);
  } finally {
    draining = false;
  }
}

async function drainPass(): Promise<void> {
  // Предохранитель от вечного цикла: за проход — не больше, чем разумно
  // накопить без сети; остаток уйдёт следующим проходом.
  for (let step = 0; step < 500; step += 1) {
    const current = host;
    if (!current || !onlineManager.isOnline()) return;
    let next: MemberQueuedOp | null;
    try {
      next = nextMemberOp(await listMemberOps(), getActiveTenantId());
    } catch {
      return; // локальной базы нет (веб, до загрузки)
    }
    if (!next) {
      failuresInARow = 0;
      return;
    }
    const sender = current.senders[next.kind];
    let outcome: SendOutcome;
    try {
      outcome = sender ? await sender(next) : { kind: "refused", error: `unknown:${next.kind}` };
    } catch (error) {
      outcome = sendFailure(error);
    }
    // Вышли из аккаунта посреди отправки — очередь уже стёрта, не трогаем.
    if (host !== current) return;
    switch (outcome.kind) {
      case "sent":
        await removeMemberOp(next.id);
        failuresInARow = 0;
        emitQueueChange();
        current.onSent(next);
        break;
      case "partial":
        await replaceMemberOpArgs(next.id, outcome.args);
        await noteMemberOpAttempt(next.id, outcome.error);
        emitQueueChange();
        scheduleRetry();
        return;
      case "offline":
        await noteMemberOpAttempt(next.id, outcome.error);
        emitQueueChange();
        scheduleRetry();
        return;
      case "refused": {
        const words = current.describeRefusal(next, outcome.error);
        await markMemberOpRefused(next.id, words);
        emitQueueChange();
        for (const cb of listeners) cb({ kind: "refused", op: next, words });
        break;
      }
    }
  }
}

function scheduleRetry(): void {
  failuresInARow += 1;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    kickMemberQueue();
  }, retryDelayMs(failuresInARow));
}

/** Запуск на время жизни роли сотрудника в компании. */
export function startMemberQueueRuntime(next: MemberQueueHost): () => void {
  host = next;
  failuresInARow = 0;
  const unsubOnline = onlineManager.subscribe((online: boolean) => {
    if (online) kickMemberQueue();
  });
  const foreground = AppState.addEventListener("change", (state) => {
    if (state === "active") kickMemberQueue();
  });
  kickMemberQueue();
  return () => {
    if (host === next) host = null;
    unsubOnline();
    foreground.remove();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };
}

type SendOrQueueResult<T> = { queued: false; data: T } | { queued: true };

/** ОТПРАВИТЬ ИЛИ ОТЛОЖИТЬ. Есть связь и у записи нет отложенных правок —
 *  вызов уходит сразу, отказ сервера летит вызывающему как раньше. Нет связи,
 *  обрыв по дороге или запись уже ждёт в очереди — вызов встаёт в очередь:
 *  иначе он обогнал бы прежние правки той же записи.
 *  `send` бросает СЫРУЮ ошибку — по ней и решается, связь это или отказ. */
export async function sendOrQueue<T>(input: {
  tenantId: string;
  recordId: string;
  kind: string;
  /** Что ляжет в очередь. Функцией — когда это зависит от оборвавшейся
   *  отправки (из пачки фото в очередь идёт только неуехавший хвост). */
  args: Record<string, unknown> | ((failure: unknown) => Record<string, unknown>);
  label: string;
  send: () => Promise<T>;
}): Promise<SendOrQueueResult<T>> {
  if (!isMemberQueueRunning()) return { queued: false, data: await input.send() };
  const waiting = await hasMemberOps(input.recordId).catch(() => false);
  let failure: unknown = null;
  if (onlineManager.isOnline() && !waiting) {
    try {
      return { queued: false, data: await input.send() };
    } catch (error) {
      if (sendFailure(error).kind !== "offline") throw error;
      failure = error;
    }
  }
  await enqueueMemberOp({
    tenant_id: input.tenantId,
    record_id: input.recordId,
    kind: input.kind,
    args: typeof input.args === "function" ? input.args(failure) : input.args,
    label: input.label,
  });
  emitQueueChange();
  kickMemberQueue();
  return { queued: true };
}

/** Список записей с сервера + правки, ещё лежащие в очереди этой компании
 *  (`overlayMemberOps`). Без локальной базы (веб) — список как есть. */
export async function withQueuedMemberOps(
  list: Appointment[],
  tenantId: string | null,
): Promise<Appointment[]> {
  try {
    const ops = await listMemberOps();
    return ops.length > 0 ? overlayMemberOps(list, ops, tenantId) : list;
  } catch {
    return list;
  }
}
