// КАТЕГОРИЯ РЕШАЕТ, КОГО ПРИКРЕПИТЬ К ОПЕРАЦИИ (владелец 2026-09-24:
// «при добавлении категории надо понимать, что она должна делать — зарплата
// смотрит сотрудников, другая прикрепляет клиента»; «категорий не должно быть
// готовых — клиент сам их создаёт»).
//
// Поэтому ни одно имя и ни один slug здесь не зашит: «Зарплата» — просто
// категория компании с `ask_employee`, и назвать её можно как угодно
// («Выплаты», «ЗП бригаде»). Сотрудник ложится в `master_id`, клиент — в
// `client_id` проводки.

import type {
  FinanceCategory,
  FinanceCategoryKind,
} from "@babun/shared/db/repositories/finance-categories";

/** Что спрашивает форма операции у этой категории. Нет категории — ничего. */
export interface CategoryAsks {
  employee: boolean;
  client: boolean;
  receipt: boolean;
}

export function asksOf(
  category:
    | Pick<FinanceCategory, "ask_employee" | "ask_client" | "require_receipt">
    | null
    | undefined,
): CategoryAsks {
  return {
    employee: !!category?.ask_employee,
    client: !!category?.ask_client,
    receipt: !!category?.require_receipt,
  };
}

/** Категории, которые человек выбирает руками: КОМАНДЫ ЭТИХ ДЕНЕГ (владелец
 *  2026-09-24: «у каждой команды свой тип расходов, свой тип доходов»), этого
 *  вида, не скрытые. Уже стоящую на операции оставляем, даже скрытую, — иначе
 *  правка её потеряет. Команда ещё не выбрана — выбирать не из чего: чужие
 *  категории предлагать нельзя. Служебные («Услуги» оплаты записи, «Возврат»,
 *  пересчёт кассы) сюда не входят: ими подписывает деньги сервер. */
export function pickableCategories(
  categories: readonly FinanceCategory[],
  type: FinanceCategoryKind,
  keepId: string | null,
  teamId: string | null,
): FinanceCategory[] {
  return categories.filter(
    (c) =>
      !c.is_system &&
      c.type === type &&
      (c.id === keepId || (!c.hidden && teamId != null && c.team_id === teamId)),
  );
}

/** Категория в другой команде. Сменили команду операции — «Топливо» Команды 1
 *  становится «Топливом» Команды 3 (та же по имени и виду); у новой команды
 *  такой нет — выбор снимается, а не остаётся чужим. */
export function categoryInTeam(
  categories: readonly FinanceCategory[],
  categoryId: string | null,
  teamId: string | null,
): string | null {
  if (!categoryId) return null;
  const current = categories.find((c) => c.id === categoryId);
  if (!current) return null;
  if (current.team_id == null || current.team_id === teamId) return categoryId;
  if (!teamId) return null;
  const key = current.name.trim().toLocaleLowerCase("ru");
  const twin = categories.find(
    (c) =>
      c.team_id === teamId &&
      !c.is_system &&
      c.type === current.type &&
      c.name.trim().toLocaleLowerCase("ru") === key,
  );
  return twin?.id ?? null;
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

/** Подпись строки «Категории операций» в настройках: сколько своих категорий
 *  каждого вида — «Расход 3 · доход 1». Готовых больше нет (владелец
 *  2026-09-24), поэтому пустой справочник называет себя словами, а не прячется
 *  за общей фразой. Служебные и скрытые не считаются. */
export function categoriesDoorLine(categories: readonly FinanceCategory[]): string {
  // «Топливо» у двух команд — одна категория для строки-двери: считаем
  // имена, а не копии команд.
  const count = (type: FinanceCategoryKind) =>
    new Set(
      categories
        .filter((c) => !c.is_system && !c.hidden && c.type === type)
        .map((c) => c.name.trim().toLocaleLowerCase("ru")),
    ).size;
  const parts = [
    ["Расход", count("expense")],
    ["доход", count("income")],
    ["долги", count("debt")],
  ] as const;
  const shown = parts.filter(([, n]) => n > 0).map(([label, n]) => `${label} ${n}`);
  if (shown.length === 0) return "Пока нет — создайте свои";
  const line = shown.join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}
