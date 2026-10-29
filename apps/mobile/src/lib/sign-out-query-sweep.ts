import type { QueryClient } from "@tanstack/react-query";

/** Чистка кэша запросов на «Выйти», пока страницы вышедшего ещё на экране:
 *  сносятся только запросы без наблюдателей. Наблюдаемый запрос, снесённый
 *  под живым экраном, его же перерисовка заводит заново и шлёт в сеть — уже
 *  без токена. Их сносит `clearQueriesLeftBySignOut`, когда на экране логин.
 *  Держит `sign-out-late-requests.test.ts`. */
export function removeUnobservedQueries(qc: QueryClient): void {
  qc.removeQueries({ predicate: (query) => query.getObserversCount() === 0 });
}
