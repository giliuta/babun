import type { Company } from "./queries";

// КАЛЕНДАРИ НАБОРА РЕКВИЗИТОВ — ЧИСТЫЙ СЛОЙ. Календарь выставляет документы
// от своего набора (`teams.legal_entity_id`), без своего — от «Основных».
// Отмечают календари в карточке набора; снять календарь с «Основных» нельзя
// — его отмечают в другом наборе, и он уходит туда сам.

type TeamLike = { id: string; legal_entity_id?: string | null; is_active?: boolean | null };

/** Набор, от которого календарь выставляет документы. */
export function teamCompanyId(team: TeamLike, companies: readonly Company[]): string | null {
  if (team.legal_entity_id) return team.legal_entity_id;
  return companies.find((c) => c.is_default)?.id ?? companies.find((c) => !c.archived_at)?.id ?? null;
}

/** Живые календари, которые выставляют документы от набора `companyId`. */
export function companyTeamIds(
  companyId: string | null,
  teams: readonly TeamLike[],
  companies: readonly Company[],
): string[] {
  if (!companyId) return [];
  return teams
    .filter((team) => team.is_active !== false && teamCompanyId(team, companies) === companyId)
    .map((team) => team.id);
}

/** Что записать в календари после сохранения набора: отмеченный календарь
 *  встаёт на этот набор (у «Основных» — снимает свой: пусто значит
 *  «Основные»), снятый с не основного набора возвращается к «Основным». */
export function companyTeamChanges(input: {
  companyId: string;
  isDefault: boolean;
  picked: readonly string[];
  teams: readonly TeamLike[];
  companies: readonly Company[];
}): { teamId: string; legalEntityId: string | null }[] {
  const { companyId, isDefault, picked, teams, companies } = input;
  const want = new Set(picked);
  const changes: { teamId: string; legalEntityId: string | null }[] = [];
  for (const team of teams) {
    if (team.is_active === false) continue;
    const uses = teamCompanyId(team, companies) === companyId;
    if (want.has(team.id) && !uses) {
      changes.push({ teamId: team.id, legalEntityId: isDefault ? null : companyId });
    } else if (!want.has(team.id) && uses && !isDefault) {
      changes.push({ teamId: team.id, legalEntityId: null });
    }
  }
  return changes;
}
