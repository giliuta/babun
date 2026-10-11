// Порядок подвижных блоков формы записи и события — лист без React, его
// читают `booking-prefs.ts` и тест.

/** Подвижные блоки в порядке команды: сохранённые — как сохранены, чужие
 *  имена пропускаются, а блок, которого в сохранённом нет (появился позже),
 *  встаёт за своим заводским соседом — новый блок не пропадает и не
 *  прыгает в начало. */
export function orderMovable<T extends string>(
  movable: readonly T[],
  stored: readonly string[] | null | undefined,
): T[] {
  if (!stored || stored.length === 0) return [...movable];
  const known = new Set<string>(movable);
  const out = stored.filter((id, i) => known.has(id) && stored.indexOf(id) === i) as T[];
  movable.forEach((id, i) => {
    if (out.includes(id)) return;
    const prev = movable.slice(0, i).reverse().find((p) => out.includes(p));
    out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, id);
  });
  return out;
}
