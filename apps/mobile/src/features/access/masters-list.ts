// КАРТОЧКИ МАСТЕРОВ — ТОЛЬКО ЭТОГО КАЛЕНДАРЯ (владелец 15.09: «перехожу на
// Команду 2, открываю мастеров — там опять мастер, который был добавлен в
// Команду 1»).
//
// Раздел «Мастера» открывается из настроек ОДНОГО календаря (его имя стоит под
// заголовком), а карточки брались по всей компании. Мастеру, принявшему
// приглашение, сервер заводит карточку в календаре приглашения — и эта
// карточка стояла разделом «Карточки мастеров» в каждом ДРУГОМ календаре, где
// самого человека нет. В своём календаре её прятала строка «С доступом к
// календарю», поэтому там беды не было видно.
//
// Лист без React и без сети: правило проверяется тестом.

export interface CardLike {
  id: string;
  team_id: string | null;
  user_id: string | null;
}

export interface TeamLike {
  id: string;
  lead_id?: string | null;
  lead_ids?: unknown;
  helper_ids?: unknown;
}

const stringIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];

/** Старый состав бригады: карточки, записанные в календарь списками
 *  ведущих и помощников, а не своим `team_id`. */
export const brigadeOf = (team: TeamLike): Set<string> =>
  new Set([
    ...stringIds(team.lead_ids),
    ...stringIds(team.helper_ids),
    ...(team.lead_id ? [team.lead_id] : []),
  ]);

/** Календари карточки без аккаунта: свой `team_id` первым (домашний), за ним
 *  календари, где она стоит в старом составе бригады. */
export function cardTeamIds(
  card: { id: string; team_id: string | null },
  teams: readonly TeamLike[],
): string[] {
  const ids: string[] = card.team_id ? [card.team_id] : [];
  for (const team of teams) {
    if (!ids.includes(team.id) && brigadeOf(team).has(card.id)) ids.push(team.id);
  }
  return ids;
}

/** Карточки для раздела «Мастера» календаря `teamId`:
 *   • человек с доступом к этому календарю уже стоит строкой выше — его
 *     карточку второй раз не показываем;
 *   • карточка этого календаря (своим `team_id` или в старом составе бригады)
 *     показывается;
 *   • карточка другого живого календаря — нет;
 *   • ничья карточка (без календаря или в архивном календаре, ни в одном
 *     составе) показывается везде: иначе её не открыть ниоткуда.
 *  Без календаря в адресе раздел показывает все карточки, как раньше. */
export function calendarCards<T extends CardLike>(
  cards: readonly T[],
  opts: {
    teamId: string | undefined;
    /** Живые календари компании. */
    teams: readonly TeamLike[];
    staffUserIds: ReadonlySet<string>;
  },
): T[] {
  const { teamId, teams, staffUserIds } = opts;
  const brigades = new Map(teams.map((team) => [team.id, brigadeOf(team)]));
  return cards.filter((card) => {
    if (card.user_id && staffUserIds.has(card.user_id)) return false;
    if (!teamId) return true;
    if (card.team_id === teamId || brigades.get(teamId)?.has(card.id)) return true;
    const homed =
      (card.team_id !== null && brigades.has(card.team_id)) ||
      [...brigades.values()].some((brigade) => brigade.has(card.id));
    return !homed;
  });
}
