// Per-team work schedule (team_schedules table) for the brigade calendar hub.
//
// Thin React Query wrappers over the canonical shared repository
// (@babun/shared/db/repositories/schedule) so the SQL — the `tenant_id,team_id`
// upsert conflict target and the jsonb round-trip — stays in ONE place shared
// with the web. The row stores the whole TeamSchedule blob per (tenant, team);
// the upsert REPLACES it atomically, so an editor that tweaks one field merges
// onto DEFAULT_SCHEDULE (or the fetched value) in TS first, then passes the
// full object.

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listScheduleEntries,
  upsertScheduleEntry,
} from "@babun/shared/db/repositories/schedule";
import { type ScheduleMap, type TeamSchedule } from "@babun/shared/local/schedule";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useCurrentRole } from "@/features/settings/tenant";
import { allTeamSchedulesQueryKey } from "@/lib/company-query-keys";
import {
  pickTeamSchedule,
  rollbackTeamSchedule,
  writeTeamScheduleOptimistic,
} from "./team-schedule-map";

/** The schedule for one team, or null when the team has no row yet. NOT
 *  coalesced to DEFAULT_SCHEDULE here: that hard-coded 08–22 band made the
 *  global «Рабочие часы по умолчанию» setting dead — DayView never reached
 *  its workStartHour/EndHour fallback. Callers pick their own fallback
 *  (grid → global work hours, hub editor → DEFAULT_SCHEDULE).
 *
 *  КЛЮЧ — КАРТА КОМПАНИИ, А НЕ КОМАНДЫ (2026-09-15). Запрос и так приносит
 *  графики всех команд; ключ по команде заставлял первый тап по соседнему
 *  календарю снова идти за той же картой, и сетка ждала сеть скелетом.
 *  Теперь карта одна на компанию и роль, команда выбирается `select`. */
export function useTeamSchedule(teamId: string | undefined) {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const select = useCallback(
    (map: ScheduleMap) => pickTeamSchedule(map, teamId),
    [teamId],
  );
  return useQuery<ScheduleMap, Error, TeamSchedule | null>({
    queryKey: allTeamSchedulesQueryKey(tenantId, roleQuery.data),
    enabled:
      !!tenantId && !!teamId && roleQuery.isSuccess && roleQuery.data != null,
    queryFn: () => listScheduleEntries(supabase, tenantId as string),
    select,
  });
}

/** Расписания ВСЕХ команд тенанта одной картой. Список календарей показывает
 *  график каждого — тем же одним запросом и тем же ключом, что читает
 *  useTeamSchedule, а не N запросами по команде.
 *
 *  Прежнее «только владелец» снято: роль уже стоит в ключе, а для других
 *  ролей ровно эту карту и так читал useTeamSchedule. */
export function useAllTeamSchedules() {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  return useQuery<ScheduleMap>({
    queryKey: allTeamSchedulesQueryKey(tenantId, roleQuery.data),
    enabled: !!tenantId && roleQuery.isSuccess && roleQuery.data != null,
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
    // бы старое начало обратно, молча потеряв первую. Ключ — карта компании:
    // именно её читает useTeamSchedule. Пишем и откатываем ТОЛЬКО свою
    // команду (`team-schedule-map.ts`): снимок всей карты в откате стёр бы
    // правку соседней команды, легшую между onMutate и ошибкой.
    //
    // Карты ещё нет (холодный старт, переход в компанию без кэша) — сначала
    // её дождаться, потом отменять и писать. Отмена летящей первой загрузки
    // оставила бы карту из одной команды, и правка любой другой заменила бы её
    // настоящий график общими часами. Разбор и тест — в листе.
    onMutate: ({ teamId, schedule }) =>
      writeTeamScheduleOptimistic(
        qc,
        allTeamSchedulesQueryKey(tenantId, role),
        () => listScheduleEntries(supabase, tenantId as string),
        teamId,
        schedule,
      ),
    onError: (_e, _vars, ctx) => {
      if (ctx) {
        qc.setQueryData<ScheduleMap>(
          allTeamSchedulesQueryKey(tenantId, role),
          (current) =>
            rollbackTeamSchedule(current, ctx.teamId, ctx.written, ctx.prev),
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
