// КОЛОНКИ ПРАВ (STORY-087, аудит 24.09). В блоке «Записи» соседствуют
// сегменты на три положения («Не видит | Видит | Меняет») и на два
// («Не видит | Видит»). Прижатый вправо короткий сегмент ставил «Не видит»
// под колонку «Видит» соседа — глаз читает колонки и путался. Теперь у
// блока общая сетка: каждое положение стоит в своей колонке, а у права,
// которое нельзя менять, колонка «Меняет» просто пуста.

const COLUMN_ORDER = ["off", "read", "write"] as const;

export interface SegmentSlot {
  /** Колонка первого положения (0 — «Не видит»). */
  start: number;
}

/** Место сегмента в сетке «Не видит · Видит · Меняет». `null` — положения не
 *  из этой лестницы или идут с разрывом («Не видит · Меняет», «свои · все»):
 *  такой сегмент в сетку не встаёт и стоит как раньше. */
export function segmentSlot(levels: readonly string[]): SegmentSlot | null {
  const idx = levels.map((level) => COLUMN_ORDER.indexOf(level as (typeof COLUMN_ORDER)[number]));
  if (idx.length === 0 || idx.some((i) => i < 0)) return null;
  for (let i = 1; i < idx.length; i += 1) {
    if (idx[i] !== idx[i - 1] + 1) return null;
  }
  return { start: idx[0] };
}

/** Сколько колонок у блока: по самому длинному сегменту, что встаёт в сетку.
 *  0 — в блоке нет ни одного такого (сетка не нужна). */
export function sectionColumns(rows: readonly { levels: readonly string[] }[]): number {
  let columns = 0;
  for (const row of rows) {
    const slot = segmentSlot(row.levels);
    if (slot) columns = Math.max(columns, slot.start + row.levels.length);
  }
  return columns;
}
