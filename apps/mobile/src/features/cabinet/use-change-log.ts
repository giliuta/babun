import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMirror } from "@/features/access/mirror/mirror-state";
import { useAccountGate, useAccountScope } from "./account-scope";
import { periodRange, type ChangeLogRow, type HistoryPeriod } from "./change-log";
import { HISTORY_KEY, historyRowVisible } from "./history-access";

// ЖУРНАЛ ИЗМЕНЕНИЙ — чтение `change_log` (свежие сверху). Пишет только
// сервер. Аккаунт — СТРАНИЦЫ (`useAccountScope`): свой или пригласивший, из
// блока которого открыли (04.10). Владелец аккаунта читает весь журнал;
// партнёр с правом «История изменений» — его команды в открытых ему разделах
// (политика `change_log_select_partner`). «Посмотреть его глазами» читает
// вашим токеном — строки режутся его картой прав (`history-access.ts`).

const PAGE = 1000;
const MAX_ROWS = 3000;
const COLUMNS =
  "id, team_id, actor_id, actor_name, entity, entity_id, action, label, meta, changes, created_at";

export const changeLogKey = (tenantId: string | null) => ["change-log", tenantId] as const;

/** Кто читает журнал и чем его режет. */
function useHistoryReader() {
  const scope = useAccountScope();
  const gate = useAccountGate(HISTORY_KEY);
  const mirror = useMirror();
  const enabled =
    !!scope.tenantId && (scope.role === "owner" || gate === "read" || gate === "write");
  const mirrorMap = !scope.foreign && mirror ? mirror.map : undefined;
  const visible = useCallback(
    (row: Pick<ChangeLogRow, "team_id" | "entity">) => !mirrorMap || historyRowVisible(row, mirrorMap),
    [mirrorMap],
  );
  return { tenantId: scope.tenantId, client: scope.client, enabled, visible };
}

/** ИСТОРИЯ ЗА ПЕРИОД ЦЕЛИКОМ (до 3000 последних строк). Фильтры «кто, где,
 *  что, действие» и их счётчики считаются на телефоне — как в клиентах,
 *  мгновенно и с числом у каждого варианта; сервер режет только период. */
export function useChangeLogPeriod(period: HistoryPeriod) {
  const { tenantId, client, enabled, visible } = useHistoryReader();
  const select = useCallback(
    (data: { rows: ChangeLogRow[]; capped: boolean }) => ({ ...data, rows: data.rows.filter(visible) }),
    [visible],
  );
  return useQuery({
    queryKey: [...changeLogKey(tenantId), "period", period],
    enabled,
    staleTime: 0,
    select,
    queryFn: async (): Promise<{ rows: ChangeLogRow[]; capped: boolean }> => {
      const { from, to } = periodRange(period);
      const rows: ChangeLogRow[] = [];
      let before: number | null = null;
      while (rows.length < MAX_ROWS) {
        let q = client
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

type TodayRow = Pick<ChangeLogRow, "team_id" | "entity" | "created_at">;

/** Последняя строка и сколько изменений сегодня — подпись строки Кабинета.
 *  Строки, а не счёт сервера: в «его глазами» их режет телефон. */
export function useChangeLogToday() {
  const { tenantId, client, enabled, visible } = useHistoryReader();
  const select = useCallback(
    (data: { today: TodayRow[]; recent: TodayRow[] }) => {
      const recent = data.recent.filter(visible);
      return { today: data.today.filter(visible).length, lastAt: recent[0]?.created_at ?? null };
    },
    [visible],
  );
  return useQuery({
    queryKey: [...changeLogKey(tenantId), "today"],
    enabled,
    staleTime: 30_000,
    select,
    queryFn: async (): Promise<{ today: TodayRow[]; recent: TodayRow[] }> => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const [today, recent] = await Promise.all([
        client
          .from("change_log")
          .select("team_id, entity, created_at")
          .eq("tenant_id", tenantId as string)
          .gte("created_at", start.toISOString())
          .limit(PAGE),
        client
          .from("change_log")
          .select("team_id, entity, created_at")
          .eq("tenant_id", tenantId as string)
          .order("id", { ascending: false })
          .limit(50),
      ]);
      if (today.error) throw new Error(`change_log: ${today.error.message}`);
      if (recent.error) throw new Error(`change_log: ${recent.error.message}`);
      return { today: (today.data ?? []) as TodayRow[], recent: (recent.data ?? []) as TodayRow[] };
    },
  });
}

/** ЧТО ДЕЛАЛ ОДИН ЧЕЛОВЕК — подпись строки «История изменений» на странице
 *  партнёра (04.10): сколько его правок сегодня и когда была последняя. Те
 *  же права чтения, что у журнала. */
export function useActorChanges(actorId: string | null) {
  const { tenantId, client, enabled, visible } = useHistoryReader();
  const select = useCallback(
    (data: { today: TodayRow[]; recent: TodayRow[] }) => {
      const recent = data.recent.filter(visible);
      return { today: data.today.filter(visible).length, lastAt: recent[0]?.created_at ?? null };
    },
    [visible],
  );
  return useQuery({
    queryKey: [...changeLogKey(tenantId), "actor", actorId],
    enabled: enabled && !!actorId,
    staleTime: 30_000,
    select,
    queryFn: async (): Promise<{ today: TodayRow[]; recent: TodayRow[] }> => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const [today, recent] = await Promise.all([
        client
          .from("change_log")
          .select("team_id, entity, created_at")
          .eq("tenant_id", tenantId as string)
          .eq("actor_id", actorId as string)
          .gte("created_at", start.toISOString())
          .limit(PAGE),
        client
          .from("change_log")
          .select("team_id, entity, created_at")
          .eq("tenant_id", tenantId as string)
          .eq("actor_id", actorId as string)
          .order("id", { ascending: false })
          .limit(20),
      ]);
      if (today.error) throw new Error(`change_log: ${today.error.message}`);
      if (recent.error) throw new Error(`change_log: ${recent.error.message}`);
      return { today: (today.data ?? []) as TodayRow[], recent: (recent.data ?? []) as TodayRow[] };
    },
  });
}

/** Журнал открыт тому, кто смотрит? Без права строки на странице партнёра нет. */
export function useCanReadHistory(): boolean {
  return useHistoryReader().enabled;
}
