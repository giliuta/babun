// ДЕНЬГИ АРХИВНОГО КАЛЕНДАРЯ В ЖИВЫХ ФИНАНСАХ НЕ СУЩЕСТВУЮТ.
//
// Удалённый календарь уходит в архив вместе со своими финансами: в живых их нет.
// Правило не живёт в каждом экране своим фильтром — иначе счета удалённого
// календаря просвечивают: «Сделать перевод»,
// группа «· в архиве» на странице счетов, оплата инвойса и чек без команды,
// счётчик в настройках финансов, закрытые счета, цели закрытия счёта.
//
// Правило одно и стоит у источника — в `useAccountsWithBalances`, через
// который счета получают все пятнадцать экранов. Архиву Кабинета эти счета
// нужны, и он просит их явно (`includeArchivedCalendars`).
//
// Счёт БЕЗ команды (общий счёт компании) архивом календаря не задевается: он
// ничей и продолжает жить, даже если все его команды ушли в архив.

interface CalendarBoundAccount {
  brigade_id?: string | null;
}
interface CalendarState {
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
