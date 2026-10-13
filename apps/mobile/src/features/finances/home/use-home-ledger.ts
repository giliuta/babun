import { useEffect, useMemo } from "react";
import type { Team } from "@/features/reference/queries";
import { NO_TEAM } from "../accounts-sections";
import { useDebtPaidTotals, useDebts } from "../debts-queries";
import type { FinancePageAccess } from "../finance-page-access";
import { readableTransactions, type FinanceReadRules } from "../finance-read-rules";
import { fallbackScopeUpdate } from "../finance-route";
import type { Period } from "@/lib/period";
import { useTransactions } from "../queries";
import type { useFinanceRoute } from "../use-finance-route";
import { hasTeamlessMoney, teamlessLedgerRows, withTeamlessRows } from "../team-scope";
import { forClient, ledgerFilterFor } from "./home-scope";
import type { HomeReferences } from "./use-home-references";

/** Псевдо-команда ленты скоупа для счетов, оставшихся без команды от старой
 *  схемы общего счёта. Лента FinanceOverview читает у команды только
 *  id/name/color — ими псевдо-строка и ограничена (`NO_TEAM` в
 *  accounts-sections.ts). */
const NO_TEAM_CHIP = {
  id: NO_TEAM,
  name: "Без команды",
  color: null as string | null,
} as Team;

export interface HomeLedgerInput {
  refs: HomeReferences;
  period: Period;
  scope: string | null;
  setScope: ReturnType<typeof useFinanceRoute>["setScope"];
  access: FinancePageAccess;
  readRules: FinanceReadRules;
  requestedClientId: string | undefined;
}

/** Period ledger and debts of the chip, the «Без команды» chip and the
 *  scope fallback, and everything narrowed to the deep-link client. */
export function useHomeLedger(input: HomeLedgerInput) {
  const { refs, period, scope, setScope, access, readRules, requestedClientId } = input;
  const { appts, invoices, teams, teamsQuery, orphanAccounts, hasOrphanAccounts, accountTeam, accountsLoaded } = refs;
  // «Без команды» — не команда: долги под этим чипом отбираются на экране
  // (`team_id` пуст), а у хука берётся вся компания тем же ключом.
  // ДОЛГИ — ЗА ВЫБРАННЫЙ ПЕРИОД (владелец 03.10, вечером, после «долги это
  // долги»: «лучше выбирать период — я могу запутаться в деньгах; выбираю
  // текущий месяц — и долги только по текущему месяцу»). Плитка, панель
  // «Долги» и лента считают одно окно. Оплаты долга при этом — без окна
  // (`useDebtPayments`): долг из этого месяца, закрытый в следующем, закрыт.
  const debtsQuery = useDebts(period.from, period.to, {
    teamId: scope === NO_TEAM ? null : scope,
  });
  // Вся компания без отбора — тот же ключ, лишнего запроса нет: по ней видно,
  // есть ли долги без команды, которым нужен чип «Без команды».
  const companyDebtsQuery = useDebts(period.from, period.to);
  // Команда каждого долга: оплата долга видна и по «Долгам» его команды.
  const debtTeams = useMemo(
    () =>
      new Map(
        (companyDebtsQuery.data ?? []).map((debt) => [debt.id, debt.team_id ?? null] as const),
      ),
    [companyDebtsQuery.data],
  );
  const debtPaidQuery = useDebtPaidTotals();
  // Журнал периода всей компании — тот же ключ, что у командного отбора ниже,
  // лишнего запроса нет: из него добираются строки без команды.
  const companyLedgerQuery = useTransactions(period.from, period.to);
  const teamlessKnown =
    companyLedgerQuery.data !== undefined && companyDebtsQuery.data !== undefined;
  const hasTeamless = useMemo(
    () =>
      hasTeamlessMoney({
        appointments: appts,
        debts: companyDebtsQuery.data ?? [],
        companyRows: companyLedgerQuery.data ?? [],
        accountTeam,
      }),
    [appts, companyDebtsQuery.data, companyLedgerQuery.data, accountTeam],
  );
  // ЧИП «БЕЗ КОМАНДЫ» ЖИВЁТ, ПОКА У ДЕНЕГ НЕТ КОМАНДЫ: счета-сироты ИЛИ записи,
  // долги и строки журнала без команды не на счёте команды. Раньше его держали
  // только сироты, и такие деньги не показывались нигде (находки 2026-09-15).
  // Сотруднику чипа «Без команды» нет вовсе: общие счета компании и деньги без
  // команды — не его календарь, а сервер ему их и не отдаёт.
  const needsNoTeamChip = access.noTeamChip && (hasOrphanAccounts || hasTeamless);
  const scopeChipTeams = useMemo(
    () => (needsNoTeamChip ? [...teams, NO_TEAM_CHIP] : teams),
    [needsNoTeamChip, teams],
  );
  // ДЕНЬГИ ВСЕГДА ЧЬИ-ТО. Владелец 2026-08-10: «компания в целом не нужна,
  // только разбивка по командам — итог по компании смотрят в сводках».
  // Поэтому скоуп никогда не бывает пустым: открываем ту команду, с которой
  // человек работает, а если её удалили — первую живую. Чип «Без команды»
  // легален, пока есть бесхозные счета; роздали — уходим на первую команду.
  useEffect(() => {
    if (!teamsQuery.isSuccess) return;
    // Функцией от очереди (`fallbackScopeUpdate`): команда счёта из адреса,
    // поставленная в этом же кадре, не затирается первой командой. Сироты
    // розданы — у тенанта без команд скоуп уходит в null, иначе экран ждал бы
    // отключённый запрос вечно.
    setScope(
      fallbackScopeUpdate({
        teamIds: teams.map((team) => team.id),
        // Уводить с «Без команды» можно, только когда известно, что денег без
        // команды нет: пока журнал и долги едут, чип нельзя объявить пустым.
        accountsLoaded: accountsLoaded && teamlessKnown,
        hasOrphans: needsNoTeamChip,
      }),
    );
  }, [accountsLoaded, teamlessKnown, needsNoTeamChip, scope, setScope, teams, teamsQuery.isSuccess]);

  const selectedClient = useMemo(
    () => refs.clients.find((client) => client.id === requestedClientId) ?? null,
    [refs.clients, requestedClientId],
  );
  const scopedAppointments = useMemo(
    () => forClient(appts, requestedClientId),
    [appts, requestedClientId],
  );
  const scopedInvoices = useMemo(
    () => forClient(invoices, requestedClientId),
    [invoices, requestedClientId],
  );

  const ledgerFilter = ledgerFilterFor(scope, orphanAccounts);
  const transactionsQuery = useTransactions(period.from, period.to, ledgerFilter);
  const txs = useMemo(
    () => transactionsQuery.data ?? [],
    [transactionsQuery.data],
  );

  // Строки без команды добираются из той же выборки компании: командный отбор
  // их не видит, а деньги их лежат на счетах (`team-scope.ts`).
  const teamlessRows = useMemo(
    () => teamlessLedgerRows(companyLedgerQuery.data ?? [], scope, accountTeam),
    [companyLedgerQuery.data, scope, accountTeam],
  );
  // Видимое по строке — до любых итогов и лент: лента «Записи», «Счета» и
  // плитки считают одно и то же множество.
  const scopedTransactions = useMemo(() => {
    const rows = readableTransactions(withTeamlessRows(txs, teamlessRows), readRules, debtTeams);
    return forClient(rows, requestedClientId);
  }, [requestedClientId, txs, teamlessRows, readRules, debtTeams]);

  return {
    debtsQuery,
    debtTeams,
    debtPaidQuery,
    scopeChipTeams,
    selectedClient,
    scopedAppointments,
    scopedInvoices,
    ledgerFilter,
    transactionsQuery,
    scopedTransactions,
  };
}
