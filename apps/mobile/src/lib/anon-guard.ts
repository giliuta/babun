// ВОШЁЛ — ЗНАЧИТ, ЗАПРОС К ДАННЫМ НЕСЁТ ЕГО ТОКЕН (аудит 04.10).
//
// Обновление токена бывает неудачным: обрыв, 5xx, 409 входа. auth-js тогда
// на минуту запоминает отказ (`REFRESH_FAILURE_COOLDOWN_MS`), и всё это время
// `getSession()` отвечает «сессии нет». supabase-js на это не падает, а шлёт
// запрос ПУБЛИЧНЫМ ключом — анонимом. Аноним по RLS не видит ни строки, и
// сервер отвечает 200 и пустым списком. Для приложения это неотличимо от
// правды: сверка календаря заменяла кэш устройства пустотой и ставила
// отметку «сервер подтвердил пусто», перенос записи читал «записи нет» и
// убирал её с экрана, сверка напоминаний снимала все уведомления (03.10 так
// же родился второй «Личный» у AirFix).
//
// Пока человек вошёл, такой запрос к данным не уходит вовсе, а падает как
// обрыв связи — той же ошибкой, что у RN-fetch без сети. Её уже понимают все
// пути: обёртки кэша отдают сохранённое, очередь не тратит попыток, экраны
// говорят «Нет связи». Через минуту вход обновится, и запросы пойдут с
// токеном. Вход, обновление токена и публичные страницы без входа — мимо.

/** Пути данных Supabase: строки и RPC, функции, файлы. Вход (`/auth/v1/`) —
 *  мимо: им токен и обновляют. */
const DATA_PATH = /\/(rest|functions|storage)\/v1\//;

export interface AnonGuardInput {
  url: string;
  /** Заголовок `Authorization`, который поставил supabase-js. */
  authorization: string | null;
  /** Публичный ключ клиента: без сессии supabase-js кладёт его в `Bearer`. */
  publishableKey: string;
  /** Человек, вошедший на устройстве (`getSignedInUserId`: выбор компании в
   *  памяти либо его страницы ещё на экране); null — не вошёл. */
  signedInUserId: string | null;
}

/** Запрос к данным уходит без токена человека, хотя человек вошёл. */
export function isAnonymousDataRequest(input: AnonGuardInput): boolean {
  if (!input.signedInUserId) return false;
  if (!DATA_PATH.test(input.url)) return false;
  const auth = input.authorization?.trim() ?? "";
  if (auth === "") return true;
  return input.publishableKey !== "" && auth === `Bearer ${input.publishableKey}`;
}

/** Ошибка вместо анонимного запроса — ровно та, что у RN-fetch без сети:
 *  `isTransientNetworkError` и очередь узнают её по тексту. */
export function anonymousRequestError(): TypeError {
  return new TypeError("Network request failed");
}
