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
import { type ScheduleMap, type TeamSchedule } from "@babun/shared/local/schedule";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useCurrentRole } from "@/features/settings/tenant";

/** The schedule for one team, or null when the team has no row yet. NOT
 *  coalesced to DEFAULT_SCHEDULE here: that hard-coded 08–22 band made the
 *  global «Рабочие часы по умолчанию» setting dead — DayView never reached
 *  its workStartHour/EndHour fallback. Callers pick their own fallback
 *  (grid → global work hours, hub editor → DEFAULT_SCHEDULE). */
export function useTeamSchedule(teamId: string | undefined) {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  return useQuery<TeamSchedule | null>({
    queryKey: [
      "team-schedules",
      tenantId,
      roleQuery.data ?? "role-pending",
      teamId,
    ],
    enabled:
      !!tenantId && !!teamId && roleQuery.isSuccess && roleQuery.data != null,
    queryFn: async () => {
      const map = await listScheduleEntries(supabase, tenantId as string);
      return map[teamId as string] ?? null;
    },
  });
}

/** Расписания ВСЕХ команд тенанта одной картой. Список календарей показывает
 *  график каждого — тем же одним запросом, что уже делает useTeamSchedule под
 *  капотом (listScheduleEntries отдаёт карту), а не N запросами по команде. */
export function useAllTeamSchedules() {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  return useQuery<ScheduleMap>({
    queryKey: [
      "team-schedules",
      tenantId,
      roleQuery.data ?? "role-pending",
      "all",
    ],
    enabled:
      !!tenantId && roleQuery.isSuccess && roleQuery.data === "owner",
    queryFn: () => listScheduleEntries(supabase, tenantId as string),
  });
}

/** Insert-or-replace the schedule for a single team. The caller passes the
 *  full TeamSchedule (merge nested fields client-side first). */
export function useUpsertTeamSchedule() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["team-schedules", tenantId],
    mutationFn: async ({
      teamId,
      schedule,
    }: {
      teamId: string;
      schedule: TeamSchedule;
    }) => {
      if (role !== "owner") {
        throw new Error("Изменять график команды может только владелец.");
      }
      await upsertScheduleEntry(supabase, tenantId as string, teamId, schedule);
    },
    // Оптимистичный мерж здесь ОБЯЗАТЕЛЕН, а не украшение: апсерт ЗАМЕНЯЕТ
    // весь блоб, а редактор дня строит следующий блоб от того, что лежит в
    // кэше. Без него правка «Начало», сделанная до приземления рефетча,
    // читалась бы из устаревшего кэша — и следующая правка «Конец» записала
    // бы старое начало обратно, молча потеряв первую. Ключ узкий (…, teamId):
    // именно его читает useTeamSchedule.
    onMutate: async ({ teamId, schedule }) => {
      const key = ["team-schedules", tenantId, role ?? "role-pending", teamId];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<TeamSchedule | null>([
        "team-schedules",
        tenantId,
        role ?? "role-pending",
        teamId,
      ]);
      qc.setQueryData(key, schedule);
      return { prev, teamId };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx) {
        qc.setQueryData(
          ["team-schedules", tenantId, role ?? "role-pending", ctx.teamId],
          ctx.prev,
        );
      }
    },
    // Рефетчим, только когда эта мутация — последняя в полёте: колесо времени
    // шлёт апсерт на каждый тик, и рефетч ранней мутации, пришедший после
    // onMutate поздней, откатил бы её значение (тот же приём, что в
    // useSaveCalendarSettings).
    onSettled: () => {
      if (qc.isMutating({ mutationKey: ["team-schedules", tenantId] }) > 1) {
        return;
      }
      void qc.invalidateQueries({ queryKey: ["team-schedules", tenantId] });
    },
    meta: { errorHandled: true },
  });
}
