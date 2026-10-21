import { View } from "react-native";
import { Screen } from "@/components/ui/Screen";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingBar } from "@/components/ui/LoadingBar";
import { loadErrorWords } from "@/lib/connection-words";
import { AccountEditorSheet } from "@/features/finances/account-editor/AccountEditorSheet";
import { NO_TEAM } from "@/features/finances/accounts-sections";
import { FinanceOverview, ScopePeriodBar } from "@/features/finances/FinanceOverview";
import { FinancesFooter } from "@/features/finances/FinancesFooter";
import { ClientFinanceBanner } from "@/features/finances/home/ClientFinanceBanner";
import { FinancesHeader } from "@/features/finances/home/FinancesHeader";
import { newInvoiceHref } from "@/features/finances/home/home-links";
import { HomePanels } from "@/features/finances/home/HomePanels";
import { HomeSheets } from "@/features/finances/home/HomeSheets";
import { useFinanceHome } from "@/features/finances/home/use-finance-home";

// The tab is layout only: data, access, feeds and actions live in
// `features/finances/home/`, wired by `useFinanceHome`.
function FinancesContent() {
  const home = useFinanceHome();
  const {
    access,
    view,
    setView,
    documentsView,
    query,
    setQuery,
    period,
    scope,
    changeScope,
    scopeChipTeams,
    setPresetOpen,
    setWheelsOpen,
    openFinanceSettings,
    loading,
    loadError,
    refreshAll,
    stale,
    accountsLoaded,
    accounts,
    transferAccountsQuery,
    firstAccountOpen,
    setFirstAccountOpen,
    shownTotals,
    accountsSummary,
    invoiceSummary,
    canUseDocuments,
    toggleView,
    requestedClientId,
    selectedClient,
    debtSide,
    teamByIdAll,
    scopedAccounts,
    accountId,
    pushOnce,
    setEditingDebt,
    setDebtOpen,
    setEditingTx,
    setOpOpen,
  } = home;

  const header = (
    <FinancesHeader
      access={access}
      view={view}
      setView={setView}
      documentsView={documentsView}
      query={query}
      setQuery={setQuery}
      period={period}
      openFinanceSettings={openFinanceSettings}
    />
  );

  // ЛЕНТА КОМАНД И ПЕРИОД — И ПОКА ГРУЗИТСЯ, И КОГДА СЕРВЕР МОЛЧИТ (как в
  // календаре: команды сверху видны и без загрузки). Та же полоса, что над сводкой, —
  // при ответе сервера экран не прыгает. Без ответа период глухой: выбирать
  // его не для чего, цифр за ним нет.
  const scopeBar = (locked: boolean) => (
    <ScopePeriodBar
      teams={scopeChipTeams}
      scopeTeamId={scope}
      onScopeChange={changeScope}
      period={period}
      onOpenPresets={() => setPresetOpen(true)}
      onOpenCustom={() => setWheelsOpen(true)}
      locked={locked}
    />
  );

  if (loading) {
    return (
      <Screen edges={["top"]}>
        {header}
        {scopeBar(false)}
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (loadError) {
    // Обрыв — словами, а не «TypeError: Network request failed».
    const words = loadErrorWords(loadError, {
      failed: "Не удалось загрузить финансы",
      later: "Финансы загрузятся, как только сервер ответит.",
    });
    return (
      <Screen edges={["top"]}>
        {header}
        {scopeBar(true)}
        <EmptyState
          state="error"
          fill
          title={words.title}
          subtitle={words.subtitle}
          action={{ label: "Повторить", onPress: refreshAll }}
        />
      </Screen>
    );
  }

  // ПЕРВЫЙ ВХОД — СНАЧАЛА СЧЁТ: первым делом не все финансы, а кнопка
  // «Создать счёт» с названием. Счетов сами не заводим; пока у аккаунта нет ни одного
  // (со скрытыми), плитки и журнал ни о чём не говорят — экран один: слова и
  // главная кнопка внизу. Кто счёт завести не может (партнёр без права),
  // видит обычные «Финансы».
  const noAccountsYet =
    accountsLoaded &&
    access.accountCreate.enabled &&
    (transferAccountsQuery.data ?? accounts).length === 0;
  if (noAccountsYet) {
    return (
      <Screen edges={["top"]}>
        {header}
        {scopeBar(true)}
        <EmptyState
          fill
          title="Счетов пока нет"
          subtitle="Счёт — касса, карта или банк: на него приходят деньги и с него уходят. Начните с первого."
          action={{
            label: "Создать счёт",
            onPress: () => setFirstAccountOpen(true),
            tourId: "finances.first-create",
          }}
        />
        <AccountEditorSheet
          visible={firstAccountOpen}
          accountId={null}
          presetTeamId={scope === NO_TEAM ? null : scope}
          onClose={() => setFirstAccountOpen(false)}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["top"]}>
      {header}
      {/* Пока едет новый срез, цифры прошлого периода ГАСНУТ, а не выдаются за
          новые. Журнал и долги держат прошлый период, чтобы экран не мигал
          пустотой, — но только своей компании (`placeholderWithinTenant`):
          деньги другой компании сюда не попадают никогда, холодная компания
          идёт в скелет (`loading`), а не под вуаль. Под новой подписью периода
          это всё равно чужие цифры, и решение по ним принимать нельзя —
          поэтому гаснут и журнал, и плитка «Долги». Полоска под шапкой
          говорит, что работа идёт. */}
      <LoadingBar visible={stale} />

      <View style={{ flex: 1, opacity: stale ? 0.4 : 1 }}>
        <FinanceOverview
          teams={scopeChipTeams}
          scopeTeamId={scope}
          onScopeChange={changeScope}
          period={period}
          onOpenPresets={() => setPresetOpen(true)}
          onOpenCustom={() => setWheelsOpen(true)}
          totals={shownTotals}
          accounts={access.accounts === "locked" ? { total: 0 } : accountsSummary}
          invoices={invoiceSummary}
          showDocuments={access.has.documents}
          documentsTariffLocked={!canUseDocuments}
          showAccounts={access.has.accounts}
          showDebts={access.has.debts}
          lockAccounts={access.accounts === "locked"}
          lockIncome={access.income === "locked"}
          lockExpense={access.expense === "locked"}
          lockProfit={access.profit === "locked"}
          lockDebts={access.debts === "locked"}
          view={view}
          onTap={toggleView}
        />

        {requestedClientId ? (
          <ClientFinanceBanner clientName={selectedClient?.full_name} />
        ) : null}

        <HomePanels home={home} />
      </View>

      {/* Главное действие экрана и листы счетов — `FinancesFooter`. */}
      <FinancesFooter
        view={view}
        debtSide={debtSide}
        teamById={teamByIdAll}
        teamId={scope === NO_TEAM ? null : scope}
        accounts={accounts}
        transferAccounts={transferAccountsQuery.data}
        shownAccounts={scopedAccounts}
        selectedAccountId={view === "accounts" ? accountId : null}
        // Команда чипа — команда счёта (ставка VAT, касса, «Документы» этой
        // команды); без неё инвойс ушёл бы первой команде.
        onIssueInvoice={() => pushOnce(newInvoiceHref(scope))}
        onAddDebt={() => {
          setEditingDebt(null);
          setDebtOpen(true);
        }}
        onAddOperation={() => {
          setEditingTx(null);
          setOpOpen(true);
        }}
        // Главное действие экрана — по уровню ВЫБРАННОГО календаря: «Смотрит»
        // гасит кнопку и называет причину словами, закрытый блок — просто
        // гасит (страница и так серая по нулям).
        enabled={access.footer(view).enabled}
        reason={access.footer(view).reason}
        create={access.accountCreate}
        accountsReady={accountsLoaded}
      />

      <HomeSheets home={home} />
    </Screen>
  );
}

// Граница прав живёт в `finances/_layout.tsx` и накрывает ВЕСЬ каталог:
// вторая копия здесь закрывала бы только корень, оставляя `/finances/vat` и
// `/finances/settings` открытыми по диплинку.

export default function FinancesTab() {
  return <FinancesContent />;
}
