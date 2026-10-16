// КАК НАЗЫВАЕТСЯ ЗАПИСЬ, КОГДА ИМЕНИ КЛИЕНТА В ЗАГОЛОВКЕ НЕТ.
//
// У события заголовок — его тип («Обед», «Закупка»). Событие без типа форма
// сохраняет со словом «Событие», и вся неделя пестрела одинаковыми
// «Событие», хотя человек написал в заметке, что это. Поэтому без типа
// заголовком становится первая строка заметки, а слово «Событие» остаётся
// только у пустого события. У работы — её комментарий, как раньше.

/** Слово, которым форма называет событие без типа. */
export const UNTYPED_EVENT = "Событие";

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
  if (comment && comment !== UNTYPED_EVENT) return comment;
  return firstLine(a.event_notes) || comment;
}

/** Заголовок события взят из заметки — третьей строкой блока её не повторяем. */
export function eventTitleIsNote(a: Titled): boolean {
  const comment = (a.comment ?? "").trim();
  return (a.kind ?? "work") !== "work" &&
    (!comment || comment === UNTYPED_EVENT) &&
    firstLine(a.event_notes) !== "";
}
