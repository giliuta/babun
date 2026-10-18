/** Клавиша «+ VAT» и строка налога: владельцу, у которого есть ставка, и всегда —
 *  пока строка уже открыта (её нужно уметь закрыть и поправить): нулевая ставка
 *  в поле не должна уносить саму строку. */
export function vatControlsVisible(a: { isOwner: boolean; rate: number; shown: boolean }): boolean {
  return a.isOwner && (a.rate > 0 || a.shown);
}
