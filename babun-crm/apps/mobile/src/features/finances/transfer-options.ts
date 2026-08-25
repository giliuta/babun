// ЛИСТ ПЕРЕВОДА — ВЫБОР СЧЕТОВ В ОДНОМ МЕСТЕ.
//
// ПЕРЕСОБРАНО 2026-08-15 под правило «счёт принадлежит одной команде»
// (владелец: «сначала название команды — это как заголовок, потом какие счета
// принадлежат команде; общий счёт полностью убираем»).
//
// Что из-за этого УШЛО целиком — и это главное упрощение:
//   • подпись «Наличные · Юра, Аня» и вся машинерия, решавшая, дописывать ли
//     владельца: команду называет ЗАГОЛОВОК группы, и в строке она лишняя;
//   • гашение недопустимых получателей и правило под списком: запрет
//     «между командами только через общий счёт» существовал ради общего счёта,
//     а его больше нет;
//   • «сдача выручки» отдельным словом: она означала «касса команды → счёт
//     компании», то есть событие, которого в продукте не осталось.

import { sortAccountRows, type SectionAccount } from "./accounts-sections";

/** Счёт глазами листа перевода. `AccountWithBalance` подходит как есть. */
export interface TransferAccount extends SectionAccount {
  is_active: boolean;
}

/** Имя команды по id. `null` — команды в справочнике нет вовсе. */
export type TeamNameResolver = (teamId: string | null) => string | null;

/** Группа списка: команда и её счета. */
export interface TransferGroup<T extends TransferAccount> {
  /** id команды; `null` — счета без владельца (наследие общего счёта). */
  teamId: string | null;
  title: string;
  accounts: T[];
}

/**
 * Полное имя счёта — «Наличка · Команда 2».
 *
 * Нужно ровно там, где рядом НЕТ заголовка группы: карточки «Откуда»/«Куда» в
 * форме и тост после перевода. В самом списке счёт называется голым именем —
 * команду там уже сказал заголовок.
 */
export function accountOwnerLabel(
  account: TransferAccount,
  teamName: TeamNameResolver,
): string {
  const team = teamName(account.brigade_id);
  // Счёт без команды — не «общий», а осиротевший: владельца удалили или он
  // остался от старой схемы. Молчать об этом нельзя, деньги на нём настоящие.
  const owner =
    team ?? (account.brigade_id ? "Команда удалена" : "Без команды");
  return `${account.name} · ${owner}`;
}

/**
 * Список для выбора: команды по порядку справочника, внутри — их счета.
 *
 * Первой идёт команда ИСТОЧНИКА: в её кассу сдают и из неё переводят чаще
 * всего. Хвост списка — по правилу `accountOwnerLabel`: счета удалённых
 * команд группами «Команда удалена», счета без владельца — «Без команды»,
 * чтобы их было видно и можно было разобрать, а не потерять.
 */
export function transferGroups<T extends TransferAccount>({
  accounts,
  from,
  teams,
  ownTeamId,
}: {
  /** Активные счета тенанта — фильтр экрана на перевод не распространяется. */
  accounts: readonly T[];
  /** Уже выбранный источник: сам себе получателем не бывает. */
  from: T | null;
  /** Справочник команд в порядке показа. */
  teams: readonly { id: string; name: string }[];
  ownTeamId: string | null;
}): TransferGroup<T>[] {
  const rows = accounts.filter((a) => a.is_active && a.id !== from?.id);
  const order = [
    ...(ownTeamId ? [ownTeamId] : []),
    ...teams.map((team) => team.id).filter((id) => id !== ownTeamId),
  ];
  const groups: TransferGroup<T>[] = [];
  const taken = new Set<string>();
  for (const teamId of order) {
    const own = sortAccountRows(rows.filter((a) => a.brigade_id === teamId));
    if (own.length === 0) continue;
    own.forEach((a) => taken.add(a.id));
    groups.push({
      teamId,
      title: teams.find((team) => team.id === teamId)?.name ?? "Команда удалена",
      accounts: own,
    });
  }
  // Всё, что не попало ни к одной живой команде, — в хвост, но НЕ одной кучей:
  // у счёта удалённой команды команда ЕСТЬ, просто её больше нет в справочнике.
  // То же деление, что в `accountOwnerLabel`, — иначе заголовок группы врал бы
  // подписи того же счёта в карточке. Ключ группы — id удалённой команды:
  // таких групп может быть несколько, и `null` их бы склеил.
  const leftovers = rows.filter((a) => !taken.has(a.id));
  const deletedTeamIds = [
    ...new Set(leftovers.flatMap((a) => (a.brigade_id ? [a.brigade_id] : []))),
  ];
  for (const teamId of deletedTeamIds) {
    groups.push({
      teamId,
      title: "Команда удалена",
      accounts: sortAccountRows(
        leftovers.filter((a) => a.brigade_id === teamId),
      ),
    });
  }
  const orphans = sortAccountRows(leftovers.filter((a) => !a.brigade_id));
  if (orphans.length > 0) {
    groups.push({ teamId: null, title: "Без команды", accounts: orphans });
  }
  return groups;
}

/**
 * Что подставить в «Куда» при открытии — только запомненная пара.
 *
 * Память это ПРЕДЗАПОЛНЕНИЕ: счёт закрыли или удалили — подстановки просто
 * нет, и кнопка честно просит выбрать.
 */
export function defaultTransferTarget<T extends TransferAccount>({
  accounts,
  from,
  remembered,
}: {
  accounts: readonly T[];
  from: T;
  remembered: string | null;
}): T | null {
  if (!remembered) return null;
  return (
    accounts.find(
      (a) => a.id === remembered && a.is_active && a.id !== from.id,
    ) ?? null
  );
}
