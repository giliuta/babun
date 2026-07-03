// Per-team work schedule (team_schedules table) for the brigade calendar hub.
//
// Thin React Query wrappers over the canonical shared repository
// (@babun/shared/db/repositories/schedule) so the SQL — the `tenant_id,team_id`
// upsert conflict target and the jsonb round-trip — stays in ONE place shared
// with the web. The row stores the whole TeamSchedule blob per (tenant, team);
// the upsert REPLACES it atomically, so an editor that tweaks one field merges
// onto DEFAULT_SCHEDULE (or the fetched value) in TS first, then passes the
// full object.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listScheduleEntries,
  upsertScheduleEntry,
} from "@babun/shared/db/repositories/schedule";
import {
  DEFAULT_SCHEDULE,
  type TeamSchedule,
} from "@babun/shared/local/schedule";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

/** The schedule for one team. Returns DEFAULT_SCHEDULE when the team has no
 *  row yet, so callers always get a valid, editable object (never null). */
export function useTeamSchedule(teamId: string | undefined) {
  const tenantId = useTenantId();
  return useQuery<TeamSchedule>({
    queryKey: ["team-schedules", tenantId, teamId],
    enabled: !!tenantId && !!teamId,
    queryFn: async () => {
      const map = await listScheduleEntries(supabase, tenantId as string);
      return map[teamId as string] ?? DEFAULT_SCHEDULE;
    },
  });
}

/** Insert-or-replace the schedule for a single team. The caller passes the
 *  full TeamSchedule (merge nested fields client-side first). */
export function useUpsertTeamSchedule() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      teamId,
      schedule,
    }: {
      teamId: string;
      schedule: TeamSchedule;
    }) => {
      await upsertScheduleEntry(supabase, tenantId as string, teamId, schedule);
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["team-schedules", tenantId] }),
    meta: { errorHandled: true },
  });
}
