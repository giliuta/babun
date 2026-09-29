import { isFeatureOn } from "@babun/shared/local/company-features";
import type { Account } from "@babun/shared/local/finance/account";
import type { Debt } from "@babun/shared/local/finance/debt";
import {
  canEditTransaction,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import type { MemberAccessMap } from "@/features/access/access-map";
import { accessGate, moneyKey, type AccessGate } from "@/features/access/my-access";
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
// поэтому правка здесь считается ровно теми же условиями, что и в политиках
// `finance_transactions` (миграция 20260929235000, срез 2а).
//
// ДОХОДЫ И РАСХОДЫ — ДВА ПРАВА (владелец 29.09: «только доходы, но видел все
// расходы»). У каждой стороны: Не видит · Видит · Добавляет · Правит всё.
// «Добавляет» правит только свою операцию, «Правит всё» — и чужие. Оплату
// долга ведёт «Долги: Принимает оплату» сама, без сторон денег. Старая карта
// (до наката) несёт одну строку `finance.operations`: по ней доход сотрудник
// не правил вовсе, а любой расход своей команды — правил (`moneyKey`).
//
// Владелец ограничений не имеет и карту прав не ждёт: его страница не мигает.

export type Level = "locked" | "read" | "write";

/** Причина у погашенного действия. Те же слова, что в «Финансах дня». */
export const VIEW_ONLY_REASON = "Только просмотр";

type AccountLike = Pick<Account, "id" | "scope" | "brigade_id">;
type DebtLike = Pick<Debt, "id" | "team_id">;
type Side = "income" | "expense";
type FinanceBlock = string;

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
  /** Кто вошёл: «Добавляет» правит только операции, заведённые им самим. */
  userId?: string | null;
}

export interface FinancePageAccess {
  /** Роль и карта на месте. Пока `false` — ни одной живой кнопки. */
  ready: boolean;
  owner: boolean;
  /** Что вообще есть в компании (функции компании). Выключенного нет ни
   *  плиткой, ни кнопкой — в отличие от закрытого правом, которое серое. */
  has: { accounts: boolean; debts: boolean; documents: boolean };
  /** Уровни ВЫБРАННОГО чипа. `ops` — лучшая из двух сторон денег: по ней
   *  живут поиск, общий вид и «Прибыль». */
  income: Level;
  expense: Level;
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
  /** Новую операцию этой стороны можно завести в выбранном календаре. */
  canAdd: (side: Side) => boolean;
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

  const legacy = !owner && moneyKey(map, "income") === "finance.operations";
  const sideKey = (side: Side): string => moneyKey(map, side);
  const best = (a: Level, b: Level): Level =>
    a === "write" || b === "write" ? "write" : a === "read" || b === "read" ? "read" : "locked";

  const income = levelIn(sideKey("income"), scope);
  const expense = levelIn(sideKey("expense"), scope);
  const ops = best(income, expense);
  const accounts = levelIn("finance.accounts", scope);
  const debts = levelIn("finance.debts", scope);

  /** «Правит всё» — чужие операции стороны. На старой карте так вёл себя
   *  «Меняет» у расхода, а доход сотрудник не правил вовсе. */
  const sideFull = (side: Side, teamId: string | null): boolean => {
    if (owner) return true;
    if (!teamId || teamId === NO_TEAM || !map) return false;
    if (legacy) return side === "expense" && levelIn(sideKey(side), teamId) === "write";
    return map.calendars[teamId]?.[sideKey(side)] === "full";
  };
  const mine = (tx: FinanceTransaction): boolean =>
    !!input.userId && tx.created_by === input.userId;

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
    // Инвойс, возврат и перевод ведут свои двери; сотруднику строки не правятся.
    if (tx.type !== "income" && tx.type !== "expense") return false;
    if (tx.invoice_id || tx.refund_of_id) return false;
    // Оплату записи правит только блок «Оплата» — прямой правки нет.
    if (tx.type === "income" && tx.appointment_id) return false;
    // Счёт неизвестен экрану — значит он и не виден: решаем «нельзя».
    const accountOk = (block: FinanceBlock): boolean => {
      if (!tx.account_id) return true;
      const account = ref?.account ?? null;
      return !!account && account.id === tx.account_id && accountWritable(account, block);
    };
    const debtOk = (): boolean => {
      const debt = ref?.debt ?? null;
      return !!debt && debt.id === tx.debt_id && levelIn("finance.debts", debt.team_id) === "write";
    };

    if (legacy) {
      // До наката: только расход, по «Доходам и расходам», долг — ещё и «Долгами».
      if (tx.type !== "expense") return false;
      if (levelIn("finance.operations", tx.team_id) !== "write") return false;
      if (!accountOk("finance.operations")) return false;
      return !tx.debt_id || debtOk();
    }

    if (tx.debt_id) {
      // Оплата долга — своя, по «Долги: Принимает оплату», без сторон денег.
      return (
        mine(tx) &&
        levelIn("finance.debts", tx.team_id) === "write" &&
        debtOk() &&
        accountOk("finance.debts")
      );
    }
    const side: Side = tx.type;
    if (levelIn(sideKey(side), tx.team_id) !== "write") return false;
    if (!sideFull(side, tx.team_id) && !mine(tx)) return false;
    return accountOk(sideKey(side));
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
          : view === "income"
            ? income
            : view === "expense"
              ? expense
              : ops;

  return {
    ready,
    owner,
    has,
    income,
    expense,
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
    canAdd: (side) => (side === "income" ? income : expense) === "write",
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
      if (view === "income" && income === "locked") return "all";
      if (view === "expense" && expense === "locked") return "all";
      // Прибыль — доход минус расход: без одной из сторон она была бы выдумкой.
      if (view === "profit" && (income === "locked" || expense === "locked")) return "all";
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
    // Оплата долга — «Долги: Принимает оплату» сама; до наката платёж был
    // операцией журнала и требовал ещё «Доходы и расходы».
    debtPayable: (debt) =>
      debtEditable(debt) &&
      (!legacy || levelIn("finance.operations", debt.team_id) === "write"),
  };
}
