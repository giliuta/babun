import { useMemo } from "react";
import type { DebtTeams, FinanceReadRules } from "../finance-read-rules";
import type { HomeView } from "../FinanceOverview";
import { panelCount } from "../PanelHeader";
import { useAllTimeNoteSearch } from "../queries";
import type { RecordRow, RecordRowRefs } from "../record-rows";
import { buildAllTimeRows } from "./feed-rows";

export interface AllTimeSearchInput {
  view: HomeView;
  query: string;
  blockRows: RecordRow[];
  readRules: FinanceReadRules;
  debtTeams: DebtTeams;
  orphanAccounts: readonly { id: string }[];
  scope: string | null;
  accountTeam: ReadonlyMap<string, string | null>;
  requestedClientId: string | undefined;
  recordRefs: RecordRowRefs;
}

/** Feed title plus the all-time note search the feed falls back to. */
export function useAllTimeSearch(input: AllTimeSearchInput) {
  const {
    view,
    query,
    blockRows,
    readRules,
    debtTeams,
    orphanAccounts,
    scope,
    accountTeam,
    requestedClientId,
    recordRefs,
  } = input;
  // Счётчик считает ПОКАЗАННОЕ. Лента считает записями, а не проводками:
  // «Операции · 19» над одним визитом читалось как девятнадцать дел
  // (2026-09-09).
  const feedTitle = panelCount(
    view === "income" ? "Доход" : view === "expense" ? "Расход" : "Записи",
    blockRows.length,
  );

  // ПОИСК ЗА ВСЁ ВРЕМЯ, КОГДА В ПЕРИОДЕ ПУСТО (аудит финансов 2026-09-24).
  // Шапка обещает «Сумма, счёт, заметка», а лента грузится окном периода:
  // первая же буква находила ноль, даже когда операция стояла за прошлый
  // месяц. Фолбэк — только по заметке (её и пишут руками) и только когда
  // открытый период честно пуст: лишний поход в сеть на каждую букву не
  // нужен, пока в периоде есть результат.
  const trimmedQuery = query.trim();
  const recordSearchView = view === "all" || view === "income" || view === "expense";
  const searchInPeriodEmpty =
    recordSearchView && trimmedQuery.length > 0 && blockRows.length === 0;
  const allTimeSearchQuery = useAllTimeNoteSearch(trimmedQuery, searchInPeriodEmpty);
  const allTimeRows = useMemo(() => {
    if (!searchInPeriodEmpty) return [];
    return buildAllTimeRows({
      found: allTimeSearchQuery.data ?? [],
      readRules,
      debtTeams,
      orphanAccounts,
      scope,
      accountTeam,
      requestedClientId,
      view,
      recordRefs,
    });
  }, [
    searchInPeriodEmpty,
    allTimeSearchQuery.data,
    readRules,
    debtTeams,
    orphanAccounts,
    scope,
    accountTeam,
    requestedClientId,
    view,
    recordRefs,
  ]);
  return {
    feedTitle,
    searchInPeriodEmpty,
    allTimeSearchPending: allTimeSearchQuery.isPending,
    allTimeFound: allTimeSearchQuery.data,
    allTimeRows,
  };
}
