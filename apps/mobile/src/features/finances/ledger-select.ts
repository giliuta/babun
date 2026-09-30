// ОТБОР ЖУРНАЛА И ДОЛГОВ НА УСТРОЙСТВЕ — ТОЧНО ТАК ЖЕ, КАК ОТБИРАЛ СЕРВЕР.
//
// Журнал и долги раньше читались ключом С КОМАНДОЙ: тап по чипу команды в
// «Финансах» заводил новый ключ, экран ждал сеть и гас вуалью, хотя строки
// этого месяца уже лежали в соседнем ключе (владелец 15.09: «переключаю
// команды — всё равно задержка, загрузка, затемнение»). Теперь ключ один на
// компанию и период, а команду и счёт отбирает `select` этими функциями.
//
// Условие жёсткое: отбор обязан совпадать с фильтром запроса, который он
// заменил, — `.in("team_id", …)` / `.in("account_id", …)` у журнала и
// `.eq("team_id", …)` у долгов. Разойдись он — плитка команды покажет чужие
// деньги. Доступа это не расширяет: RLS режет строку по ней самой, а не по
// фильтрам запроса, поэтому широкий запрос отдаёт ровно объединение узких.
//
// Лист без зависимостей: под раннером поднимается, проверяем поведение.

/** Список id — строкой для зависимостей `useMemo`: массив из пропов новый на
 *  каждый рендер, и `select` пересобирался бы каждый кадр. JSON, а не `join`:
 *  `[""]` склеился бы в ту же пустую строку, что «фильтра нет», и экран
 *  показал бы всю компанию там, где сервер вернул бы ноль строк. */
export function idsKey(
  ids: readonly (string | null | undefined)[] | null | undefined,
): string {
  return ids && ids.length > 0 ? JSON.stringify(ids) : "";
}

/** Обратно из `idsKey`: пустая строка — фильтра нет (`null`). */
export function idsFromKey(key: string): readonly string[] | null {
  return key === "" ? null : (JSON.parse(key) as string[]);
}

/**
 * Строки журнала — зеркало `listTransactionsForRange`:
 * • список команд пуст или не задан — все строки, в том числе без команды;
 * • иначе — строки, чья команда в списке; строка без команды не проходит
 *   никогда (`team_id IN (…)` на `null` в Postgres ложь);
 * • счета — то же правило; заданы оба фильтра — нужны оба (AND, как у двух
 *   `.in` подряд).
 * Без фильтров возвращается ТОТ ЖЕ массив: новая ссылка роняла бы мемоизацию
 * всего экрана на каждый приход данных.
 */
export function pickLedgerRows<
  R extends { team_id: string | null; account_id: string | null },
>(
  rows: R[],
  teamIds: readonly string[] | null,
  accountIds: readonly string[] | null,
): R[] {
  const teams = teamIds && teamIds.length > 0 ? new Set(teamIds) : null;
  const accounts =
    accountIds && accountIds.length > 0 ? new Set(accountIds) : null;
  if (!teams && !accounts) return rows;
  return rows.filter(
    (row) =>
      (!teams || (row.team_id !== null && teams.has(row.team_id))) &&
      (!accounts || (row.account_id !== null && accounts.has(row.account_id))),
  );
}

/** Долги одной команды — зеркало `if (teamId) q.eq("team_id", teamId)` в
 *  `listDebts`. Без команды — вся компания. Сравнение строгое, поэтому
 *  псевдо-команда «Без команды» (`__no_team__`) даёт ноль строк — ровно как
 *  сервер, у которого такой команды нет. */
export function pickTeamDebts<R extends { team_id: string | null }>(
  rows: R[],
  teamId: string | null | undefined,
): R[] {
  if (!teamId) return rows;
  return rows.filter((row) => row.team_id === teamId);
}

/**
 * Заглушка на время загрузки нового периода — ТОЛЬКО ИЗ СВОЕЙ КОМПАНИИ.
 *
 * `keepPreviousData` react-query берёт данные последнего ключа, который был у
 * этого наблюдателя, — какой бы компании он ни принадлежал. Вкладка при смене
 * компании не перемонтируется, поэтому голый `keepPreviousData` показывал бы
 * деньги прошлой компании под шапкой новой: на «Финансах» — гашёными, а в
 * полосе под календарём, которая гашения не знает, — как свои.
 *
 * Компания стоит вторым элементом каждого ключа денег (`company-query-keys`),
 * по нему и сверяемся. Нет компании или нет прошлого ключа — заглушки нет.
 */
export function placeholderWithinTenant<T>(
  tenantId: string | null | undefined,
): (
  prev: T | undefined,
  prevQuery?: { queryKey: readonly unknown[] },
) => T | undefined {
  return (prev, prevQuery) =>
    tenantId && prevQuery?.queryKey[1] === tenantId ? prev : undefined;
}
