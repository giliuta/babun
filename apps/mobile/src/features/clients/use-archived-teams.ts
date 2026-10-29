import { useMemo } from "react";
import { useTeams } from "@/features/reference/queries";

/** Календари компании в архиве (`is_active = false`). Они никого не
 *  обслуживают: их клиенты не стоят под «Все» (`withoutArchivedTeams`), их
 *  метки и теги клиенту не предлагаются (`serving-teams.ts`). */
export function useArchivedTeamIds(): ReadonlySet<string> {
  const { data: companyTeams = [] } = useTeams({ includeInactive: true });
  return useMemo(
    () => new Set(companyTeams.filter((tm) => !tm.is_active).map((tm) => tm.id)),
    [companyTeams],
  );
}
