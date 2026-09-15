import type { HomeView } from "./FinanceOverview";
import { NO_TEAM } from "./accounts-sections";

// АДРЕС «ФИНАНСОВ» — ЗАКРЫТЫЙ СЛОВАРЬ.
//
// Во вкладку приходят адресом: возврат из записи (`resolveReturnTo`), ссылки
// старого списка счетов и тосты календаря («Добавить счёт этой команде» →
// `/finances?view=accounts&team=<id>`). Параметры приходят из адреса, поэтому
// всё незнакомое отбрасывается, а не собирается в состояние: разрез — только
// из списка, счёт — только uuid, команда — только буквы, цифры, «_» и «-».
//
// КОМАНДА — НЕ UUID (разбор 2026-09-15). Сторож «только uuid» стоял и на
// команде, а в боевой базе у команд ни одного uuid: «team_north»,
// «team-mp8379ea-i8ith». Адрес любой настоящей команды выбрасывался, и тост
// «календарю созданы счета», дверь инвойса и старый `/accounts?team=`
// открывали первую команду вместо своей. Тест держался на выдуманном uuid.
// Закрытого набора знаков хватает для того, ради чего сторож заводился: в
// запрос не уедет ни пробел, ни кавычка, ни «&».
//
// Команда и счёт осмысленны только у «Счетов»: у дохода или долгов чип
// команды живёт своей жизнью, и адрес его не переставляет.

/** Разрезы, которые вкладка умеет восстановить из адреса. Список шире, чем в
 *  `resolveReturnTo`: оттуда приходят только те, из которых открывают запись
 *  (доход, расход, долги, документы, счета), а сюда можно прийти и диплинком. */
const VIEWS: ReadonlySet<string> = new Set<HomeView>([
  "accounts",
  "documents",
  "income",
  "expense",
  "debt",
  "profit",
]);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Форма id команды в базе. `NO_TEAM` («__no_team__») в неё тоже входит. */
const TEAM_ID = /^[A-Za-z0-9_-]{1,64}$/;

type RouteParam = string | string[] | undefined;

export interface FinanceRouteParams {
  view?: RouteParam;
  team?: RouteParam;
  account?: RouteParam;
}

export interface FinanceRoute {
  view: HomeView;
  /** Команда чипа. `null` — адрес её не называет, экран выберет сам. */
  team: string | null;
  /** Счёт, чья лента открыта под «Счетами». */
  account: string | null;
}

/** Первое значение параметра: expo-router отдаёт массив при повторе ключа. */
export function routeParam(param: RouteParam): string | undefined {
  const value = Array.isArray(param) ? param[0] : param;
  return value?.trim() || undefined;
}

const isView = (value: string): value is HomeView => VIEWS.has(value);

export function financeRoute(params: FinanceRouteParams): FinanceRoute | null {
  const view = routeParam(params.view);
  if (!view || !isView(view)) return null;
  if (view !== "accounts") return { view, team: null, account: null };
  const team = routeParam(params.team);
  const account = routeParam(params.account);
  return {
    view,
    team: team && TEAM_ID.test(team) ? team : null,
    account: account && UUID.test(account) ? account : null,
  };
}

/** Что экран знает о командах, выбирая команду по умолчанию. */
export interface ScopeFallbackInput {
  /** Активные команды в порядке чипов. */
  teamIds: readonly string[];
  /** Счета доехали — только тогда известно, остались ли бесхозные. */
  accountsLoaded: boolean;
  /** Есть счета без команды — чип «Без команды» законен. */
  hasOrphans: boolean;
}

/**
 * Команда чипа, когда выбранной нет или она пропала. Команда законная —
 * возвращается как есть.
 *
 * ДЕНЬГИ ВСЕГДА ЧЬИ-ТО (владелец 2026-08-10: «компания в целом не нужна,
 * только разбивка по командам»): открываем первую живую команду; «Без
 * команды» живёт, пока есть бесхозные счета, а у тенанта без команд скоуп
 * возвращается в `null`.
 */
export function fallbackScope(
  current: string | null,
  { teamIds, accountsLoaded, hasOrphans }: ScopeFallbackInput,
): string | null {
  if (current === NO_TEAM) {
    return accountsLoaded && !hasOrphans ? (teamIds[0] ?? null) : current;
  }
  if (teamIds.length === 0) return current;
  return current && teamIds.includes(current) ? current : teamIds[0];
}

/**
 * Запасная команда ФУНКЦИЕЙ ОТ ОЧЕРЕДИ, а не от замыкания рендера (разбор
 * 2026-09-15). Возврат из записи пересоздаёт вкладку с тёплым кэшем, и в одном
 * кадре идут два эффекта: адрес ставит команду счёта (`useFinanceRoute`), а
 * запасной выбор экрана, всё ещё видя `scope === null` в замыкании, ставил
 * первую команду поверх — побеждает последняя запись, и «Карта» второй
 * команды пропадала с плиток. Функция видит то, что уже стоит в очереди.
 */
export function fallbackScopeUpdate(
  input: ScopeFallbackInput,
): (current: string | null) => string | null {
  return (current) => fallbackScope(current, input);
}
