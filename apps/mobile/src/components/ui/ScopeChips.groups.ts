// Группы ленты — лист без React: его читают `ScopeChips` и тест.

export type ScopeChip = {
  id: string;
  name: string;
  color?: string | null;
  /** Аккаунт чипа. Между соседями из разных аккаунтов — тонкая черта
   *  (владелец 11.10: «Личный │ Y&D D&K V&M │ Студия», без подписей). */
  group?: string;
};

/** Подряд идущие чипы одного аккаунта. */
export function chipGroups(items: readonly ScopeChip[]): { key: string; items: ScopeChip[] }[] {
  const out: { key: string; items: ScopeChip[] }[] = [];
  for (const item of items) {
    const key = item.group ?? "";
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(item);
    else out.push({ key, items: [item] });
  }
  return out;
}
