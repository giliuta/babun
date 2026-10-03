import { useState } from "react";
import { listTransactionsForRange } from "@babun/shared/db/repositories/finance-transactions";
import { useToast } from "@/components/ui/Toast";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useClients } from "@/features/clients/queries";
import { useMasters, useTeams } from "@/features/reference/queries";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { todayYmd } from "@/features/invoices/format";
import { useAccountsWithBalances, type AccountWithBalance } from "../accounts";
import { accountStatementRows, shareLedgerCsv } from "../ledger-export";
import { useFinanceCategories } from "../queries";

/** С какого дня берётся выписка: у счёта нет нижней границы. */
const STATEMENT_SINCE = "2000-01-01";

// «ВЫПИСКА» В ШТОРКЕ СЧЁТА (владелец 03.10, вариант 1): все операции этого
// счёта одним файлом — тот же CSV, что «Выгрузка для бухгалтера», только по
// одному счёту и за всё время. Выбора периода нет: шторка над шторкой iOS не
// покажет, а бухгалтер отфильтрует файл сам.
export function useAccountStatement(account: AccountWithBalance | null) {
  const toast = useToast();
  const tenantId = useTenantId();
  const accounts = useAccountsWithBalances({ includeInactive: true });
  const categories = useFinanceCategories();
  const clients = useClients();
  const teams = useTeams({ includeInactive: true });
  const people = useMasters({ includeInactive: true });
  const timeZone = useCalendarSettings().data?.timezone ?? "Europe/Nicosia";
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!tenantId || !account || busy) return;
    setBusy(true);
    try {
      // Сегодня — по поясу компании, как у «Финансов».
      const today = todayYmd(timeZone);
      const all = await listTransactionsForRange(supabase, tenantId, STATEMENT_SINCE, today);
      const transactions = accountStatementRows(all, account.id);
      if (transactions.length === 0) {
        toast("По счёту операций не было");
        return;
      }
      await shareLedgerCsv({
        transactions,
        refs: {
          accounts: accounts.data ?? [],
          categories: categories.data ?? [],
          clients: clients.data ?? [],
          teams: teams.data ?? [],
          people: people.data ?? [],
        },
        from: transactions.reduce((min, tx) => (tx.occurred_on < min ? tx.occurred_on : min), today),
        to: today,
        title: `${account.name} · все операции`,
      });
    } catch (e) {
      toast(`Не удалось выгрузить: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return { run, busy };
}
