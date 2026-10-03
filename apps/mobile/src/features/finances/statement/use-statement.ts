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
export function useStatementDocument(accountId: string | undefined): {
  doc: StatementDocument | null;
  loading: boolean;
  error: unknown;
  refetch: () => void;
} {
  const tenantId = useTenantId();
  const accounts = useAccountsWithBalances({ includeInactive: true });
  const categories = useFinanceCategories();
  const clients = useClients();
  const teams = useTeams({ includeInactive: true });
  const people = useMasters({ includeInactive: true });
  const timeZone = useCalendarSettings().data?.timezone ?? "Europe/Nicosia";
  const today = todayYmd(timeZone);

  const ledger = useQuery({
    queryKey: ["account-statement", tenantId, accountId, today],
    enabled: !!tenantId && !!accountId,
    staleTime: 0,
    queryFn: () => listTransactionsForRange(supabase, tenantId as string, STATEMENT_SINCE, today),
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
    });
  }, [account, ledger.data, teams.data, accounts.data, categories.data, clients.data, people.data, today]);

  return {
    doc,
    loading: !doc && (ledger.isPending || accounts.isPending),
    error: ledger.error ?? accounts.error,
    refetch: () => {
      void ledger.refetch();
      void accounts.refetch();
    },
  };
}
