import { isFeatureOn } from "@babun/shared/local/company-features";
import type { Account } from "@babun/shared/local/finance/account";
import type { Debt } from "@babun/shared/local/finance/debt";
import {
  canEditTransaction,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import type { MemberAccessMap } from "@/features/access/access-map";
import { accessGate, type AccessGate } from "@/features/access/my-access";
import type { UserRole } from "@/features/settings/role-policy";
import { NO_TEAM } from "./accounts-sections";
import type { HomeView } from "./FinanceOverview";

// «ФИНАНСЫ» ПО УРОВНЮ — ОДНО ПРАВИЛО НА ВСЮ СТРАНИЦУ (этап 2 доступа).
//
// Экран спрашивает готовые ответы: что живое у выбранной команды, можно ли
// править эту строку, виден ли остаток этого счёта. Считать уровни по месту
// нельзя: у каждой строки СВОЙ календарь (у операции — её команда, у счёта —
// его команда, у долга — его), а чип сверху — только то, что человек выбрал
// смотреть.
//
// Закон AGENTS.md 10: у человека без права блок либо отсутствует, либо виден
// только для чтения. Живой кнопки, которую сервер откажет, быть не может —
// поэтому «Меняет» здесь считается ровно теми же условиями, что и в политиках:
// расход, без инвойса и возврата, счёт команды своего календаря, долг своего
// календаря.
//
// Владелец ограничений не имеет и карту прав не ждёт: его страница не мигает.

export type Level = "locked" | "read" | "write";

/** Причина у погашенного действия. Те же слова, что в «Финансах дня». */
export const VIEW_ONLY_REASON = "Только просмотр";

type AccountLike = Pick<Account, "id" | "scope" | "brigade_id">;
type DebtLike = Pick<Debt, "id" | "team_id">;
type FinanceBlock = "finance.operations" | "finance.accounts" | "finance.debts";

export interface FinancePageAccessInput {
  /** `undefined` — роль ещё не пришла; `null` — человека в компании нет. */
  role: UserRole | null | undefined;
  /** `undefined` — карта прав ещё не пришла. */
  map: MemberAccessMap | undefined;
  /** Выбранный чип: календарь, `NO_TEAM` или null (у компании нет команд). */
  scope: string | null;
  /** Выключенные функции компании (STORY-088): долги, счета, документы.
   *  Выключенное пропадает у всех, у владельца тоже. */
  disabledFeatures?: readonly string[];
}

export interface FinancePageAccess {
  /** Роль и карта на месте. Пока `false` — ни одной живой кнопки. */
  ready: boolean;
  owner: boolean;
  /** Что вообще есть в компании (функции компании). Выключенного нет ни
   *  плиткой, ни кнопкой — в отличие от закрытого правом, которое серое. */
  has: { accounts: boolean; debts: boolean; documents: boolean };
  /** Уровни ВЫБРАННОГО чипа. */
  ops: Level;
  accounts: Level;
  debts: Level;
  /** Пока владельческие: срез 1 их не открывает. */
  documents: boolean;
  settings: boolean;
  refunds: boolean;
  /** «Без команды» — общие счета компании; сотруднику их не показываем. */
  noTeamChip: boolean;
  /** Деньги из записей (материалы, долги записей): у сотрудника записи
   *  приходят с нулями, и такие итоги были бы выдумкой. */
  recordMoney: boolean;
  search: boolean;
  periodLocked: boolean;
  /** Закрытая панель уводит на общий вид, а не показывает пустоту. */
  view: (view: HomeView) => HomeView;
  footer: (view: HomeView) => { enabled: boolean; reason: string | null };
  balanceVisible: (account: AccountLike) => boolean;
  accountWritable: (account: AccountLike, block: FinanceBlock) => boolean;
  txEditable: (
    tx: FinanceTransaction,
    ref?: { account?: AccountLike | null; debt?: DebtLike | null },
  ) => boolean;
  transferCancelable: (
    from?: AccountLike | null,
    to?: AccountLike | null,
  ) => boolean;
  debtEditable: (debt: DebtLike) => boolean;
  debtPayable: (debt: DebtLike) => boolean;
}

const toLevel = (gate: AccessGate): Level =>
  gate === "write" ? "write" : gate === "read" ? "read" : "locked";

/** Календарь счёта. Общий счёт компании календаря не имеет: сотруднику он
 *  закрыт и на запись, и на показ остатка. */
const accountCalendar = (account: AccountLike): string | null =>
  account.scope === "team" ? account.brigade_id : null;

export function financePageAccess(input: FinancePageAccessInput): FinancePageAccess {
  const { role, map, scope } = input;
  const has = {
    accounts: isFeatureOn(input.disabledFeatures, "accounts"),
    debts: isFeatureOn(input.disabledFeatures, "debts"),
    documents: isFeatureOn(input.disabledFeatures, "documents"),
  };
  const owner = role === "owner" || map?.isOwner === true;
  const ready = owner || (role !== undefined && role !== null && !!map);

  /** Уровень блока в КОНКРЕТНОМ календаре. `NO_TEAM` и пустой чип календарём
   *  не являются: `accessGate` без календаря берёт лучший по всем, и человек
   *  с правом в одной команде получил бы кнопку в другой. */
  const levelIn = (blockKey: FinanceBlock, teamId: string | null | undefined): Level => {
    if (owner) return "write";
    if (!ready) return "locked";
    if (!teamId || teamId === NO_TEAM) return "locked";
    return toLevel(accessGate({ role, map, blockKey, scope: "calendar", teamId }));
  };

  const ops = levelIn("finance.operations", scope);
  const accounts = levelIn("finance.accounts", scope);
  const debts = levelIn("finance.debts", scope);

  const accountWritable = (account: AccountLike, block: FinanceBlock): boolean =>
    owner || levelIn(block, accountCalendar(account)) === "write";

  const balanceVisible = (account: AccountLike): boolean =>
    owner || levelIn("finance.accounts", accountCalendar(account)) !== "locked";

  const debtEditable = (debt: DebtLike): boolean =>
    owner || levelIn("finance.debts", debt.team_id) === "write";

  const txEditable: FinancePageAccess["txEditable"] = (tx, ref) => {
    if (!canEditTransaction(tx)) return false;
    if (owner) return true;
    if (!ready) return false;
    // Сотруднику сервер отдаёт на правку только расход без инвойса и возврата.
    if (tx.type !== "expense") return false;
    if (tx.invoice_id || tx.refund_of_id) return false;
    if (levelIn("finance.operations", tx.team_id) !== "write") return false;
    if (tx.account_id) {
      const account = ref?.account ?? null;
      // Счёт неизвестен экрану — значит он и не виден: решаем «нельзя».
      if (!account || account.id !== tx.account_id) return false;
      if (!accountWritable(account, "finance.operations")) return false;
    }
    if (tx.debt_id) {
      const debt = ref?.debt ?? null;
      if (!debt || debt.id !== tx.debt_id) return false;
      if (levelIn("finance.debts", debt.team_id) !== "write") return false;
    }
    return true;
  };

  const footerLevel = (view: HomeView): Level =>
    // Документы выставляет владелец: пустой список — не повод предлагать
    // «выставить счёт» тому, кто его не выставит (сервер откажет).
    view === "documents"
      ? owner
        ? "write"
        : "read"
      : view === "debt"
        ? debts
        : view === "accounts"
          ? accounts
          : ops;

  return {
    ready,
    owner,
    has,
    ops,
    accounts,
    debts,
    documents: owner && has.documents,
    settings: owner,
    refunds: owner,
    noTeamChip: owner,
    recordMoney: owner,
    search: ops !== "locked",
    periodLocked: ops === "locked" && accounts === "locked" && debts === "locked",
    view: (view) => {
      // Выключенная функция — её вида нет вовсе.
      if (view === "accounts" && !has.accounts) return "all";
      if (view === "debt" && !has.debts) return "all";
      if (view === "documents" && !has.documents) return "all";
      if (view === "accounts" && accounts === "locked") return "all";
      // ПЛАШКА «ДОКУМЕНТЫ» ОСТАЁТСЯ И БЕЗ ДОСТУПА (владелец 20.09: «если нет
      // доступа к документам, тогда всё равно остаётся плашка „Документы“, и
      // там просто не показываются документы»). Раньше тап по ней уводил на
      // общий вид — плитка выглядела сломанной. Список документов сотруднику
      // и так не приходит: инвойсы закрыты правилами базы.
      if (view === "debt" && debts === "locked") return "all";
      if ((view === "income" || view === "expense" || view === "profit") && ops === "locked") {
        return "all";
      }
      return view;
    },
    footer: (view) => {
      if (!ready) return { enabled: false, reason: null };
      const level = footerLevel(view);
      if (level === "write") return { enabled: true, reason: null };
      // Закрытый блок причины не называет: страница и так серая по нулям.
      return { enabled: false, reason: level === "read" ? VIEW_ONLY_REASON : null };
    },
    balanceVisible,
    accountWritable,
    txEditable,
    transferCancelable: (from, to) => {
      if (owner) return true;
      if (!from || !to) return false;
      return (
        accountWritable(from, "finance.accounts") &&
        accountWritable(to, "finance.accounts")
      );
    },
    debtEditable,
    debtPayable: (debt) =>
      debtEditable(debt) && levelIn("finance.operations", debt.team_id) === "write",
  };
}
