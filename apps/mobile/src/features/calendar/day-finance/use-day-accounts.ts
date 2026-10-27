import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAccounts } from "@babun/shared/db/repositories/accounts";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { TILE_GAP } from "@/features/appointments/PaymentTiles";
import { moneyByAccount } from "@/features/calendar/day-money";
import { accountRowsQueryKey } from "@/lib/company-query-keys";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import type { DayView } from "./types";

export function useDayAccounts({
  shownYmd,
  teamId,
  view,
  incomeRows,
  expenseRows,
  screenW,
}: {
  shownYmd: string | null;
  teamId: string | null;
  view: DayView;
  incomeRows: FinanceTransaction[];
  expenseRows: FinanceTransaction[];
  screenW: number;
}) {
  // ПО СЧЕТАМ (сколько зашло на каждый счёт: наличка, карта… те, что человек
  // создал). Плитки
  // счетов команды в порядке страницы «Счета»; тап — список только этого
  // счёта, повторный — снова все.
  const tenantId = useTenantId();
  const accountsQuery = useQuery({
    queryKey: accountRowsQueryKey(tenantId, true, true),
    enabled: !!tenantId && shownYmd != null,
    staleTime: 60_000,
    queryFn: () => listAccounts(supabase, tenantId as string, { includeInactive: true, includeDeleted: true }),
  });
  const accountById = useMemo(
    () => new Map((accountsQuery.data ?? []).map((a) => [a.id, a])),
    [accountsQuery.data],
  );
  const accountOrder = useMemo(
    () =>
      (accountsQuery.data ?? [])
        // Скрытый счёт виден только на странице «Счета»; пришли деньги дня на
        // него — он всё равно встанет в хвост разбивки по строкам дня.
        .filter((a) => a.is_active && !a.is_hidden && (!teamId || a.brigade_id === teamId))
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        .map((a) => a.id),
    [accountsQuery.data, teamId],
  );
  const [accountPick, setAccountPick] = useState<string | null | undefined>(undefined);
  useEffect(() => setAccountPick(undefined), [view, shownYmd]);
  const split = useMemo(() => {
    const rows = view === "income" ? incomeRows : view === "expense" ? expenseRows : [];
    return rows.length > 0 || accountOrder.length > 0 ? moneyByAccount(rows, accountOrder) : [];
  }, [view, incomeRows, expenseRows, accountOrder]);
  const splitTileW = Math.floor((screenW - 32 - TILE_GAP * 2) / 3);

  return { accountById, accountPick, setAccountPick, split, splitTileW };
}
