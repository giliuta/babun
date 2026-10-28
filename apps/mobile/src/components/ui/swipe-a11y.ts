// ДЕЙСТВИЯ КРОМОК ДЛЯ VOICEOVER — ЧИСТАЯ ЧАСТЬ `SwipeRow`.
//
// Свайпа для ротора не существует: «Удалить», живущее только на кромке, было
// недостижимо. Строка получает действия своих кромок сама — а не каждый
// список по памяти. Свои действия строки остаются: их обработчик вызывается
// для всего, что не кромка. Действие с тем же словом, что у кромки, строка
// уже объявила — второй раз его в роторе не показываем.

/** Имена занятые, чтобы не совпасть с собственными действиями строки. */
export const SWIPE_LEADING = "swipe-leading";
export const SWIPE_TRAILING = "swipe-trailing";

interface SwipeA11yAction {
  name: string;
  label?: string;
}

export function mergeSwipeActions(
  own: readonly SwipeA11yAction[] | undefined,
  edges: { leading?: string; trailing?: string },
): SwipeA11yAction[] {
  const merged = [...(own ?? [])];
  const taken = new Set(merged.map((a) => a.label));
  // Левая кромка первой, «Удалить» последним — разрушительное в конце списка.
  if (edges.leading && !taken.has(edges.leading)) {
    merged.push({ name: SWIPE_LEADING, label: edges.leading });
  }
  if (edges.trailing && !taken.has(edges.trailing)) {
    merged.push({ name: SWIPE_TRAILING, label: edges.trailing });
  }
  return merged;
}
