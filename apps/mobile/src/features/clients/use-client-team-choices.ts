import { useCallback, useMemo } from "react";
import { useTeams } from "@/features/reference/queries";
import { useCalendarVisibility } from "@/session/workspaces";

/** Команды, в которые можно завести или перевести клиента: живые (архив
 *  `useTeams` не отдаёт) и не скрытые в ленте, в порядке ленты. Имя — для
 *  показа. `isVisible` — тот же отбор для правила `teamForNewClient`. */
export function useClientTeamChoices() {
  const { data: teams = [] } = useTeams({ display: true });
  const { isHidden } = useCalendarVisibility();
  const isVisible = useCallback(
    (teamId: string) => {
      const team = teams.find((tm) => tm.id === teamId);
      return !team || !isHidden(team.tenant_id, team.id);
    },
    [teams, isHidden],
  );
  const choices = useMemo(() => teams.filter((tm) => isVisible(tm.id)), [teams, isVisible]);
  return { choices, isVisible };
}
