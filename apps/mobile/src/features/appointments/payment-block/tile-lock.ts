// ЗАМОК ПЛИТКИ СЧЁТА — СИНХРОННЫЙ. `busy` блока оплаты — значение последней
// перерисовки: два тапа в одном кадре оба видят «свободно», и каждый шлёт
// свой платёж со своим id (при частичной сумме сервер принимает оба). Ref
// встаёт на первом тапе и снимается, когда платёж ответил — успехом или
// отказом.

export interface TileLock {
  current: boolean;
}

/** Запускает платёж, если плитка свободна; занята — `false`, тап не считается. */
export function withTileLock(lock: TileLock, send: () => Promise<unknown>): boolean {
  if (lock.current) return false;
  lock.current = true;
  void send().finally(() => {
    lock.current = false;
  });
  return true;
}
