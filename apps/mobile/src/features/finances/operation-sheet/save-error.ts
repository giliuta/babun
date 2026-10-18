// Что сказать человеку, когда сохранение операции упало.

/** Связь оборвалась МЕЖДУ нажатием и ответом: запрос мог дойти. Совет
 *  безопасен: id привязан к содержимому, и повтор без правок сервер не
 *  задвоит, а проверка в ленте — единственный честный ответ на «записалось?». */
export const CONNECTION_LOST_MID_SAVE =
  "Связь оборвалась — проверьте, записалась ли операция, прежде чем повторять";

/** Сырые тексты обрыва от fetch / AbortController / PostgREST. */
const NETWORK_FAILURE =
  /network request failed|failed to fetch|load failed|fetch failed|^\s*aborted\s*$|(request|operation|signal) (was |is )?aborted|timed? ?out|connection (was )?(lost|reset|closed)/i;

export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === "AbortError" || NETWORK_FAILURE.test(error.message);
  }
  return typeof error === "string" && NETWORK_FAILURE.test(error);
}

/** Текст ошибки сохранения: обрыв связи — человеческими словами, остальное —
 *  ответ сервера как есть (его переводит вызывающий). */
export function saveErrorText(
  error: unknown,
  online: boolean,
): { kind: "connection" | "server"; text: string } {
  if (!online || isNetworkFailure(error)) {
    return { kind: "connection", text: CONNECTION_LOST_MID_SAVE };
  }
  const message = error instanceof Error ? error.message : "";
  return { kind: "server", text: message || "Не удалось сохранить операцию" };
}
