// Column widths of the «Итого» table.

/** Ширины колонок — ОДНИ на шапку и на строки: иначе подпись и число
 *  разъезжаются на первом же длинном имени. */
// Цена и сумма шире (чтобы удобнее редактировать): в 52/58 четырёхзначная сумма упиралась в край поля.
export const COL_QTY = 78;
export const COL_PRICE = 66;
export const COL_SUM = 74;
export const COL_GAP = 8;

/** ПОЛЕ ЧИСЛА В «ИТОГО» НА ANDROID. Android добавляет полю шрифтовые поля
 *  сверху, и в низком поле (28–34) цифры срезались по верху. Один стиль на
 *  все поля листа — цена, сумма, название своей строки, скидка, ставка; на
 *  iOS эти свойства ничего не меняют. Каретка — цветом бренда (`selectionColor`
 *  у самого поля), а не системной бирюзой. */
export const ANDROID_INPUT = {
  paddingVertical: 0,
  includeFontPadding: false,
  textAlignVertical: "center",
} as const;
