import { Text, View } from "react-native";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { AccountsPanel } from "../AccountsPanel";
import { DebtorsList } from "../DebtorsList";
import { DocumentsPanel } from "../DocumentsPanel";
import { ProfitBreakdown } from "../ProfitBreakdown";
import { RecordRowsPanel } from "../RecordRowsPanel";
import type { FinanceHome } from "./use-finance-home";

/** The panel under the tiles: the open view's list. */
export function HomePanels({ home }: { home: FinanceHome }) {
  const t = useThemeColors();
  const {
    view,
    access,
    scope,
    period,
    query,
    refreshControl,
    pushOnce,
    openRecordRow,
    scopedAccounts,
    scopedTransactions,
    recordRefs,
    accountId,
    setAccountId,
    documentsReadable,
    scopedInvoices,
    invoicePayments,
    scopedAppointments,
    accounts,
    clients,
    requestedClientId,
    businessToday,
    businessNowHm,
    docFilter,
    setDocFilter,
    categories,
    services,
    materialSummary,
    profitBefore,
    people,
    invoicedAppointments,
    invoiceDebts,
    debts,
    debtPaid,
    debtSide,
    setDebtSide,
    openDebt,
    canUseDocuments,
    setView,
    searchInPeriodEmpty,
    allTimeSearchPending,
    allTimeRows,
    blockRows,
    feedTitle,
    canDeleteRow,
    deleteRow,
  } = home;

  if (view === "accounts") {
    return (
      <AccountsPanel
        accounts={scopedAccounts}
        transactions={scopedTransactions}
        refs={recordRefs}
        selectedId={accountId}
        onSelect={setAccountId}
        onOpen={pushOnce}
        onOpenRecord={openRecordRow}
        refreshControl={refreshControl}
        canOpenSettings={access.settings}
        // Настройки — на счетах выбранной команды.
        teamId={scope}
        canDeleteRow={canDeleteRow}
        onDeleteRow={deleteRow}
      />
    );
  }
  if (view === "documents") {
    return (
      <DocumentsPanel
        // Документы выставляет владелец: у остальных панель не обещает
        // кнопку, которой у них нет.
        canIssue={access.documents}
        readable={documentsReadable}
        invoices={scopedInvoices}
        payments={invoicePayments}
        appointments={scopedAppointments}
        accounts={accounts}
        clients={clients}
        clientId={requestedClientId}
        teamId={scope}
        period={period}
        today={businessToday}
        query={query}
        filter={docFilter}
        onFilterChange={setDocFilter}
        onOpen={pushOnce}
        refreshControl={refreshControl}
      />
    );
  }
  if (view === "profit") {
    return (
      <ProfitBreakdown
        transactions={scopedTransactions}
        categories={categories}
        services={services}
        appointments={scopedAppointments}
        materialCost={materialSummary.amount}
        materialAppointmentCount={materialSummary.appointmentCount}
        materialsByService={materialSummary.byService}
        compare={profitBefore}
        people={people}
        refreshControl={refreshControl}
      />
    );
  }
  if (view === "debt") {
    return (
      <DebtorsList
        appointments={access.recordMoney ? scopedAppointments : []}
        clients={clients}
        services={services}
        teamId={scope}
        // Долги выбранного периода.
        fromDate={period.from}
        toDate={period.to}
        todayYmd={businessToday}
        nowHm={businessNowHm}
        invoicedAppointmentIds={invoicedAppointments}
        invoiceDebts={invoiceDebts}
        debts={debts}
        paidTotals={debtPaid}
        categories={categories}
        direction={debtSide}
        onDirectionChange={setDebtSide}
        onEditDebt={openDebt}
        onOpenDocuments={
          canUseDocuments
            ? () => {
                setDocFilter("invoice");
                setView("documents");
              }
            : undefined
        }
        refreshControl={refreshControl}
      />
    );
  }
  return (
    <View style={{ flex: 1 }}>
      {/* ПОИСК ЗА ВСЁ ВРЕМЯ — СЛОВАМИ, а не молчаливым нулём: период
          честно пуст, но операция может стоять за его границей. */}
      {searchInPeriodEmpty ? (
        <Text
          maxFontSizeMultiplier={1.3}
          style={{
            paddingHorizontal: GUTTER,
            paddingTop: 12,
            paddingBottom: 4,
            textAlign: "center",
            fontSize: 13,
            color: t.sub,
          }}
        >
          {allTimeSearchPending
            ? "В этом периоде нет — ищем за всё время…"
            : allTimeRows.length > 0
              ? "В этом периоде нет — найдено за всё время"
              : "В этом периоде нет"}
        </Text>
      ) : null}
      <RecordRowsPanel
        rows={searchInPeriodEmpty ? allTimeRows : blockRows}
        title={searchInPeriodEmpty ? undefined : feedTitle}
        emptyTitle={
          searchInPeriodEmpty
            ? "Не нашли и за всё время"
            : query.trim()
              ? "В выбранном периоде ничего не найдено"
              : view === "income"
                ? "Дохода за период нет"
                : view === "expense"
                  ? "Расхода за период нет"
                  : "Нет операций за период"
        }
        refreshControl={refreshControl}
        onOpenRecord={openRecordRow}
        canDeleteRow={canDeleteRow}
        onDeleteRow={deleteRow}
      />
    </View>
  );
}
