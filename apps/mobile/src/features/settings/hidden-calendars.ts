// СКРЫТЫЕ КАЛЕНДАРИ — ПРАВИЛО БЕЗ REACT (владелец 04.10). Человек может убрать
// календарь из лент календаря, финансов и клиентов; в шестерёнке календаря он
// остаётся и включается обратно. Два закона:
//   • скрыть можно, только когда остаётся хотя бы один другой видимый
//     календарь — иначе человеку некуда смотреть;
//   • если других видимых не осталось (доступ к чужим забрали), скрытие само
//     перестаёт действовать: календари снова видны, тумблер серый.
// Строки скрытия хранит сервер (`user_hidden_calendars`), а действует только
// то, что прошло это правило.

export interface CalendarRef {
  tenantId: string;
  teamId: string;
}

export const calendarKey = (tenantId: string, teamId: string) => `${tenantId}:${teamId}`;

/** Что действительно скрыто. `all` — все календари человека; `null`, пока
 *  список не пришёл: тогда верим сохранённому — скрыть его давали только при
 *  другом видимом календаре. */
export function effectiveHidden(
  all: readonly CalendarRef[] | null,
  stored: ReadonlySet<string>,
): Set<string> {
  if (stored.size === 0) return new Set();
  if (all === null) return new Set(stored);
  const keys = all.map((c) => calendarKey(c.tenantId, c.teamId));
  const visible = keys.filter((key) => !stored.has(key));
  if (visible.length === 0) return new Set();
  return new Set(keys.filter((key) => stored.has(key)));
}

/** Можно ли скрыть этот календарь: после него остаётся видимый другой. */
export function canHideCalendar(
  all: readonly CalendarRef[],
  hidden: ReadonlySet<string>,
  target: CalendarRef,
): boolean {
  const targetKey = calendarKey(target.tenantId, target.teamId);
  return all.some((c) => {
    const key = calendarKey(c.tenantId, c.teamId);
    return key !== targetKey && !hidden.has(key);
  });
}
