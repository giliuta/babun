import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useDataRole } from "@/features/settings/tenant";
import type { ChangeLogRow } from "./change-log";

// ЖУРНАЛ ИЗМЕНЕНИЙ — чтение `change_log` страницами по сто (свежие сверху).
// Пишет только сервер; владелец видит весь журнал аккаунта, остальным RLS
// отдаёт их собственные строки. Фильтры — автор и календарь — уходят в
// запрос, а не режут загруженное: иначе редкий партнёр терялся бы за сотней
// чужих строк.

const PAGE = 100;
const COLUMNS =
  "id, team_id, actor_id, actor_name, entity, entity_id, action, label, meta, changes, created_at";

/** Автор: все, «Система» (сервер, без входа) или конкретный человек. */
export type ActorFilter = "all" | "system" | string;

export const changeLogKey = (tenantId: string | null) => ["change-log", tenantId] as const;

export function useChangeLog(actor: ActorFilter, teamId: string | null) {
  const tenantId = useTenantId();
  const role = useDataRole();
  return useInfiniteQuery({
    queryKey: [...changeLogKey(tenantId), actor, teamId],
    enabled: !!tenantId && role.data === "owner",
    staleTime: 0,
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }): Promise<ChangeLogRow[]> => {
      let q = supabase
        .from("change_log")
        .select(COLUMNS)
        .eq("tenant_id", tenantId as string)
        .order("id", { ascending: false })
        .limit(PAGE);
      if (pageParam != null) q = q.lt("id", pageParam);
      if (actor === "system") q = q.is("actor_id", null);
      else if (actor !== "all") q = q.eq("actor_id", actor);
      if (teamId) q = q.eq("team_id", teamId);
      const { data, error } = await q;
      if (error) throw new Error(`change_log: ${error.message}`);
      return (data ?? []) as ChangeLogRow[];
    },
    getNextPageParam: (last) => (last.length < PAGE ? undefined : (last[last.length - 1]?.id ?? undefined)),
  });
}

/** Последняя строка и сколько изменений сегодня — подпись строки Кабинета. */
export function useChangeLogToday() {
  const tenantId = useTenantId();
  const role = useDataRole();
  return useQuery({
    queryKey: [...changeLogKey(tenantId), "today"],
    enabled: !!tenantId && role.data === "owner",
    staleTime: 30_000,
    queryFn: async (): Promise<{ today: number; lastAt: string | null }> => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const [{ count, error }, last] = await Promise.all([
        supabase
          .from("change_log")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId as string)
          .gte("created_at", start.toISOString()),
        supabase
          .from("change_log")
          .select("created_at")
          .eq("tenant_id", tenantId as string)
          .order("id", { ascending: false })
          .limit(1),
      ]);
      if (error) throw new Error(`change_log: ${error.message}`);
      if (last.error) throw new Error(`change_log: ${last.error.message}`);
      return { today: count ?? 0, lastAt: last.data?.[0]?.created_at ?? null };
    },
  });
}
