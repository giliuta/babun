// Russian pluralization: 1 кондиционер, 2 кондиционера, 5 кондиционеров.
//
// Само правило живёт в `plural-ru.ts` — здесь только вторая форма вызова
// (три отдельных слова вместо кортежа). Пока правило было переписано в
// каждом модуле, оно и врало по-разному: то на 11, то на 21.
import { pluralRu } from "./plural-ru";

export function pluralize(n: number, one: string, few: string, many: string): string {
  return `${n} ${countWordRu(n, one, few, many)}`;
}

export function pluralizeAC(n: number): string {
  return pluralize(n, "кондиционер", "кондиционера", "кондиционеров");
}

/**
 * Returns just the word form (without the leading number). Useful when
 * the number lives in its own DOM node (e.g. coloured chip + label).
 *
 *   countWordRu(1, "запись", "записи", "записей") === "запись"
 *   countWordRu(5, "запись", "записи", "записей") === "записей"
 */
export function countWordRu(n: number, one: string, few: string, many: string): string {
  return pluralRu(n, [one, few, many]);
}

// Common app vocabulary so call sites stay typo-free.
export const pluralRecord = (n: number) =>
  pluralize(n, "запись", "записи", "записей");
export const pluralClient = (n: number) =>
  pluralize(n, "клиент", "клиента", "клиентов");
export const pluralVisit = (n: number) =>
  pluralize(n, "визит", "визита", "визитов");
export const pluralMessage = (n: number) =>
  pluralize(n, "сообщение", "сообщения", "сообщений");
