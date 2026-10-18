// Pure builders of the «Финансы» home feed: the period feed (records, debts,
// transfers), the all-time note-search fallback, and the documents tab pick.

import type { Appointment } from "@babun/shared/local/appointments";
import type { Debt } from "@babun/shared/local/finance/debt";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { debtRows, manualDebtRows, type DebtRow } from "../debt-rows";
import type { DocumentFilter, FinanceDocument } from "../documents";
import type { FinancePageAccess } from "../finance-page-access";
import {
  readableTransactions,
  type DebtTeams,
  type FinanceReadRules,
} from "../finance-read-rules";
import type { HomeView } from "../FinanceOverview";
import { incomeDeals } from "../income-deals";
import {
  mergeByRecord,
  recordRows,
  rowMatchesQuery,
  type RecordRow,
  type RecordRowRefs,
} from "../record-rows";
import { NO_TEAM } from "../accounts-sections";
import { inTeamScope, teamlessLedgerRows, withTeamlessRows } from "../team-scope";
import { forClient } from "./home-scope";

type Named = { id: string; name: string };
type Person = { id: string; full_name: string; phone?: string | null };

export interface FeedRowsInput {
  access: Pick<FinancePageAccess, "recordMoney">;
  view: HomeView;
  query: string;
  scopedTransactions: readonly FinanceTransaction[];
  materialRows: readonly FinanceTransaction[];
  recordRefs: RecordRowRefs;
  scopedAppointments: readonly Appointment[];
  clients: readonly Person[];
  services: readonly Named[];
  categories: readonly Named[];
  period: { from: string; to: string };
  businessToday: string;
  businessNowHm: string;
  scope: string | null;
  invoicedAppointments: ReadonlySet<string>;
  invoiceDebts: readonly DebtRow[];
  debts: readonly Debt[];
  debtPaid: ReadonlyMap<string, number>;
}

// ГЛАВНАЯ ЛЕНТА СЧИТАЕТ ЗАПИСЯМИ, А НЕ ПРОВОДКАМИ: несколько операций по одной
// записи забили бы всю ленту.
//
// Один визит мог держать 19 строк: оплату вносили и снимали восемь
// раз, пока подбирали сумму. Поэтому запись даёт САМОЕ БОЛЬШЕЕ ДВЕ строки —
// свой доход целиком и свой расход целиком. Схлопывать их между собой
// нельзя (доход 135 стоит целиком, расход 10 стоит
// целиком, а в прибыли уже 135 − 10), поэтому строки разные и разного
// цвета, а ключ несёт направление — иначе две строки одного визита
// подрались бы за один ключ списка.
//
// Поимённая история платежей живёт в самой записи, кнопкой в блоке оплаты.
export function buildFeedRows(input: FeedRowsInput): RecordRow[] {
  const {
    access,
    view,
    query,
    scopedTransactions,
    materialRows,
    recordRefs,
    scopedAppointments,
    clients,
    services,
    categories,
    period,
    businessToday,
    businessNowHm,
    scope,
    invoicedAppointments,
    invoiceDebts,
    debts,
    debtPaid,
  } = input;
  if (view !== "all" && view !== "income" && view !== "expense") return [];
  const tag = (rows: ReturnType<typeof recordRows>, tone: "income" | "expense") =>
    rows.map((row) => ({ ...row, tone, key: `${tone}:${row.key}` }));

  const income =
    view === "expense"
      ? []
      : tag(recordRows(incomeDeals(scopedTransactions), recordRefs), "income");
  const expense =
    view === "income"
      ? []
      : tag(
          recordRows(
            [
              ...scopedTransactions.filter((tx) => tx.type === "expense"),
              ...materialRows,
            ],
            recordRefs,
          ),
          "expense",
        );
  // Долг — деньги, которые ПРИДУТ. Он виден и на своей плитке, и в общей ленте:
  // иначе долг висит, а в общей ленте его нет. Один визит может дать и доход, и долг — это не
  // задвоение, а два разных состояния одних работ.
  // Ручные долги идут В ТОЙ ЖЕ ленте: для владельца это одно событие дня —
  // «взяли кондиционеры у Gree и не заплатили» стоит рядом с деньгами того
  // же дня. Сторону в общей ленте называет отметка «Я должен»: переключателя
  // здесь нет, а без неё «должны нам» и «должны мы» выглядят одинаково.
  const debtBlocks =
    view === "all"
      ? [
          ...(access.recordMoney
            ? debtRows(scopedAppointments, clients, services, {
                // Общая лента — лента периода: долги в ней того же окна.
                // Остаток на сегодня — у плитки и панели «Долги».
                from: period.from,
                to: period.to,
                today: businessToday,
                nowHm: businessNowHm,
                teamId: scope,
                invoicedAppointmentIds: invoicedAppointments,
              })
            : []),
          ...manualDebtRows(
            // Лента периода: ручные долги того же окна.
            debts.filter((debt) => debt.occurred_on >= period.from && debt.occurred_on <= period.to),
            debtPaid,
            { clients, categories },
            { today: businessToday, markDirection: true },
          ),
          ...invoiceDebts,
        ].map((row) => ({ ...row, key: `debt:${row.key}` }))
      : [];
  // Перевод — не доход и не расход: в срезах его нет, а в общей ленте он
  // обязан быть, иначе деньги между счетами исчезают из виду.
  const transfers =
    view === "all"
      ? recordRows(
          scopedTransactions.filter((tx) => tx.type === "transfer"),
          recordRefs,
        ).map((row) => ({ ...row, key: `tr:${row.key}` }))
      : [];

  // Ищем по тому, что человек ВИДИТ в строке (`rowMatchesQuery`). Раньше
  // поиск шёл по проводкам — по невидимому.
  const all = [...income, ...expense, ...debtBlocks, ...transfers];
  // ОДНА ЗАПИСЬ — ОДНА СТРОКА. В общей ленте состояния
  // одной работы склеиваются: доход главным числом, остальное подписью.
  // В разрезах склейки нет — там человек просил именно этот вид денег.
  return (view === "all" ? mergeByRecord(all) : all)
    .filter((row) => rowMatchesQuery(row, query))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      const at = a.time ?? "";
      const bt = b.time ?? "";
      if (at !== bt) return at < bt ? 1 : -1;
      return a.key < b.key ? 1 : -1;
    });
}

export interface AllTimeRowsInput {
  /** Raw rows of the all-time note search. */
  found: FinanceTransaction[];
  readRules: FinanceReadRules;
  debtTeams: DebtTeams;
  orphanAccounts: readonly { id: string }[];
  scope: string | null;
  accountTeam: ReadonlyMap<string, string | null>;
  requestedClientId: string | undefined;
  view: HomeView;
  recordRefs: RecordRowRefs;
}

// Те же рамки, что у ленты: чип команды (строки без команды — по команде
// счёта), клиент из диплинка и разрез. Иначе под «Доходом» Команды 1
// поиск показывал бы и расходы, и чужие команды.
export function buildAllTimeRows(input: AllTimeRowsInput): RecordRow[] {
  const { scope, accountTeam, view, recordRefs } = input;
  // Тем же отбором по строке, что лента: в зеркале поиск идёт токеном
  // владельца и нашёл бы скрытую сторону.
  const found = readableTransactions(input.found, input.readRules, input.debtTeams);
  const orphanIds = new Set(input.orphanAccounts.map((account) => account.id));
  const teamRows = !scope
    ? found
    : withTeamlessRows(
        scope === NO_TEAM
          ? found.filter((tx) => tx.account_id != null && orphanIds.has(tx.account_id))
          : found.filter((tx) => tx.team_id != null && inTeamScope(tx.team_id, scope)),
        teamlessLedgerRows(found, scope, accountTeam),
      );
  const rows = forClient(teamRows, input.requestedClientId);
  const income =
    view === "expense"
      ? []
      : recordRows(incomeDeals(rows), recordRefs).map((row) => ({
          ...row,
          tone: "income" as const,
          key: `income:${row.key}`,
        }));
  const expense =
    view === "income"
      ? []
      : recordRows(rows.filter((tx) => tx.type === "expense"), recordRefs).map(
          (row) => ({ ...row, tone: "expense" as const, key: `expense:${row.key}` }),
        );
  const transfers =
    view === "all"
      ? recordRows(rows.filter((tx) => tx.type === "transfer"), recordRefs).map(
          (row) => ({ ...row, key: `tr:${row.key}` }),
        )
      : [];
  return [...income, ...expense, ...transfers];
}

/** «Документы» открываются там, где что-то есть: единственный чек месяца
 *  прятался за пустой вкладкой «Инвойсы 0». `null` —
 *  текущую вкладку не трогаем. */
export function documentsFilterOnOpen(
  docs: readonly Pick<FinanceDocument, "kind">[],
  current: DocumentFilter,
): DocumentFilter | null {
  const has = (kind: DocumentFilter) => docs.some((d) => d.kind === kind);
  if (!has(current) && docs.length > 0) {
    return has("invoice") ? "invoice" : "receipt";
  }
  return null;
}
