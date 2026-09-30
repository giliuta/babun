// ДЕНЬГИ АРХИВНОГО КАЛЕНДАРЯ В ЖИВЫХ ФИНАНСАХ НЕ СУЩЕСТВУЮТ.
//
// Владелец 2026-09-21: «удаляешь — оно кидается в архив… финансы переносятся в
// архив, их вообще не существует, то есть оно будет в архиве всё». До этого
// правило жило в каждом экране своим фильтром — и разведка нашла семь мест,
// где счета удалённого календаря всё равно просвечивали: «Сделать перевод»,
// группа «· в архиве» на странице счетов, оплата инвойса и чек без команды,
// счётчик в настройках финансов, закрытые счета, цели закрытия счёта.
//
// Теперь правило одно и стоит у источника — в `useAccountsWithBalances`, через
// который счета получают все пятнадцать экранов. Архиву Кабинета эти счета
// нужны, и он просит их явно (`includeArchivedCalendars`).
//
// Счёт БЕЗ команды (общий счёт компании) архивом календаря не задевается: он
// ничей и продолжает жить, даже если все его команды ушли в архив.

export interface CalendarBoundAccount {
  brigade_id?: string | null;
}
export interface CalendarState {
  id: string;
  is_active: boolean;
}

/** Id календарей в архиве. */
export function archivedCalendarIds(teams: readonly CalendarState[]): ReadonlySet<string> {
  return new Set(teams.filter((team) => !team.is_active).map((team) => team.id));
}

/** Счета без тех, чей календарь в архиве. */
export function withoutArchivedCalendars<T extends CalendarBoundAccount>(
  accounts: readonly T[],
  archived: ReadonlySet<string>,
): T[] {
  if (archived.size === 0) return accounts.slice();
  return accounts.filter(
    (account) => !account.brigade_id || !archived.has(account.brigade_id),
  );
}
