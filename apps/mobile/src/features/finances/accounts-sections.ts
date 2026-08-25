// СЧЕТА ГЛАЗАМИ ЭКРАНА — порядок строк, суммы и подписи в одном месте.
//
// РАЗДЕЛЕНИЕ ТОЛЬКО ПО КОМАНДАМ (владелец 2026-08-11: «хочешь посмотреть
// команду — переключайся»). Экран «Счета» показывает ОДИН плоский список
// счетов выбранной команды, а цифра над ним равна сумме нарисованных строк:
// подпись называет ровно то множество, которое видно ниже, и цифру можно
// проверить пальцем.
//
// ЧТО УБРАНО 2026-08-11 И ПОЧЕМУ (иначе через месяц это вернут как
// «забытое»): секции «Счёт компании», «Команда в архиве», «Команда удалена»
// с подытогами и футерами-объяснялками, инвариант «строки = итог» и разбивка
// по видам. С 2026-08-15 счёт принадлежит РОВНО ОДНОЙ команде: понятия «счёт
// нескольких команд» не осталось вовсе, принадлежность решает общий
// `accountServesTeam` (packages/shared) сравнением одного `brigade_id`, а
// наследие старой схемы — счета с пустой командой — живёт под псевдо-чипом
// «Без команды» (см. `NO_TEAM`), пока владелец не раздаст его командам.
//
// От секций осталась ровно одна обязанность: деньги архивной и вовсе удалённой
// команды не имеют права исчезнуть с экрана. Их держит не секция, а ЧИП —
// см. `accountsTeamChips`.
//
// Группировка осталась ровно одна и только для страницы «Порядок счетов»: там
// она не витрина, а пространство нумерации `position` (тенант + команда).

import type {
  AccountKind,
  AccountScope,
} from "@babun/shared/local/finance/account";
import { accountsForTeam } from "@babun/shared/local/finance/integrity";
import {
  FORMS_DEN,
  FORMS_KOMANDA,
  formatCountRu,
} from "@babun/shared/common/utils/plural-ru";

/** Всё, что нужно знать о счёте, чтобы показать его строкой и сложить. */
export interface SectionAccount {
  id: string;
  scope: AccountScope;
  brigade_id: string | null;
  team_ids: string[];
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

/** Виды идут в одном порядке всегда: счета одного вида стоят подряд. */
const KIND_ORDER: Record<AccountKind, number> = {
  cash: 0,
  card: 1,
  bank: 2,
  other: 3,
};

// Локаль ru с `sensitivity: 'base'`: регистр и «ё» не должны рвать порядок
// одноимённых счетов между рефетчами.
const byName = new Intl.Collator("ru", { sensitivity: "base" });

/** Деньги сравниваем и складываем ЦЕЛЫМИ ЦЕНТАМИ: `numeric(12,2)` в базе, а
 *  сумма float-ов даёт хвост, из-за которого итог расходился бы со строками
 *  на 0,0000001. */
const toCents = (value: number): number => Math.round(value * 100);

/** Детерминированный порядок счетов: вид → position → имя. Один на продукт —
 *  список экрана и список в пикере перевода не имеют права разойтись. */
export function sortAccountRows<T extends SectionAccount>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      || a.position - b.position
      || byName.compare(a.name, b.name),
  );
}

/**
 * Имена команд одной фразой: «Юра, Аня», а от четырёх — «Юра, Аня и ещё 2
 * команды». Пустой список даёт пустую строку: называть нечего.
 *
 * ЖИВА ТОЛЬКО РАДИ НАСЛЕДИЯ. Счёт принадлежит одной команде (владелец
 * 2026-08-15), и у нового счёта перечислять некого: непустой список команд
 * бывает только у счетов старой схемы под чипом «Без команды» — их `team_ids`
 * ещё помнят, кто счётом пользовался (подпись «Пользуются:» ниже).
 */
export function teamNamesPhrase(names: readonly string[]): string {
  if (names.length <= 3) return names.join(", ");
  // Три имени ещё читаются, четвёртое уже не помещается в строку — дальше
  // счётчик, и он склоняется как все числа продукта.
  return `${names.slice(0, 2).join(", ")} и ещё ${formatCountRu(
    names.length - 2,
    FORMS_KOMANDA,
  )}`;
}

/** Псевдо-команда «Без команды»: под ней стоят счета, оставшиеся без владельца
 *  от старой схемы общего счёта. Не сущность продукта, а способ НЕ ПОТЕРЯТЬ
 *  деньги: как только владелец назначит им команду, чип исчезнет сам. */
export const NO_TEAM = "__no_team__";

/** Чип ленты команд экрана «Счета». */
export interface AccountsTeamChip {
  id: string;
  name: string;
  color: string | null;
  /**
   * Команды нет среди активных: её заархивировали либо строку команды удалили
   * вовсе (`accounts.brigade_id` — колонка `text` БЕЗ внешнего ключа, и в
   * проде есть тенант, у которого все активные счета ссылаются на
   * несуществующие команды). Заводить такой команде НОВЫЕ счета нельзя — её
   * нет; всё остальное на её счетах работает как обычно.
   */
  orphan: boolean;
}

/**
 * Лента команд экрана: активные команды в порядке справочника, а следом —
 * команды, чьи счета иначе не видно НИГДЕ.
 *
 * Осиротевший чип — это не секция и не предупреждение, а единственный способ
 * добраться до настоящих денег: своего чипа у такой команды нет, а секции
 * «Команда в архиве» и «Команда удалена» убраны 2026-08-11. Без него тенант,
 * все счета которого ссылаются на несуществующие команды, видел бы пустой
 * экран поверх живых остатков и завёл бы дубли.
 */
export function accountsTeamChips({
  accounts,
  teams,
}: {
  /** АКТИВНЫЕ счета тенанта: закрытые живут на своей странице. */
  accounts: readonly SectionAccount[];
  /** Справочник целиком, вместе с архивными: по нему узнаются имена. */
  teams: readonly SectionTeam[];
}): AccountsTeamChip[] {
  const chips: AccountsTeamChip[] = [];
  const activeIds = new Set<string>();
  for (const team of teams) {
    if (!team.is_active) continue;
    activeIds.add(team.id);
    chips.push({
      id: team.id,
      name: team.name,
      color: team.color,
      orphan: false,
    });
  }

  const known = new Map(teams.map((team) => [team.id, team]));
  const orphans = new Map<string, AccountsTeamChip>();
  // Порядок осиротевших чипов выводится из того же порядка счетов, что и
  // список экрана, — значит он детерминирован и не пляшет между рефетчами.
  let hasOwnerless = false;
  for (const account of sortAccountRows(accounts)) {
    // ДЕНЬГИ БЕЗ ХОЗЯИНА ВСЁ РАВНО ВИДНЫ. Счёт без команды остался от старой
    // схемы «общего счёта»: приписать его команде нельзя (это чужие деньги), а
    // спрятать — тем более. Для него заводится отдельный чип.
    if (!account.brigade_id) {
      hasOwnerless = true;
      continue;
    }
    // Счёт видит активная команда — его деньги уже на экране.
    if (activeIds.has(account.brigade_id)) continue;
    if (orphans.has(account.brigade_id)) continue;
    const team = known.get(account.brigade_id);
    orphans.set(account.brigade_id, {
      id: account.brigade_id,
      name: team?.name ?? "Команда удалена",
      color: team?.color ?? null,
      orphan: true,
    });
  }
  if (hasOwnerless) {
    orphans.set(NO_TEAM, {
      id: NO_TEAM,
      name: "Без команды",
      color: null,
      orphan: true,
    });
  }
  return [...chips, ...orphans.values()];
}

/**
 * Счета, которые видит команда: свои плюс те, которыми она пользуется вместе
 * с другими командами. Единственное множество экрана — по нему рисуются
 * строки И считается сумма, поэтому разойтись им негде.
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

/** Σ остатков строк. */
export function sumAccountBalances(rows: readonly SectionAccount[]): number {
  let cents = 0;
  for (const row of rows) cents += toCents(row.balance);
  return cents / 100;
}

/** Имя, которое само себя называет командой («Команда 2», «Команда Юга»).
 *  В проде команды зовут и по имени бригадира, и порядковым номером, и второе
 *  слово «команда» перед таким именем — чистое удвоение. */
export function isSelfNamedTeam(name: string): boolean {
  return /^\s*(команд|команд)/i.test(name);
}

/** «Команда Юра» — но не «Команда Команда 2». Одно правило на подпись суммы
 *  экрана, заголовок группы и герой карточки счёта: счёт называется одинаково
 *  там, где на него смотрят, и там, куда по нему проваливаются. */
export function brigadeTitle(name: string): string {
  return isSelfNamedTeam(name) ? name : `Команда ${name}`;
}

/** Группа страницы «Порядок счетов». */
export interface AccountGroup<T extends SectionAccount = SectionAccount> {
  key: string;
  /** Обычным регистром: капс рисует `RowGroup`, а VoiceOver читает слова. */
  title: string;
  /** Риска слева от заголовка цветом команды. */
  color: string | null;
  data: T[];
}

/**
 * Группы страницы «Порядок счетов»: одна группа — одно пространство нумерации
 * `position` (тенант + команда), поэтому тянуть строку можно только внутри
 * своей группы. Счёт БЕЗ команды остался от снесённой схемы общего счёта: у
 * него своё, пустое пространство нумерации, и он идёт последней группой.
 *
 * Счета архивных и вовсе неразрешимых команд сюда не попадают: делать с ними
 * надо не порядок, а сдать остаток и закрыть.
 */
export function accountOrderGroups<T extends SectionAccount>({
  accounts,
  teams,
}: {
  accounts: readonly T[];
  teams: readonly SectionTeam[];
}): AccountGroup<T>[] {
  // Ключ — ровно тот, по которому нумеруется `position`. Читаем ТОЛЬКО
  // `brigade_id`: `scope` — мёртвая колонка, и счёт с непустой командой, но
  // чужим охватом вырывался здесь из группы своей команды, хотя на «Счетах», в
  // переводе и в архиве стоял под её чипом.
  const byOwner = new Map<string, T[]>();
  for (const account of accounts) {
    const owner = account.brigade_id ?? "";
    const list = byOwner.get(owner);
    if (list) list.push(account);
    else byOwner.set(owner, [account]);
  }

  const groups: AccountGroup<T>[] = [];
  for (const team of teams) {
    if (!team.is_active) continue;
    const rows = byOwner.get(team.id);
    if (!rows || rows.length === 0) continue;
    groups.push({
      key: `team:${team.id}`,
      title: brigadeTitle(team.name),
      color: team.color,
      data: sortAccountRows(rows),
    });
  }

  const ownerless = byOwner.get("");
  if (ownerless && ownerless.length > 0) {
    groups.push({
      // Ключ — про пространство нумерации, а не про текст: он и остаётся.
      key: "shared",
      // Одно имя на весь продукт: чип на «Счетах», группа перевода и архив
      // называют этот счёт так же.
      title: "Без команды",
      color: null,
      data: sortAccountRows(ownerless),
    });
  }
  return groups;
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

/** Порог «давно»: сверка старше двух недель — уже вопрос, а не рутина.
 *  Одно число на весь продукт: список, карточка счёта и закрытие дня обязаны
 *  считать кассу несверенной в один и тот же день. */
export const CASH_COUNT_STALE_DAYS = 14;

export interface AccountCaptionInput extends AccountMovementDates {
  kind: AccountKind;
  balance: number;
  /**
   * Дата последней сверки кассы (`YYYY-MM-DD`).
   *   • `null`      — сверок не было ни разу;
   *   • `undefined` — НЕИЗВЕСТНО (окно запроса сверок не покрыло этот счёт
   *     либо ответ ещё не приехал). Разница принципиальная: «ни разу» — это
   *     утверждение о деньгах, и выдумывать его нельзя.
   */
  lastCountedOn?: string | null;
  /** Имя ответственного мастера, уже разрезолвленное экраном. */
  ownerName?: string | null;
  /** Имена АКТИВНЫХ команд, которые пользуются этим счётом вместе. Наследие:
   *  у счёта новой модели команда одна, и непустым этот список бывает только
   *  у счетов «Без команды» (их `team_ids` остались от старой схемы). Одна
   *  команда — это не «вместе», и подписи такой счёт не получает. */
  sharedWith?: readonly string[];
}

// ПОДПИСЬ СТРОКИ СЧЁТА СНЯТА С ПРОДУКТА (владелец 2026-08-17: «касса — на
// руках 21 день, что это за хуйня… убирайте подсказки, просто счёт»). Ладдер
// «не сверяли / на руках / отвечает / пользуются» жил здесь и печатался в
// списке счетов и в панели финансов. Возраст остатка и давность сверки
// остались там, где ими и занимаются: на самой странице счёта, строкой
// «Пересчитать».

/**
 * Янтарная правда о сверке кассы — первый приоритет подписи строки и вторая
 * подпись героя карточки счёта. `null` — сказать нечего: сверка свежая, дата
 * неизвестна либо касса просто молодая.
 *
 * «Ни разу не сверяли» печатается ТОЛЬКО когда по счёту БЫЛИ операции и с
 * первой прошло больше порога: иначе заведённая утром касса кричала бы в день
 * своего рождения, а требование пересчитать пустую кассу учит игнорировать
 * янтарь вообще.
 */
export function cashCountAlert(
  lastCountedOn: string | null | undefined,
  firstTxOn: string | null,
  today: string,
): string | null {
  if (lastCountedOn === undefined) return null;
  if (lastCountedOn === null) {
    const age = firstTxOn ? daysBetweenYmd(firstTxOn, today) : null;
    return age !== null && age > CASH_COUNT_STALE_DAYS
      ? "Ни разу не сверяли"
      : null;
  }
  const days = daysBetweenYmd(lastCountedOn, today);
  return days !== null && days > CASH_COUNT_STALE_DAYS
    ? `Не сверяли ${formatCountRu(days, FORMS_DEN)}`
    : null;
}
