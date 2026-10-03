import { isConfirmedNetworkUnavailable } from "@/features/settings/server-read-fallback";

// СЛОВА ЭКРАНА, КОГДА СЕРВЕР НЕ ОТВЕТИЛ (владелец 03.10, зависший сервер).
// Под облаком стояло «listTransactionsForRange: TypeError: Network request
// failed» — текст для программиста. Обрыв связи говорит по-человечески, как
// «Не удалось загрузить календарь»; настоящий отказ сервера (права, данные)
// остаётся своим текстом — его надо видеть.

/** Похоже на обрыв: нет сети, вышло время, упал сервер или шлюз (5xx). */
export function looksLikeNoConnection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string; details?: string; status?: number };
  if (isConfirmedNetworkUnavailable(e)) return true;
  if (typeof e.status === "number" && e.status >= 500) return true;
  const text = `${e.message ?? ""} ${e.details ?? ""}`;
  return /(?:abort|timed? ?out|timeout|сеть не отвечает|\b5(?:0[234]|2[0-9])\b)/i.test(text);
}

/** Заголовок и пояснение экрана ошибки: обрыв — словами, отказ — как есть. */
export function loadErrorWords(
  error: unknown,
  what: { failed: string; later: string },
): { title: string; subtitle: string } {
  if (looksLikeNoConnection(error)) {
    return { title: "Нет связи с сервером", subtitle: what.later };
  }
  const message = error instanceof Error ? error.message : "";
  return { title: what.failed, subtitle: message || "Повторите попытку." };
}

/** То же для ДЕЙСТВИЯ (удалить, сохранить): обрыв — «Нет связи с сервером» и
 *  что именно не сделано, отказ сервера — своим текстом под словом неудачи.
 *  Под «Не удалось удалить» стояло «TypeError: Network request failed»
 *  (03.10, удаление клиента работодателя без сети). */
export function writeErrorWords(
  error: unknown,
  what: { failed: string; notDone: string },
): { title: string; subtitle: string } {
  return loadErrorWords(error, {
    failed: what.failed,
    later: `${what.notDone}. Повторите, когда связь вернётся.`,
  });
}
