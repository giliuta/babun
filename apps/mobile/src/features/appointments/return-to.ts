// ДОРОГА НАЗАД ИЗ ЗАПИСИ — ОДИН СЛОВАРЬ НА ВЕСЬ ПРОДУКТ.
//
// Запись открывают с трёх поверхностей: календарь (своя, дороги не нужно),
// вкладка денег и страница инвойса. Две последние передают `from`, и «назад»
// обязано вернуть человека туда, откуда он пришёл.
//
// Почему словарь переехал сюда (2026-09-08): он жил внутри календаря, а
// страница записи `/book` про `from` не знала вовсе — её `leaveBook()` звал
// слепой `router.back()`. Стек при заходе из денег — «финансы → календарь →
// запись», поэтому владелец нажимал доход, закрывал запись и оказывался на
// календаре, да ещё и переключённом на «День». Возврат работал только у
// бригадира: ему открывается лист поверх календаря, а не страница.
//
// Формат `from`: «finances» — вкладка денег; «finances:<разрез>» — она же с
// разрезом; «finances:accounts:<id>» — «Счета» с лентой выбранного счёта;
// «invoice:<id>» — страница инвойса, с чьей проводки запись открыли.
//
// КОМАНДА ЧИПА — ХВОСТОМ «@<команда>» (аудит финансов 2026-09-30): дорога
// несла разрез и счёт, но не команду, и пересозданная вкладка вставала на
// первую команду — человек смотрел «Команду 3», открывал запись, закрывал её
// и оказывался в «Команде 1». «finances@team-x», «finances:debt@team-x»,
// «finances:accounts:<uuid>@team-x». Команда — тот же закрытый набор знаков,
// что в адресе вкладки (`finance-route.ts`).

/** Разрезы вкладки денег, которые дорога назад умеет восстановить. Список
 *  закрытый: `from` приходит из адреса, и собирать по нему произвольный путь
 *  или произвольный параметр нельзя. */
const FINANCE_VIEWS = new Set([
  "income",
  "expense",
  "debt",
  "documents",
  "accounts",
]);

/** Счёт из адреса — только uuid: тот же закрытый словарь, что у разрезов. */
const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Команда — буквы, цифры, «_» и «-»: в адрес не уедет ни «&», ни пробел. */
const TEAM_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Метка дороги назад во вкладку денег: разрез, счёт его ленты и команда
 *  чипа. Разрез «Все» меткой не называется — он и есть корень вкладки. */
export function financesFrom(
  view: string | null | undefined,
  options: { account?: string | null; team?: string | null } = {},
): string {
  const cut = view && view !== "all" ? `:${view}${options.account ? `:${options.account}` : ""}` : "";
  return `finances${cut}${options.team ? `@${options.team}` : ""}`;
}

export function resolveReturnTo(from: string | undefined): string | null {
  if (!from) return null;
  if (from === "finances" || from.startsWith("finances:") || from.startsWith("finances@")) {
    const at = from.lastIndexOf("@");
    const rawTeam = at >= 0 ? from.slice(at + 1).trim() : "";
    const team = TEAM_ID.test(rawTeam) ? rawTeam : null;
    const path = financesPath(at >= 0 ? from.slice(0, at) : from);
    if (!team) return path;
    return `${path}${path.includes("?") ? "&" : "?"}team=${team}`;
  }
  // Страница чека (04.10): запись, открытую с чека, закрывают обратно в чек.
  if (from.startsWith("receipt:")) {
    const receipt = from.slice("receipt:".length).trim();
    return ACCOUNT_ID.test(receipt) ? `/documents/receipt/${receipt}` : null;
  }
  if (!from.startsWith("invoice:")) return null;
  const id = from.slice("invoice:".length).trim();
  // Пустой id дал бы `/invoices/` — маршрут, которого нет. Лучше остаться на
  // календаре, чем увести человека на «страница не найдена».
  return id ? `/invoices/${id}` : null;
}

/** Путь вкладки денег по метке без команды. */
function financesPath(from: string): string {
  if (from === "finances") return "/finances";
  if (from.startsWith("finances:")) {
    // ДОРОГА НАЗАД НЕСЁТ РАЗРЕЗ. Вкладка денег пересоздаётся при возврате, и
    // выбранная плитка сбрасывалась на «Все»: человек открывал запись из
    // «Дохода», закрывал её и попадал в общую ленту (2026-09-09).
    const [view = "", accountId = ""] = from
      .slice("finances:".length)
      .trim()
      .split(":");
    if (!FINANCE_VIEWS.has(view)) return "/finances";
    // И ВЫБРАННЫЙ СЧЁТ (2026-09-15): запись открыли из ленты «Наличных» под
    // «Счетами» — закрыв её, человек возвращается к «Наличным», а не ко всем
    // счетам.
    return view === "accounts" && ACCOUNT_ID.test(accountId)
      ? `/finances?view=accounts&account=${accountId}`
      : `/finances?view=${view}`;
  }
  return "/finances";
}

/** Метка для ссылки: `from=` собирается только там, где дорога есть. */
export function returnToParam(from: string | undefined): string {
  return from ? `&from=${encodeURIComponent(from)}` : "";
}
