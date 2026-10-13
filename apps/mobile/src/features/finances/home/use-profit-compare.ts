import { useMemo } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Service } from "@/features/services/queries";
import { previousPeriod } from "../analytics/analytics-math";
import type { HomeView } from "../FinanceOverview";
import type { DebtTeams, FinanceReadRules } from "../finance-read-rules";
import type { Period } from "@/lib/period";
import { useTransactions } from "../queries";
import type { LedgerFilter } from "./home-scope";
import { previousProfit } from "./home-totals";

export interface ProfitCompareInput {
  view: HomeView;
  period: Period;
  businessToday: string;
  ledgerFilter: LedgerFilter;
  scope: string | null;
  accountTeam: ReadonlyMap<string, string | null>;
  requestedClientId: string | undefined;
  scopedAppointments: readonly Appointment[];
  services: readonly Service[];
  recordMoney: boolean;
  readRules: FinanceReadRules;
  debtTeams: DebtTeams;
}

// «ПРИБЫЛЬ» К ПРОШЛОМУ ПЕРИОДУ — только пока открыта панель прибыли
// (владелец 30.09: «аналитику такую — только в прибыли»; `profit-compare.ts`).
// Запрос тот же, что у текущего периода: журнал компании за диапазон одним
// ключом, отбор чипа и строки без команды — теми же правилами.
export function useProfitCompare(input: ProfitCompareInput) {
  const {
    view,
    period,
    businessToday,
    ledgerFilter,
    scope,
    accountTeam,
    requestedClientId,
    scopedAppointments,
    services,
    readRules,
    recordMoney,
    debtTeams,
  } = input;
  const compareOn = view === "profit";
  const prevRange = useMemo(
    () => previousPeriod(period.from, period.to, businessToday),
    [period.from, period.to, businessToday],
  );
  const prevTeamQuery = useTransactions(prevRange.from, prevRange.to, {
    ...ledgerFilter,
    enabled: compareOn,
  });
  const prevCompanyQuery = useTransactions(prevRange.from, prevRange.to, {
    enabled: compareOn,
  });
  return useMemo(() => {
    // Заглушка — это данные ДРУГОГО диапазона: «было» из неё было бы ложью.
    if (
      !compareOn ||
      !prevTeamQuery.data ||
      !prevCompanyQuery.data ||
      prevTeamQuery.isPlaceholderData ||
      prevCompanyQuery.isPlaceholderData
    ) {
      return null;
    }
    return previousProfit({
      prevTeamRows: prevTeamQuery.data,
      prevCompanyRows: prevCompanyQuery.data,
      scope,
      accountTeam,
      readRules,
      debtTeams,
      requestedClientId,
      scopedAppointments,
      services,
      prevRange: { from: prevRange.from, to: prevRange.to },
      recordMoney,
    });
  }, [
    compareOn,
    prevTeamQuery.data,
    prevTeamQuery.isPlaceholderData,
    prevCompanyQuery.data,
    prevCompanyQuery.isPlaceholderData,
    scope,
    accountTeam,
    requestedClientId,
    scopedAppointments,
    services,
    prevRange.from,
    prevRange.to,
    recordMoney,
    readRules,
    debtTeams,
  ]);
}
