import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMirror } from "@/session/mirror-state";
import { useAccountGate, useAccountScope } from "@/session/account-scope";
import { periodRange, type ChangeLogRow, type HistoryPeriod } from "./change-log";
import { readChangeLog } from "./change-log/read";
import { HISTORY_KEY, historyRowVisible } from "./history-access";

// ЖУРНАЛ ИЗМЕНЕНИЙ — чтение `change_log` (свежие сверху) функцией
// `list_change_log` (`change-log/read.ts`). Пишет только сервер. Аккаунт —
// СТРАНИЦЫ (`useAccountScope`): свой или пригласивший, из блока которого
// открыли. Владелец аккаунта читает весь журнал; партнёр с правом «История
// изменений» — его команды в открытых ему разделах, без полей скрытых от
// него блоков. «Посмотреть его глазами» читает вашим токеном — строки
// режутся его картой прав (`history-access.ts`).

const PAGE = 1000;
const MAX_ROWS = 3000;

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
        const page = await readChangeLog(client, { from, to, before, limit: PAGE });
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
        readChangeLog(client, { from: start.toISOString(), limit: PAGE }),
        readChangeLog(client, { limit: 50 }),
      ]);
      return { today, recent };
    },
  });
}

/** ЧТО ДЕЛАЛ ОДИН ЧЕЛОВЕК — подпись строки «История изменений» на странице
 *  партнёра: сколько его правок сегодня и когда была последняя. Те
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
        readChangeLog(client, { from: start.toISOString(), actor: actorId, limit: PAGE }),
        readChangeLog(client, { actor: actorId, limit: 20 }),
      ]);
      return { today, recent };
    },
  });
}

/** Журнал открыт тому, кто смотрит? Без права строки на странице партнёра нет. */
export function useCanReadHistory(): boolean {
  return useHistoryReader().enabled;
}
