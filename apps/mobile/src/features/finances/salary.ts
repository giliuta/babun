// ЗАРПЛАТА — РАСХОД С ПОЛУЧАТЕЛЕМ (владелец 2026-09-24: «зарплату мастеров
// я планировал как категорию: „Зарплата Даня“ — и записывать туда расход»).
//
// Категория одна на всех — глобальная «Зарплата» (`slug = 'salary'`), а человек
// выбирается блоком «Кому» в форме операции и ложится в `master_id` проводки.
// Категория на каждого («Зарплата Даня», «Зарплата Дима») размножила бы
// справочник и развалила разбор расхода: «сколько ушло на зарплату» пришлось
// бы складывать руками. С получателем разбор делит зарплату по людям сам.

export const SALARY_SLUG = "salary";

export function isSalaryCategory(
  category: { slug: string } | null | undefined,
): boolean {
  return category?.slug === SALARY_SLUG;
}

/** «Зарплата · Даня» — заголовок строки с получателем. Без получателя —
 *  просто заголовок. */
export function withPayee(title: string, payee: string | null | undefined): string {
  const name = payee?.trim();
  return name ? `${title} · ${name}` : title;
}

export interface PayeeCandidate {
  id: string;
  full_name: string;
  team_id: string | null;
  is_active: boolean;
}

/**
 * Кого предложить в «Кому». Сначала сотрудники календаря операции — зарплату
 * платят со счёта команды, и её люди нужны первыми; потом остальные. Уволенных
 * не предлагаем, но уже выбранного оставляем: правка старой выплаты не должна
 * терять человека, которого с тех пор убрали.
 */
export function payeeOptions<T extends PayeeCandidate>(
  people: readonly T[],
  teamId: string | null,
  selectedId: string | null,
): T[] {
  const byName = (a: T, b: T) => a.full_name.localeCompare(b.full_name, "ru");
  const live = people.filter((p) => p.is_active || p.id === selectedId);
  const own = live.filter((p) => teamId !== null && p.team_id === teamId).sort(byName);
  const rest = live.filter((p) => !(teamId !== null && p.team_id === teamId)).sort(byName);
  return [...own, ...rest];
}

/** Имя получателя по id; нет в справочнике — `null` (строка остаётся без
 *  имени, а не с «Сотрудник удалён»: деньги важнее подписи). */
export function payeeName(
  people: readonly { id: string; full_name: string }[] | undefined,
  masterId: string | null | undefined,
): string | null {
  if (!masterId || !people) return null;
  return people.find((p) => p.id === masterId)?.full_name ?? null;
}
