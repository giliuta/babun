// ВИЗИТ АРХИВНОГО КАЛЕНДАРЯ НАЗЫВАЕТ СВОЮ КОМАНДУ.
//
// Владелец 2026-09-21: «добавь, чтоб подтягивалось архивное — им писалось,
// какая команда это делала, на всякий случай». Календарь ушёл в архив, его
// записи остались в карточке клиента — и без подписи они выглядят как любой
// другой визит, хотя открываются только для просмотра.
//
// Живые визиты команду по-прежнему не пишут: строка истории однострочная, и
// имя команды у каждой строки съело бы место у услуг и денег, ради которых
// историю и открывают. Подпись нужна там, где визит особенный.

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
