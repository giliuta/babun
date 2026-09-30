import { useCallback } from "react";
import { useDesignBase } from "@/features/appointments/booking-prefs";
import {
  useSaveTeamDesign,
  useTeamDesign,
  useTeamDesigns,
} from "@/features/appointments/team-design";

// Хуки интервала обслуживания команды; правило и подстановка —
// `service-default.ts` (чистые, под тестом).

/** Интервал каждой команды — для списка клиентов. */
export function useServiceMonthsOf(): (teamId: string | null | undefined) => number | null {
  const { data } = useTeamDesigns();
  return useCallback(
    (teamId) => (teamId && data ? (data[teamId]?.serviceEveryMonths ?? null) : null),
    [data],
  );
}

/** Интервал команды и его правка (строка `team_design`, правит владелец). */
export function useTeamServiceMonths(teamId: string | null) {
  const design = useTeamDesign(teamId);
  const base = useDesignBase(teamId);
  const save = useSaveTeamDesign();
  return {
    months: design?.serviceEveryMonths ?? null,
    isPending: save.isPending,
    set: (months: number | null) => {
      if (!teamId) return;
      save.mutate({ teamId, next: { ...base, serviceEveryMonths: months } });
    },
  };
}
