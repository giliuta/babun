import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listTransactionsForRange } from "@babun/shared/db/repositories/finance-transactions";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useClients } from "@/features/clients/queries";
import { useMasters, useTeams } from "@/features/reference/queries";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { todayYmd } from "@/features/invoices/format";
import { useAccountsWithBalances } from "../accounts";
import { useFinanceCategories } from "../queries";
import { buildStatementDocument, type StatementDocument } from "./statement-document";

/** С какого дня берётся выписка: у счёта нет нижней границы. */
const STATEMENT_SINCE = "2000-01-01";

// ДАННЫЕ ВЫПИСКИ: все операции компании за всё время (ноги переводов другого
// счёта нужны, чтобы назвать его в строке), счёт с остатком на начало и
// справочники для имён. Читается при каждом открытии страницы — выписка
// обязана показать операцию, внесённую минуту назад.
export function useStatementDocument(
  accountId: string | undefined,
  /** Период выписки; `null` — всё время. */
  period: { from: string; to: string } | null,
): {
  doc: StatementDocument | null;
  /** Первый день операций счёта — начало «всего времени». */
  firstDay: string | null;
  loading: boolean;
  error: unknown;
  refetch: () => void;
} {
  const tenantId = useTenantId();
  // С удалёнными: перевод называет и счёт, ушедший в «Удалённые счета».
  const accounts = useAccountsWithBalances({ includeInactive: true, includeDeleted: true });
  const categories = useFinanceCategories();
  const clients = useClients();
  const teams = useTeams({ includeInactive: true });
  const people = useMasters({ includeInactive: true });
  const timeZone = useCalendarSettings().data?.timezone ?? "Europe/Nicosia";
  const today = todayYmd(timeZone);
  // Журнал — от начала: остаток на начало периода считает всё, что было до
  // него. Конец — сегодня или конец периода, если он дальше (операция могла
  // быть внесена вперёд).
  const until = period && period.to > today ? period.to : today;

  const ledger = useQuery({
    queryKey: ["account-statement", tenantId, accountId, until],
    enabled: !!tenantId && !!accountId,
    staleTime: 0,
    queryFn: () => listTransactionsForRange(supabase, tenantId as string, STATEMENT_SINCE, until),
  });

  const account = accounts.data?.find((a) => a.id === accountId) ?? null;
  const doc = useMemo(() => {
    if (!account || !ledger.data) return null;
    return buildStatementDocument({
      account,
      teamName: account.brigade_id
        ? (teams.data?.find((team) => team.id === account.brigade_id)?.name ?? null)
        : null,
      transactions: ledger.data,
      refs: {
        accounts: accounts.data ?? [],
        categories: categories.data ?? [],
        clients: clients.data ?? [],
        people: people.data ?? [],
      },
      today,
      period,
    });
  }, [account, ledger.data, teams.data, accounts.data, categories.data, clients.data, people.data, today, period]);

  const firstDay = useMemo(() => {
    let min: string | null = null;
    for (const tx of ledger.data ?? []) {
      if (tx.account_id === accountId && (min === null || tx.occurred_on < min)) min = tx.occurred_on;
    }
    return min;
  }, [ledger.data, accountId]);

  return {
    doc,
    firstDay,
    loading: !doc && (ledger.isPending || accounts.isPending),
    error: ledger.error ?? accounts.error,
    refetch: () => {
      void ledger.refetch();
      void accounts.refetch();
    },
  };
}
