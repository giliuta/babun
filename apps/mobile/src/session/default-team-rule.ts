// Правило выбора команды по умолчанию — разбор в `default-team.ts`.

export type TeamRef = { id: string; tenantId: string | null | undefined };

/** Правило выбора — чистое, его держит `default-team.test.ts`. */
export function pickDefaultTeamId(
  teams: readonly TeamRef[],
  openTeamId: string | null | undefined,
  isHidden: (tenantId: string | null | undefined, teamId: string) => boolean,
): string | null {
  if (openTeamId && teams.some((tm) => tm.id === openTeamId)) return openTeamId;
  return (teams.find((tm) => !isHidden(tm.tenantId, tm.id)) ?? teams[0])?.id ?? null;
}
