// ВИЗИТ АРХИВНОГО КАЛЕНДАРЯ НАЗЫВАЕТ СВОЮ КОМАНДУ.
//
// Календарь ушёл в архив, его записи остались в карточке клиента — и без подписи они выглядят как любой
// другой визит, хотя открываются только для просмотра.
//
// ЖИВОЙ ВИЗИТ ТОЖЕ НАЗЫВАЕТ КОМАНДУ: клиент один на несколько команд, и по
// истории видно, кто обслуживал. Имя идёт рядом с датой, а не в значении: там услуги и деньги, ради
// которых историю и открывают. У компании с одной командой подписи нет —
// она у всех визитов была бы одна и та же.

interface VisitTeamRow {
  id: string;
  name: string;
  is_active: boolean;
}

/** «Команда 2 · в архиве» — если календарь визита в архиве; иначе `null`. */
export function archivedVisitTag(
  teamId: string | null | undefined,
  teamsById: ReadonlyMap<string, VisitTeamRow>,
): string | null {
  if (!teamId) return null;
  const team = teamsById.get(teamId);
  if (!team || team.is_active) return null;
  return `${team.name} · в архиве`;
}
