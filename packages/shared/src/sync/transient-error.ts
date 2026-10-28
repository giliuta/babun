// TRANSPORT FAILURE vs SERVER REJECTION — the one boundary the offline layer
// relies on.
//
// A transport failure (no network, timeout, abort, gateway 5xx while the
// project restarts) is retried: the write waits in the queue and the
// optimistic UI stays. Anything else is the server's answer — RLS, a
// constraint, a business rule, a 4xx — which a retry cannot fix; such a write
// must surface to the user and must never enter the replay queue.
//
// supabase-js reports a dropped connection as «TypeError: Failed to fetch»
// (Chrome), «Load failed» (Safari/WebKit) or «Network request failed»
// (React Native fetch). PostgrestError does not always carry a numeric
// status, so both the status and the gateway wording are checked.
//
// ГОЛОЕ ЧИСЛО 502/503/504 В ТЕКСТЕ — НЕ ОБРЫВ. Очередь заворачивает ответ
// сервера в `Error(message)`, статус теряется, и решает только текст. Отказ
// функции базы с числом внутри («Сумма 503 больше итога») считался бы
// обрывом вечно: правка не тратит попыток, держит перечитку календаря, и
// чужие правки на телефоне не появляются. Шлюз называет себя словами
// (bad gateway, service unavailable, gateway timeout, upstream) — их и ищем.

const TRANSPORT_MESSAGE =
  /failed to fetch|load failed|network request failed|network error|fetch failed|socket|econn|abort/i;

const TRANSIENT_MESSAGE =
  /failed to fetch|load failed|network request failed|network error|fetch failed|timed? ?out|socket|econn|abort|bad gateway|service unavailable|gateway time|upstream/i;

function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message
    : typeof (err as { message?: unknown })?.message === "string"
      ? (err as { message: string }).message
      : String(err);
}

/** Ответа не было вовсе: запрос не дошёл или оборвался. В отличие от
 *  «сервер ответил 5xx / таймаутом», это повторяется сколько угодно долго —
 *  сеть вернётся, и правка уйдёт. */
export function isTransportFailure(err: unknown): boolean {
  return TRANSPORT_MESSAGE.test(messageOf(err));
}

export function isTransientNetworkError(err: unknown): boolean {
  const withStatus = err as { status?: unknown; statusCode?: unknown };
  const httpStatus =
    typeof withStatus?.status === "number"
      ? withStatus.status
      : typeof withStatus?.statusCode === "number"
        ? withStatus.statusCode
        : 0;
  if (httpStatus >= 500) return true;
  return TRANSIENT_MESSAGE.test(messageOf(err));
}
