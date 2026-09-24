// КАТЕГОРИЯ РЕШАЕТ, КОГО ПРИКРЕПИТЬ К ОПЕРАЦИИ (владелец 2026-09-24:
// «при добавлении категории надо понимать, что она должна делать — зарплата
// смотрит сотрудников, другая прикрепляет клиента»; «категорий не должно быть
// готовых — клиент сам их создаёт»).
//
// Поэтому ни одно имя и ни один slug здесь не зашит: «Зарплата» — просто
// категория компании с `attach = 'employee'`, и назвать её можно как угодно
// («Выплаты», «ЗП бригаде»). Сотрудник ложится в `master_id`, клиент — в
// `client_id` проводки.

import type {
  CategoryAttach,
  FinanceCategory,
  FinanceCategoryKind,
} from "@babun/shared/db/repositories/finance-categories";

export function attachOf(
  category: { attach?: CategoryAttach } | null | undefined,
): CategoryAttach {
  return category?.attach ?? "none";
}

/** Категории, которые человек выбирает руками: свои, этого вида, не скрытые
 *  (скрытую, уже стоящую на операции, оставляем — иначе правка её потеряет).
 *  Служебные («Услуги» оплаты записи, «Возврат», пересчёт кассы) сюда не
 *  входят: ими подписывает деньги сервер. */
export function pickableCategories(
  categories: readonly FinanceCategory[],
  type: FinanceCategoryKind,
  keepId: string | null,
): FinanceCategory[] {
  return categories.filter(
    (c) => !c.is_system && c.type === type && (!c.hidden || c.id === keepId),
  );
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
