export const COLD_OFFLINE_CACHE_MISS = "COLD_OFFLINE_CACHE_MISS" as const;

export type ColdOfflineResource = "appointments" | "clients";

/**
 * The device is offline and has never stored an authoritative snapshot for
 * this resource. This is an unknown state, not an authoritative empty list.
 */
export class ColdOfflineCacheMissError extends Error {
  readonly code = COLD_OFFLINE_CACHE_MISS;

  constructor(readonly resource: ColdOfflineResource) {
    super(`Нет сохранённой офлайн-копии: ${resource}`);
    this.name = "ColdOfflineCacheMissError";
  }
}

export function isColdOfflineCacheMissError(
  error: unknown,
): error is ColdOfflineCacheMissError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === COLD_OFFLINE_CACHE_MISS
  );
}

export const ONLINE_ONLY_WRITE = "ONLINE_ONLY_WRITE" as const;

/**
 * Запись в компанию, которая сейчас НЕ открыта в календаре. Очереди для неё
 * нет: выгрузка идёт под активной компанией, и такая операция уехала бы под
 * чужим заголовком — вставку сервер отобьёт, а удаление вернёт ноль строк и
 * прочитается как «удалять нечего», то есть работа пропадёт молча. Поэтому
 * отказ выдаётся ДО оптимистичной записи, а текст приходит от экрана: он
 * знает, о чьих клиентах речь.
 */
export class OnlineOnlyWriteError extends Error {
  readonly code = ONLINE_ONLY_WRITE;

  constructor(message: string) {
    super(message);
    this.name = "OnlineOnlyWriteError";
  }
}

export function isOnlineOnlyWriteError(
  error: unknown,
): error is OnlineOnlyWriteError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === ONLINE_ONLY_WRITE
  );
}
