import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { useInvoiceNavigation } from "@/features/finances/invoice-navigation";
import { useAllTimeSearch } from "./use-all-time-search";
import { useBusinessClock } from "./use-business-clock";
import { useHomeAccess } from "./use-home-access";
import { useHomeDebts } from "./use-home-debts";
import { useHomeGate } from "./use-home-gate";
import { useHomeLedger } from "./use-home-ledger";
import { useHomeMoney } from "./use-home-money";
import { useHomePeriod } from "./use-home-period";
import { useHomeReferences } from "./use-home-references";
import { useHomeSheets } from "./use-home-sheets";
import { useLedgerRefresh } from "./use-ledger-refresh";
import { useProfitCompare } from "./use-profit-compare";
import { useRowActions } from "./use-row-actions";

/** Everything the «Финансы» tab renders, wired in the order the screen
 *  always read it. Panels and sheets destructure what they need. */
export function useFinanceHome() {
  const params = useLocalSearchParams<{
    clientId?: string | string[];
    /** Разрез, с которого ушли открывать запись: возврат ставит его обратно
     *  (см. resolveReturnTo). Применяется и на смонтированной вкладке. */
    view?: string;
    /** Счёт, чья лента была открыта под «Счетами», — тем же возвратом. */
    account?: string;
    /** Команда «Счетов» — ссылки «заведите счёт этой команде». */
    team?: string;
  }>();
  const requestedClientId = Array.isArray(params.clientId)
    ? params.clientId[0]
    : params.clientId;
  const { openTransactionInvoice } = useInvoiceNavigation();
  // Поиск по операциям — центр шапки. Ищет ВНУТРИ выбранного периода:
  // лента грузится окном, и обещать больше было бы враньём.
  const [query, setQuery] = useState("");
  const clock = useBusinessClock();
  const { businessToday, businessNowHm, businessNow } = clock;
  const periodState = useHomePeriod(clock);
  const { period } = periodState;
  const sheets = useHomeSheets();
  const refs = useHomeReferences();
  const route = useHomeAccess(params, refs, businessToday);
  const { access, readRules, view, scope } = route;
  const ledger = useHomeLedger({
    refs,
    period,
    scope,
    setScope: route.setScope,
    access,
    readRules,
    requestedClientId,
  });
  const { scopedAppointments, scopedInvoices, scopedTransactions, debtTeams } = ledger;
  const debtsState = useHomeDebts({
    refs,
    scopedInvoices,
    scopedAppointments,
    debtsData: ledger.debtsQuery.data,
    debtPaidData: ledger.debtPaidQuery.data,
    period,
    businessToday,
    scope,
    readRules,
    requestedClientId,
  });
  const profitBefore = useProfitCompare({
    view,
    period,
    businessToday,
    ledgerFilter: ledger.ledgerFilter,
    scope,
    accountTeam: refs.accountTeam,
    requestedClientId,
    scopedAppointments,
    services: refs.services,
    recordMoney: access.recordMoney,
    readRules,
    debtTeams,
  });
  const money = useHomeMoney({
    refs,
    debtsState,
    access,
    readRules,
    view,
    query,
    period,
    scope,
    businessToday,
    businessNowHm,
    requestedClientId,
    scopedTransactions,
    scopedAppointments,
    scopedInvoices,
  });
  const gate = useHomeGate(refs, ledger, clock.calendarSettingsQuery);
  const refreshControl = useLedgerRefresh();
  const search = useAllTimeSearch({
    view,
    query,
    blockRows: money.blockRows,
    readRules,
    debtTeams,
    orphanAccounts: refs.orphanAccounts,
    scope,
    accountTeam: refs.accountTeam,
    requestedClientId,
    recordRefs: money.recordRefs,
  });
  const actions = useRowActions({
    sheets,
    access,
    view,
    setView: route.setView,
    scope,
    accountId: route.accountId,
    appts: refs.appts,
    scopedAccounts: money.scopedAccounts,
    allAccounts: refs.allAccounts,
    liveAccounts: refs.transferAccountsQuery.data,
    debts: debtsState.debts,
    scopedTransactions,
    allTimeFound: search.allTimeFound,
    refundTotals: gate.refundTotals,
    periodDocuments: money.periodDocuments,
    businessToday,
  });
  return {
    ...route,
    ...periodState,
    ...sheets,
    ...refs,
    ...ledger,
    ...debtsState,
    ...money,
    ...gate,
    ...search,
    ...actions,
    query,
    setQuery,
    requestedClientId,
    openTransactionInvoice,
    businessNow,
    businessToday,
    businessNowHm,
    profitBefore,
    refreshControl,
  };
}

export type FinanceHome = ReturnType<typeof useFinanceHome>;
