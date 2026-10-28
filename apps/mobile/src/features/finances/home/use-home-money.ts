import { useCallback, useMemo } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { accountsTotal } from "../account-ui";
import { sortAccountRows } from "../accounts-sections";
import type { FinancePageAccess } from "../finance-page-access";
import {
  readableDocuments,
  type DocumentsReadable,
  type FinanceReadRules,
} from "../finance-read-rules";
import type { HomeView } from "../FinanceOverview";
import { materialExpenseRows } from "../material-expenses";
import type { Period } from "@/lib/period";
import { usePeriodDocuments } from "../use-period-documents";
import { buildFeedRows } from "./feed-rows";
import { scopedAccountsFor } from "./home-scope";
import { homeTotals, materialSummaryFor } from "./home-totals";
import type { useHomeDebts } from "./use-home-debts";
import type { HomeReferences } from "./use-home-references";

interface HomeMoneyInput {
  refs: HomeReferences;
  debtsState: ReturnType<typeof useHomeDebts>;
  access: FinancePageAccess;
  readRules: FinanceReadRules;
  view: HomeView;
  query: string;
  period: Period;
  scope: string | null;
  businessToday: string;
  businessNowHm: string;
  requestedClientId: string | undefined;
  scopedTransactions: FinanceTransaction[];
  scopedAppointments: Appointment[];
  scopedInvoices: HomeReferences["invoices"];
}

/** Tile numbers, period documents and the period feed of the screen. */
export function useHomeMoney(input: HomeMoneyInput) {
  const {
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
  } = input;
  const { accounts, orphanAccounts, services, clients, categories, allAccounts, people, invoices, invoicePayments } =
    input.refs;
  const { invoicedAppointments, invoiceDebts, debts, debtPaid, manualIncomingDebt } = input.debtsState;

  // Счёт = одна команда: командный скоуп видит РОВНО счета
  // своей команды, «общих счетов» нет; чип «Без команды» показывает
  // сирот старой схемы.
  const scopedAccounts = useMemo(
    () => scopedAccountsFor(accounts, orphanAccounts, scope),
    [accounts, orphanAccounts, scope],
  );
  // Одна цифра «сколько у нас денег» на весь продукт: плитка «Счета» считает
  // сумму видимых счетов. СКРЫТЫЙ счёт («накопительный, для
  // себя») в неё не входит — его деньги видны только на странице «Счета».
  // Разбивки по видам счетов здесь НЕТ: плитка отвечает
  // «сколько у команды», а не «сколько из этого наличными» — второй вопрос
  // задают плитками счетов под ней, глядя на конкретный счёт.
  const accountsSummary = useMemo(
    () => ({ total: accountsTotal(scopedAccounts) }),
    [scopedAccounts],
  );

  const materialSummary = useMemo(
    () => materialSummaryFor({ recordMoney: access.recordMoney }, scopedAppointments, services, { from: period.from, to: period.to }, scope),
    [access.recordMoney, period.from, period.to, scope, scopedAppointments, services],
  );

  const totals = useMemo(
    () =>
      homeTotals({
        access: { recordMoney: access.recordMoney },
        scopedTransactions,
        scopedAppointments,
        invoicedAppointments,
        businessToday,
        businessNowHm,
        period: { from: period.from, to: period.to },
        scope,
        materialAmount: materialSummary.amount,
        manualIncomingDebt,
        invoiceDebts,
      }),
    [
      access.recordMoney,
      manualIncomingDebt,
      invoiceDebts,
      scopedTransactions,
      scopedAppointments,
      invoicedAppointments,
      businessToday,
      businessNowHm,
      period.from,
      period.to,
      scope,
      materialSummary.amount,
    ],
  );

  // ПЛИТКА ЗАКРЫТОГО БЛОКА — СЕРАЯ И ПО НУЛЯМ, а не последнее,
  // что успело приехать до понижения прав.
  const shownTotals = useMemo(
    () => ({
      income: access.income === "locked" ? 0 : totals.income,
      expense: access.expense === "locked" ? 0 : totals.expense,
      profit: access.profit === "locked" ? 0 : totals.profit,
      debt: access.debts === "locked" ? 0 : totals.debt,
    }),
    [access.debts, access.income, access.expense, access.profit, totals],
  );

  // Плитка «Документы» — ШТУКИ, и ровно те, что
  // откроются под ней (иначе «Документы 0», а в «Чеках» за тот же
  // месяц 1 чек — плитка считала только инвойсы, ждущие оплату). Один список
  // с панелью (`usePeriodDocuments`): число и строки не расходятся.
  const issuedDocuments = usePeriodDocuments({
    invoices: scopedInvoices,
    payments: invoicePayments,
    appointments: scopedAppointments,
    accounts,
    clients,
    clientId: requestedClientId,
    teamId: scope,
    period,
    today: businessToday,
  });
  // ДОКУМЕНТЫ — ПО ПРАВУ «ДОКУМЕНТЫ» КОМАНДЫ: скрыты — плитка «0» и пустая
  // панель. Плитка и панель режут одним отбором.
  const documentsReadable = useCallback<DocumentsReadable>(
    (documents, receipts) => readableDocuments(documents, receipts, readRules),
    [readRules],
  );
  const periodDocuments = useMemo(
    () => ({
      documents: documentsReadable(issuedDocuments.documents, issuedDocuments.receipts),
    }),
    [documentsReadable, issuedDocuments.documents, issuedDocuments.receipts],
  );
  const invoiceSummary = useMemo(
    // Кредит-нота — сторно отменённого счёта, а не ещё один документ периода.
    () => ({ count: periodDocuments.documents.filter((d) => !d.creditNote).length }),
    [periodDocuments.documents],
  );

  // Материалы записей — строками в «Расходе»: плитка
  // считала их всегда, теперь и список их называет поимённо.
  const materialRows = useMemo(
    () =>
      access.recordMoney
        ? materialExpenseRows(scopedAppointments, services, {
            from: period.from,
            to: period.to,
            teamId: scope,
          })
        : [],
    [access.recordMoney, period.from, period.to, scope, scopedAppointments, services],
  );

  // Каждая строка называет свой счёт: имена берутся со
  // всех счетов, включая закрытые, в порядке плиток — строка «Наличные ·
  // Карта» читается в том же порядке, что счета над ней.
  const recordRefs = useMemo(
    () => ({
      appointments: scopedAppointments,
      clients,
      services,
      categories,
      accounts: sortAccountRows(allAccounts),
      people,
      // Визит вне периода (предоплата сегодня за завтра) — строка днём денег.
      window: { from: period.from, to: period.to },
      // Оплата инвойса — строкой «Инвойс INV-…».
      invoices,
    }),
    [scopedAppointments, clients, services, categories, allAccounts, people, period.from, period.to, invoices],
  );

  const blockRows = useMemo(
    () =>
      buildFeedRows({
        access: { recordMoney: access.recordMoney },
        view,
        query,
        scopedTransactions,
        materialRows,
        recordRefs,
        scopedAppointments,
        clients,
        services,
        categories,
        period: { from: period.from, to: period.to },
        businessToday,
        businessNowHm,
        scope,
        invoicedAppointments,
        invoiceDebts,
        debts,
        debtPaid,
      }),
    [
      access.recordMoney,
      view,
      query,
      scopedTransactions,
      materialRows,
      recordRefs,
      scopedAppointments,
      clients,
      services,
      period.from,
      period.to,
      businessToday,
      businessNowHm,
      scope,
      invoicedAppointments,
      invoiceDebts,
      debts,
      debtPaid,
      categories,
    ],
  );

  return {
    scopedAccounts,
    accountsSummary,
    materialSummary,
    shownTotals,
    documentsReadable,
    periodDocuments,
    invoiceSummary,
    recordRefs,
    blockRows,
  };
}
