// Write policy shared by the client wrappers: the toast hook, online-only
// writes for a non-active company, and queueing behind pending edits.

import { hasQueuedOps } from "../../db/cache/sql";
import { isOnline } from "../network";
import { OnlineOnlyWriteError } from "../cache-errors";

type ToastFn = (msg: string) => void;
let toastWarning: ToastFn = () => {};
/** Wire the toast helper once at app boot so wrappers can surface
 *  user-visible messages without each callsite re-passing it. */
export function setSyncToast(fn: ToastFn): void {
  toastWarning = fn;
}

/** Show a warning through the toast wired by `setSyncToast`. */
export function warnToast(msg: string): void {
  toastWarning(msg);
}

/** Опции записи. ЗАПИСЬ В НЕАКТИВНУЮ КОМПАНИЮ — ТОЛЬКО ОНЛАЙН: очередь
 *  выгружается под активной компанией, и отложенная операция уехала бы под
 *  чужим заголовком. `onlineOnly` — это текст отказа: экран знает, о чьих
 *  клиентах речь, и говорит это человеку словами. */
export interface CachedWriteOptions {
  onlineOnly?: string;
}

/** Отказ ДО оптимистичной записи: кэш и очередь не трогаются вовсе. */
export function refuseOfflineWrite(opts: CachedWriteOptions | undefined): void {
  if (opts?.onlineOnly && !isOnline()) {
    throw new OnlineOnlyWriteError(opts.onlineOnly);
  }
}

/** Сетевой сбой посреди записи в неактивную компанию: в очередь такая
 *  операция не ложится — откат и тот же честный отказ. */
export function refuseQueueing(opts: CachedWriteOptions | undefined): boolean {
  return !!opts?.onlineOnly;
}

/** ПРАВКА ВСТАЁТ ЗА ЖДУЩИМИ ПРАВКАМИ ЭТОГО ЖЕ КЛИЕНТА.
 *
 *  У записей правило давнее (`appointmentsCached`): при живой сети, но с
 *  неотправленными правками строки, новая встаёт в очередь за ними — иначе
 *  очередь дошлёт старую ПОСЛЕ свежей и перезапишет её. У клиентов прямая
 *  запись обгоняла очередь: удалил офлайн (удаление в очереди), первая
 *  попытка упала на 5xx, человек вернул клиента напрямую — а очередь
 *  досылала удаление: клиент снова в корзине со сроком стирания, и тост
 *  «Применены ваши изменения». То же с двумя правками телефона или заметки.
 *
 *  Запись «только в сети» (чужая компания) в очередь не ложится вовсе. */
export async function mustQueueBehind(
  id: string,
  opts: CachedWriteOptions | undefined,
): Promise<boolean> {
  if (refuseQueueing(opts)) return false;
  return hasQueuedOps("clients", id).catch(() => false);
}
