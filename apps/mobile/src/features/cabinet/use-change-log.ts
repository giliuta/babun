import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useDataRole } from "@/features/settings/tenant";
import { periodRange, type ChangeLogRow, type HistoryPeriod } from "./change-log";

// ЖУРНАЛ ИЗМЕНЕНИЙ — чтение `change_log` (свежие сверху). Пишет только
// сервер; владелец видит весь журнал аккаунта, остальным RLS отдаёт их
// собственные строки.

const PAGE = 1000;
const MAX_ROWS = 3000;
const COLUMNS =
  "id, team_id, actor_id, actor_name, entity, entity_id, action, label, meta, changes, created_at";

export const changeLogKey = (tenantId: string | null) => ["change-log", tenantId] as const;

/** ИСТОРИЯ ЗА ПЕРИОД ЦЕЛИКОМ (до 3000 последних строк). Фильтры «кто, где,
 *  что, действие» и их счётчики считаются на телефоне — как в клиентах,
 *  мгновенно и с числом у каждого варианта; сервер режет только период. */
export function useChangeLogPeriod(period: HistoryPeriod) {
  const tenantId = useTenantId();
  const role = useDataRole();
  return useQuery({
    queryKey: [...changeLogKey(tenantId), "period", period],
    enabled: !!tenantId && role.data === "owner",
    staleTime: 0,
    queryFn: async (): Promise<{ rows: ChangeLogRow[]; capped: boolean }> => {
      const { from, to } = periodRange(period);
      const rows: ChangeLogRow[] = [];
      let before: number | null = null;
      while (rows.length < MAX_ROWS) {
        let q = supabase
          .from("change_log")
          .select(COLUMNS)
          .eq("tenant_id", tenantId as string)
          .order("id", { ascending: false })
          .limit(PAGE);
        if (from) q = q.gte("created_at", from);
        if (to) q = q.lt("created_at", to);
        if (before != null) q = q.lt("id", before);
        const { data, error } = await q;
        if (error) throw new Error(`change_log: ${error.message}`);
        const page = (data ?? []) as ChangeLogRow[];
        rows.push(...page);
        if (page.length < PAGE) return { rows, capped: false };
        before = page[page.length - 1].id;
      }
      return { rows: rows.slice(0, MAX_ROWS), capped: true };
    },
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
