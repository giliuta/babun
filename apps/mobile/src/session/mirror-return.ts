// ВЫХОД ИЗ «ЕГО ГЛАЗАМИ» — ТУДА, ОТКУДА ВОШЛИ (владелец 01.10: «нажимаю
// „Выйти“ — должно перекидываться обратно в ту страницу, где я нажал
// „Посмотреть его глазами“»).
//
// Адрес страницы собирается из пути и параметров маршрута. Параметры
// сегментов (`[userId]`) уже стоят в пути — в хвост `?…` их не дублируем.
// Лист без React: проверяется тестом.

type Params = Readonly<Record<string, string | string[] | undefined>>;

/** Имена параметров, которые живут в пути (`[userId]`, `[...rest]`). */
function segmentKeys(segments: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const segment of segments) {
    const match = /^\[(?:\.\.\.)?([^\]]+)\]$/.exec(segment);
    if (match) keys.add(match[1]);
  }
  return keys;
}

/** Адрес открытой страницы, чтобы вернуться на неё после просмотра. */
export function returnHrefOf(pathname: string, segments: readonly string[], params: Params): string {
  const inPath = segmentKeys(segments);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (inPath.has(key) || value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) query.append(key, one);
  }
  const tail = query.toString();
  return tail ? `${pathname}?${tail}` : pathname;
}

// ВОЗВРАЩАЕТСЯ ВСЯ ЦЕПОЧКА, А НЕ ОДНА СТРАНИЦА. Вход в режим закрывает
// страницы «Кабинета» (иначе роль сотрудника показала бы на них стену), и
// одна вернувшаяся страница прав на «назад» уходила сразу в корень вкладки,
// мимо карточки сотрудника и «Сотрудников». Поэтому при входе запоминается
// стек вкладки целиком — адресами, — а при выходе он собирается заново.

type StackRoute = { name: string; params?: object };

function plainParams(params: StackRoute["params"]): Params {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries((params ?? {}) as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value) && value.every((v) => typeof v === "string")) out[key] = value as string[];
  }
  return out;
}

/** Путь маршрута стека с подставленными параметрами: `people/access/u-1`. */
function filledPath(name: string, params: Params): string {
  return name
    .split("/")
    .filter((part) => part !== "index" && !/^\(.*\)$/.test(part))
    .map((part) => {
      const match = /^\[(\.\.\.)?([^\]]+)\]$/.exec(part);
      if (!match) return part;
      const value = params[match[2]];
      return Array.isArray(value) ? value.join("/") : (value ?? "");
    })
    .join("/");
}

/** Адреса стека вкладки снизу вверх — чтобы собрать его заново. Корень
 *  вкладки берётся из адреса открытой (верхней) страницы. Не вышло — `null`. */
export function stackHrefsOf(pathname: string, routes: readonly StackRoute[]): string[] | null {
  const top = routes[routes.length - 1];
  if (!top) return null;
  const topPath = filledPath(top.name, plainParams(top.params));
  const root = topPath ? pathname.slice(0, pathname.length - topPath.length).replace(/\/$/, "") : pathname;
  if (topPath && !pathname.endsWith(topPath)) return null;
  return routes.map((route) => {
    const params = plainParams(route.params);
    const path = filledPath(route.name, params);
    const segments = route.name.split("/");
    return returnHrefOf(path ? `${root}/${path}` : root || "/", segments, params);
  });
}

// ВОЗВРАТ ДОЛЖЕН ДОЙТИ. На выходе стек «Кабинета» собирается заново (роль
// сменилась), и переход, отправленный в тот же миг, приземляется на корень
// вкладки (проверено глазами 01.10). Поэтому цепочка запоминается, а вкладка,
// открывшись, достраивает её сама (`MirrorReturnRetry`). Живёт несколько
// секунд: позже она уже не про этот выход.

const RETURN_TTL_MS = 5_000;

let pending: { hrefs: string[]; until: number; tries: number } | null = null;

export function rememberReturn(hrefs: readonly string[], now = Date.now()): void {
  pending = hrefs.length > 0 ? { hrefs: [...hrefs], until: now + RETURN_TTL_MS, tries: 0 } : null;
}

const pathOf = (href: string) => href.split("?")[0];

/** Следующий шаг возврата: открыть корень цепочки или дострелить остальное. */
export function returnStep(
  pathname: string,
  now = Date.now(),
): { navigate: string } | { push: string[] } | null {
  if (!pending) return null;
  if (now > pending.until) {
    pending = null;
    return null;
  }
  const [first, ...rest] = pending.hrefs;
  if (pathOf(first) === pathname) {
    pending = null;
    return rest.length > 0 ? { push: rest } : null;
  }
  // Не там — ещё раз в корень цепочки, но не бесконечно.
  pending.tries += 1;
  if (pending.tries > 2) {
    pending = null;
    return null;
  }
  return { navigate: first };
}
