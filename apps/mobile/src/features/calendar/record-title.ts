// КАК НАЗЫВАЕТСЯ ЗАПИСЬ, КОГДА ИМЕНИ КЛИЕНТА В ЗАГОЛОВКЕ НЕТ.
//
// У события заголовок — его тип («Обед», «Закупка»). Событие без типа форма
// сохраняет со словом «Событие», и вся неделя пестрела одинаковыми
// «Событие», хотя человек написал в заметке, что это. Поэтому без типа
// заголовком становится первая строка заметки, а слово «Событие» остаётся
// только у пустого события. У работы — её комментарий, как раньше.

/** МАРКЕР «СОБЫТИЕ БЕЗ ТИПА» В БАЗЕ — ВСЕГДА РУССКИМ. Это данные, а не
 *  подпись: без пометки плагин переводит литерал на языке телефона, и
 *  английский телефон писал в `comment` «Event», а русский потом принимал его
 *  за тип и печатал «Event» вместо заметки. */
export const UNTYPED_EVENT = /* i18n-ignore */ "Событие";

/** Тот же маркер, записанный телефонами на других языках до этой пометки.
 *  Строки в базе уже лежат, поэтому они читаются как «без типа» навсегда;
 *  новых таких не появится. */
const UNTYPED_EVENT_WRITTEN = new Set<string>([
  UNTYPED_EVENT,
  /* i18n-ignore */ "Event",
  /* i18n-ignore */ "Събитие",
  /* i18n-ignore */ "Ereignis",
  /* i18n-ignore */ "Συμβάν",
  /* i18n-ignore */ "Evento",
  /* i18n-ignore */ "Подія",
]);

/** Событие без типа — по маркеру в базе на любом языке. */
export function isUntypedEventComment(comment: string): boolean {
  return UNTYPED_EVENT_WRITTEN.has(comment.trim());
}

type Titled = {
  kind?: string | null;
  comment?: string | null;
  event_notes?: string | null;
};

const firstLine = (text: string | null | undefined): string =>
  (text ?? "").trim().split("\n")[0]?.trim() ?? "";

/** Заголовок записи без клиента: тип события, иначе первая строка заметки
 *  события, иначе прежний комментарий. Пусто — заголовка нет. */
export function recordComment(a: Titled): string {
  const comment = (a.comment ?? "").trim();
  if ((a.kind ?? "work") === "work") return comment;
  if (comment && !isUntypedEventComment(comment)) return comment;
  // Пустое событие называется словом на языке телефона, а не маркером базы.
  return firstLine(a.event_notes) || (comment ? "Событие" : "");
}

/** Заголовок события взят из заметки — третьей строкой блока её не повторяем. */
export function eventTitleIsNote(a: Titled): boolean {
  const comment = (a.comment ?? "").trim();
  return (a.kind ?? "work") !== "work" &&
    (!comment || isUntypedEventComment(comment)) &&
    firstLine(a.event_notes) !== "";
}
