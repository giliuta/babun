// ВИЗИТ АРХИВНОГО КАЛЕНДАРЯ НАЗЫВАЕТ СВОЮ КОМАНДУ.
//
// Владелец 2026-09-21: «добавь, чтоб подтягивалось архивное — им писалось,
// какая команда это делала, на всякий случай». Календарь ушёл в архив, его
// записи остались в карточке клиента — и без подписи они выглядят как любой
// другой визит, хотя открываются только для просмотра.
//
// ЖИВОЙ ВИЗИТ ТОЖЕ НАЗЫВАЕТ КОМАНДУ — С 30.09, когда клиент стал «одним на
// несколько команд» (владелец: «кто обслуживал — смотреть по истории»).
// Имя идёт рядом с датой, а не в значении: там услуги и деньги, ради
// которых историю и открывают. У компании с одной командой подписи нет —
// она у всех визитов была бы одна и та же.

export interface VisitTeamRow {
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

/** Больше одной живой команды — только тогда визиты подписываются. */
export function hasManyLiveTeams(
  teamsById: ReadonlyMap<string, VisitTeamRow>,
): boolean {
  let live = 0;
  for (const team of teamsById.values()) if (team.is_active) live += 1;
  return live > 1;
}

/** Имя живой команды визита — для подписи рядом с датой. Архивную называет
 *  `archivedVisitTag`, поэтому здесь она молчит (иначе имя встало бы
 *  дважды); у компании с одной командой — тоже молчит. */
export function liveVisitTeam(
  teamId: string | null | undefined,
  teamsById: ReadonlyMap<string, VisitTeamRow>,
  manyTeams: boolean,
): string | null {
  if (!manyTeams || !teamId) return null;
  const team = teamsById.get(teamId);
  return team && team.is_active ? team.name : null;
}

/** Значение строки истории. У архивного визита — команда и деньги: строка
 *  одна и обрезается с хвоста, а сумму терять нельзя; услуги видны в самой
 *  записи. У живого — как было. */
export function visitRowValue(parts: {
  tag: string | null;
  details: readonly (string | null | undefined)[];
  money: string | null | undefined;
}): string {
  const list = parts.tag ? [parts.tag, parts.money] : [...parts.details, parts.money];
  return list.filter(Boolean).join(" · ");
}
