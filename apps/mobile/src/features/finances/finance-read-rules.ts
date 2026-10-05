import type { Debt } from "@babun/shared/local/finance/debt";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { MemberAccessMap } from "@/features/access/access-map";
import { moneyKey } from "@/features/access/my-access";
import type { UserRole } from "@/features/settings/role-policy";
import type { FinanceDocument } from "./documents";
import { levelInCalendar } from "./finance-page-access";
import { asRecordWindow, recordWindowStart } from "@/features/appointments/record-window";

// ЧТО ЧЕЛОВЕКУ ВИДНО В «ФИНАНСАХ» — ПО СТРОКЕ, А НЕ ПО ЧИПУ.
//
// Настоящему сотруднику строки режет сервер: доход и возврат — «Доходы» в
// команде строки, расход — «Расходы», перевод — «Счета»
// (`finance_transactions_select_calendar`), оплата долга — ещё и «Долги» его
// команды (`finance_transactions_select_debt`), долг — «Долги»
// (`debts_read`), инвойс и чек — «Документами» команды документа
// (`invoices_select_documents`, `receipts_select_documents`, с 03.10), чек —
// ещё и когда видна его операция (`receipts_read_own_money`), диспетчеру — все
// (`receipts_read`).
//
// В ЗЕРКАЛЕ («его глазами») права его, а токен ваш: сервер отдаёт ВСЁ, и
// страница показывала бы расходы при «Расходы: Не видит». Поэтому то же
// правило повторено здесь. У настоящего сотрудника оно ничего не отрезает —
// сервер уже отрезал; у владельца фильтры возвращают вход как есть.
//
// Чек ещё проверяется «Историей» клиента (`clients.history`): права клиента
// на телефоне не считаются, и здесь работает только правило операции.

type TxLike = Pick<FinanceTransaction, "type" | "team_id" | "debt_id"> & {
  /** День операции — для «Ограничений» (03.10); без него окно не режет. */
  occurred_on?: string;
};
type DebtLike = Pick<Debt, "team_id">;

export interface FinanceReadRules {
  /** Владелец читает всё: фильтры отдают вход без копии. */
  owner: boolean;
  /** `debtTeamId`: `undefined` — команда долга неизвестна экрану, берём
   *  команду самой строки (платёж проводится в команде долга); `null` —
   *  долг без команды. */
  txReadable: (tx: TxLike, debtTeamId?: string | null) => boolean;
  debtReadable: (debt: DebtLike) => boolean;
  /** Инвойс команды — «Документы» этой команды (`invoices_select_documents`). */
  documentReadable: (teamId: string | null) => boolean;
  /** Все чеки компании — владельцу и диспетчеру (`receipts_read`). */
  allReceipts: boolean;
}

export interface FinanceReader {
  /** `undefined` — роль ещё не пришла; `null` — человека в компании нет. */
  role: UserRole | null | undefined;
  /** `undefined` — карта прав ещё не пришла. */
  map: MemberAccessMap | undefined;
  /** Сегодня по часам бизнеса — для «Ограничений» финансов (03.10). Нет —
   *  окно не режет (аналитика берёт свой период сама). */
  today?: string;
}

export function financeReadRules({ role, map, today }: FinanceReader): FinanceReadRules {
  const owner = role === "owner" || map?.isOwner === true;
  const readable = (blockKey: string, teamId: string | null | undefined): boolean =>
    levelInCalendar({ role, map }, blockKey, teamId) !== "locked";
  /** Блок стороны строки — тем же ключом, что считает страница. */
  const sideBlock = (type: TxLike["type"]): string =>
    type === "income" || type === "refund"
      ? moneyKey(map, "income")
      : type === "expense"
        ? moneyKey(map, "expense")
        : "finance.accounts";

  /** «Ограничения» (владелец 03.10): доход, возврат и расход старше окна
   *  команды партнёру не видны — как сервер (`finance_transactions_window`).
   *  Платежи по долгам и переводы окно не режет. Ступени в карте нет (старая
   *  карта) — окна нет: прятать по догадке хуже. */
  const beforeWindow = (tx: TxLike): boolean => {
    if (!today || !tx.occurred_on || tx.debt_id || !tx.team_id) return false;
    if (tx.type !== "income" && tx.type !== "refund" && tx.type !== "expense") return false;
    const level = map?.calendars[tx.team_id]?.["finance.window"];
    if (level === undefined) return false;
    const start = recordWindowStart(asRecordWindow(level), today);
    return start !== null && tx.occurred_on < start;
  };

  const txReadable: FinanceReadRules["txReadable"] = (tx, debtTeamId) => {
    if (owner) return true;
    if (readable(sideBlock(tx.type), tx.team_id)) return !beforeWindow(tx);
    if (!tx.debt_id) return false;
    return readable("finance.debts", debtTeamId === undefined ? tx.team_id : debtTeamId);
  };

  return {
    owner,
    txReadable,
    debtReadable: (debt) => owner || readable("finance.debts", debt.team_id),
    documentReadable: (teamId) => owner || (!!teamId && readable("finance.documents", teamId)),
    allReceipts: owner || role === "dispatcher",
  };
}

/** Команда долга по его id — для платежей, которые видны по «Долгам». */
export type DebtTeams = ReadonlyMap<string, string | null>;

const debtTeamOf = (debtTeams: DebtTeams, debtId: string | null): string | null | undefined =>
  debtId && debtTeams.has(debtId) ? (debtTeams.get(debtId) ?? null) : undefined;

/** Строки журнала, которые человек вправе прочитать. */
export function readableTransactions<T extends TxLike>(
  rows: T[],
  rules: FinanceReadRules,
  debtTeams: DebtTeams,
): T[] {
  if (rules.owner) return rows;
  return rows.filter((tx) => rules.txReadable(tx, debtTeamOf(debtTeams, tx.debt_id)));
}

/** Ручные долги, которые человек вправе прочитать. */
export function readableDebts<T extends DebtLike>(rows: T[], rules: FinanceReadRules): T[] {
  if (rules.owner) return rows;
  return rows.filter(rules.debtReadable);
}

/** Отбор документов — один для плитки «Документы» и панели под ней. */
export type DocumentsReadable = (
  documents: FinanceDocument[],
  receipts: readonly Receipt[] | undefined,
) => FinanceDocument[];

/** Документы периода, которые человек вправе прочитать: инвойс и чек — по
 *  «Документам» своей команды. «ДОКУМЕНТЫ: СКРЫТЫ» — НИ ОДНОГО (владелец
 *  04.10: «скрывается совсем, в документах пишется ноль, и их просто не
 *  видно»): чек своей операции сюда больше не проходит, хотя сервер его
 *  отдаёт (`receipts_read_own_money` — для истории клиента и записи).
 *  Неизвестный чек не показывается. */
export function readableDocuments(
  documents: FinanceDocument[],
  receipts: readonly Receipt[] | undefined,
  rules: FinanceReadRules,
): FinanceDocument[] {
  if (rules.owner) return documents;
  const receiptIds = new Set((receipts ?? []).map((receipt) => receipt.id));
  return documents.filter((doc) => {
    if (doc.kind === "invoice") return rules.documentReadable(doc.teamId);
    if (!receiptIds.has(doc.id)) return false;
    return rules.allReceipts || rules.documentReadable(doc.teamId);
  });
}

// АНАЛИТИКА — ДВЕ СТОРОНЫ ДЕНЕГ ПОРОЗНЬ. Доход открывает выручку, расход —
// расход, прибыль и всё, что из неё (VAT, материалы услуг), — только обе.
// Уровень — лучший по календарям: аналитика открывается на всей компании.

export interface MoneySides {
  income: boolean;
  expense: boolean;
  /** «Прибыль» (`finance.profit`, аудит прав 04.10): «Скрыта» прятала только
   *  плитку «Финансов», а аналитика показывала прибыль всё равно. Нужны и
   *  обе стороны денег, и само право. */
  profit: boolean;
}

export function moneySides({ role, map }: FinanceReader): MoneySides {
  if (role === "owner" || map?.isOwner === true) return { income: true, expense: true, profit: true };
  if (role === undefined || role === null || !map) return { income: false, expense: false, profit: false };
  const seen = (key: string): boolean =>
    Object.keys(map.calendars).some((teamId) => levelInCalendar({ role, map }, key, teamId) !== "locked");
  const income = seen(moneyKey(map, "income"));
  const expense = seen(moneyKey(map, "expense"));
  return { income, expense, profit: income && expense && seen("finance.profit") };
}

/** Денежная панель аналитики открыта, только если видны её деньги; иначе —
 *  панель услуг, с которой экран и открывается. */
export function moneyPanelOpen(panel: string, sides: MoneySides): boolean {
  if (panel === "income" || panel === "check") return sides.income;
  if (panel === "expense") return sides.expense;
  if (panel === "profit") return sides.profit;
  return true;
}
