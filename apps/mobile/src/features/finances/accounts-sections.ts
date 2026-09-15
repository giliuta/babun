// СЧЕТА ГЛАЗАМИ ЭКРАНА — порядок строк, группы и подписи в одном месте.
//
// СЧЕТА ЖИВУТ В ДВУХ МЕСТАХ (владелец 2026-09-15): плитками и лентой операций
// на «Финансах» и страницей «Счета» (`app/accounts/settings.tsx`) — туда ведут
// и ползунки панели, и шестерёнка: «чтоб была одна и та же страница». Отсюда
// ушли лента команд старого списка (`accountsTeamChips`) и сумма его героя
// (`sumAccountBalances`): их читал только снесённый экран.
//
// С 2026-08-15 счёт принадлежит РОВНО ОДНОЙ команде: понятия «счёт нескольких
// команд» не осталось вовсе, принадлежность решает общий `accountServesTeam`
// (packages/shared) сравнением одного `brigade_id`, а наследие старой схемы —
// счета с пустой командой — стоит отдельной группой «Без команды» (см.
// `NO_TEAM`), пока владелец не раздаст их командам.
//
// Одна обязанность пережила все переделки: деньги архивной и вовсе удалённой
// команды не имеют права исчезнуть с экрана. Раньше их держал чип старого
// списка, теперь — своя группа на странице «Счета» (`accountOrderGroups`).

import type {
  AccountKind,
  AccountScope,
} from "@babun/shared/local/finance/account";
import { accountsForTeam } from "@babun/shared/local/finance/integrity";
import {
  FORMS_SCHET,
  formatCountRu,
} from "@babun/shared/common/utils/plural-ru";

/** Всё, что нужно знать о счёте, чтобы показать его строкой и сложить. */
export interface SectionAccount {
  id: string;
  scope: AccountScope;
  brigade_id: string | null;
  name: string;
  kind: AccountKind;
  position: number;
  balance: number;
}

/** Команда из справочника: активные и архивные вперемешку, в порядке показа. */
export interface SectionTeam {
  id: string;
  name: string;
  color: string | null;
  is_active: boolean;
}

// Локаль ru с `sensitivity: 'base'`: регистр и «ё» не должны рвать порядок
// одноимённых счетов между рефетчами.
const byName = new Intl.Collator("ru", { sensitivity: "base" });

/**
 * Детерминированный порядок счетов: position → имя. Один на продукт — плитки
 * «Финансов», страница «Счета» и пикер перевода не имеют права разойтись.
 *
 * ПОРЯДОК ЗАДАЁТ РУКА, А НЕ ВИД СЧЁТА (владелец 2026-09-12: «шесть точек
 * справа для передвижения… везде одно и то же»). До этого дня первым ключом
 * стоял вид (наличные → карта → банк → другое), и ручка перетаскивания
 * работала только внутри своего вида: у команды с одной кассой и одной картой
 * — а это ровно то, что заводится новой команде, — тянуть было нечего вовсе,
 * и ручек на экране не появлялось ни одной. Вид и так виден плиткой в строке;
 * группировать по нему ЕЩЁ И порядком значило отнимать у человека жест ради
 * структуры, которой на экране не нарисовано.
 *
 * `position` нумеруется внутри (тенант, команда), поэтому имя — не украшение,
 * а честная добивка: в списке, собранном из нескольких команд (пикер
 * перевода), позиции соседних групп совпадают.
 */
export function sortAccountRows<T extends SectionAccount>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) => a.position - b.position || byName.compare(a.name, b.name),
  );
}

/** Псевдо-команда «Без команды»: под ней стоят счета, оставшиеся без владельца
 *  от старой схемы общего счёта. Не сущность продукта, а способ НЕ ПОТЕРЯТЬ
 *  деньги: как только владелец назначит им команду, группа исчезнет сама. */
export const NO_TEAM = "__no_team__";

/**
 * Счета, которые видит команда. Единственное множество панели — по нему
 * рисуются плитки И считается сумма, поэтому разойтись им негде.
 */
export function teamAccounts<T extends SectionAccount>(
  accounts: readonly T[],
  teamId: string,
): T[] {
  if (teamId === NO_TEAM) {
    return sortAccountRows(accounts.filter((a) => !a.brigade_id));
  }
  return sortAccountRows(accountsForTeam(accounts, teamId));
}

/** Группа страницы «Счета»: счета одной команды, которые двигаются ручкой
 *  между собой. */
export interface AccountOrderGroup<T extends SectionAccount> {
  /** id команды либо `NO_TEAM` — ключ списка и граница перетаскивания. */
  key: string;
  /** Заголовок над группой. `null` — у компании одна команда: называть её
   *  незачем, других команд нет вовсе. */
  title: string | null;
  accounts: T[];
}

/**
 * Группы страницы «Счета»: активные команды в порядке справочника, а следом —
 * команды, чьи счета иначе не видно НИГДЕ (критика плана 2026-09-15, блокер 2).
 *
 * «Финансы» показывают только живые команды и чип «Без команды»; у Giliuta в
 * архивной команде лежат открытые «Карта» и «Наличка» с живыми деньгами, а у
 * другого тенанта счёт ссылается на строку команды, которой уже нет. Пока жил
 * старый список, их держал его чип; после сноса у этих денег остаётся только
 * эта страница, поэтому группа у них своя и названа правдой: «в архиве»,
 * «Команда удалена», «Без команды».
 *
 * ГРУППЫ ПО КОМАНДАМ — ТОЛЬКО КОГДА КОМАНД БОЛЬШЕ ОДНОЙ. У компании с одной
 * командой заголовок над её же счетами — удвоение. Но при двух командах имя
 * стоит даже над единственной группой: иначе не видно, чьи это счета, а
 * вторая команда без счетов рядом ничего не подсказывает.
 *
 * Перетаскивание ограничено группой по той же причине, что и нумерация
 * `position`: порядок живёт внутри команды, и строка чужой команды между
 * ними ничего не значит.
 *
 * Команда без открытых счетов группы не получает: двигать там нечего, а
 * пустой заголовок — это шум, а не информация.
 */
export function accountOrderGroups<T extends SectionAccount>({
  accounts,
  teams,
}: {
  /** ОТКРЫТЫЕ счета тенанта: закрытые живут на своей странице. */
  accounts: readonly T[];
  /** Справочник целиком, вместе с архивными: по нему узнаются имена. */
  teams: readonly SectionTeam[];
}): AccountOrderGroup<T>[] {
  const groups: AccountOrderGroup<T>[] = [];
  const activeIds = new Set<string>();
  for (const team of teams) {
    if (!team.is_active) continue;
    activeIds.add(team.id);
    const rows = teamAccounts(accounts, team.id);
    if (rows.length > 0) {
      groups.push({ key: team.id, title: team.name, accounts: rows });
    }
  }
  const liveCount = groups.length;

  const known = new Map(teams.map((team) => [team.id, team]));
  const orphanIds: string[] = [];
  let hasOwnerless = false;
  // Порядок осиротевших групп выводится из порядка их счетов — значит он
  // детерминирован и не пляшет между рефетчами.
  for (const account of sortAccountRows(accounts)) {
    if (!account.brigade_id) {
      hasOwnerless = true;
      continue;
    }
    if (activeIds.has(account.brigade_id)) continue;
    if (orphanIds.includes(account.brigade_id)) continue;
    orphanIds.push(account.brigade_id);
  }
  for (const id of orphanIds) {
    const team = known.get(id);
    groups.push({
      key: id,
      title: team ? `${team.name} · в архиве` : "Команда удалена",
      accounts: teamAccounts(accounts, id),
    });
  }
  if (hasOwnerless) {
    groups.push({
      key: NO_TEAM,
      title: "Без команды",
      accounts: teamAccounts(accounts, NO_TEAM),
    });
  }

  // Имя единственной команды компании над её же счетами — удвоение. Архивная
  // или бесхозная группа своё имя держит всегда: оно и есть новость.
  if (groups.length === 1 && liveCount === 1 && activeIds.size === 1) {
    groups[0] = { ...groups[0], title: null };
  }
  return groups;
}

/**
 * Адрес счетов команды на «Финансах». Одна строка на все двери — редирект
 * старого `/accounts`, тост «календарю созданы счета», провал автосчетов и
 * инвойс без счёта: разойдись они в имени параметра, одна из дверей молча
 * открывала бы чужую команду.
 */
export function financeAccountsHref(teamId?: string | null): string {
  const base = "/finances?view=accounts";
  return teamId ? `${base}&team=${encodeURIComponent(teamId)}` : base;
}

/**
 * Сколько счетов закрыто — одним словом на обе соседние страницы: подпись
 * двери «Счета» и значение строки «Закрытые счета» за ней. Были три записи
 * одного числа («Закрытые счета · 2», «Закрытых нет», «2 счёта»). Ноль —
 * словом: «0» рядом с деньгами читается как сумма.
 */
export function closedCountValue(closedCount: number): string {
  return closedCount > 0 ? String(closedCount) : "нет";
}

/**
 * Подпись двери «Счета» в настройках финансов — числа, а не перечень того, что
 * за дверью (вкус владельца 2026-09-06: одно слово с числом). `undefined` —
 * счета ещё не доехали: число не выдумываем, называем, что за дверью.
 */
export function accountsDoorLine(
  openCount: number | undefined,
  closedCount: number | undefined,
): string {
  if (openCount === undefined || closedCount === undefined) {
    return "Остатки, порядок, закрытые";
  }
  const open =
    openCount > 0 ? formatCountRu(openCount, FORMS_SCHET) : "Открытых нет";
  return `${open} · закрытых ${closedCountValue(closedCount)}`;
}

/** Дни между двумя `YYYY-MM-DD`. `null` — дата нечитаема. */
export function daysBetweenYmd(from: string, to: string): number | null {
  const a = ymdToUtc(from);
  const b = ymdToUtc(to);
  if (a === null || b === null) return null;
  // Отрицательных не бывает: дата операции в будущем — это не «минус два дня
  // на руках», а неизвестный возраст.
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function ymdToUtc(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Даты движений счёта, из которых выводится возраст остатка. */
export interface AccountMovementDates {
  last_outflow_on: string | null;
  first_tx_on: string | null;
}

/**
 * «На руках N дней»: дни с последней ИСХОДЯЩЕЙ ноги перевода, а если сдачи
 * не было ни разу — с первой операции по счёту. `null` — движений не было
 * вовсе: возраст неизвестен, и выдумывать его нельзя.
 */
export function accountDaysOnHand(
  account: AccountMovementDates,
  today: string,
): number | null {
  const since = account.last_outflow_on ?? account.first_tx_on;
  return since ? daysBetweenYmd(since, today) : null;
}
