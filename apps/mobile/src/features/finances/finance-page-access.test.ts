import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Account } from "@babun/shared/local/finance/account";
import type { Debt } from "@babun/shared/local/finance/debt";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { MemberAccessMap } from "@/features/access/access-map";
import { NO_TEAM } from "./accounts-sections";
import { financePageAccess, VIEW_ONLY_REASON } from "./finance-page-access";

// «ФИНАНСЫ» ПО УРОВНЮ. Здесь ловится главное: живая кнопка там, где сервер
// откажет, и погашенная там, где сервер бы пропустил. Оба случая — ложь экрана.

const A = "team-a";
const B = "team-b";

const map = (over: Partial<MemberAccessMap> = {}): MemberAccessMap => ({
  tenantId: "tenant-1",
  isOwner: false,
  version: 7,
  company: {},
  calendars: {},
  attachedCalendars: [A],
  ...over,
});

const employeeMap = (levels: Record<string, Record<string, "off" | "read" | "write">>) =>
  map({ calendars: levels });

// Правило смотрит на счёт и долг по нескольким полям — заглушки несут ровно их.
const teamAccount = (
  id: string,
  brigadeId: string,
): Pick<Account, "id" | "scope" | "brigade_id"> => ({
  id,
  scope: "team",
  brigade_id: brigadeId,
});

const companyAccount = (id: string): Pick<Account, "id" | "scope" | "brigade_id"> => ({
  id,
  scope: "company",
  brigade_id: null,
});

const debt = (id: string, teamId: string | null): Pick<Debt, "id" | "team_id"> => ({
  id,
  team_id: teamId,
});

const tx = (patch: Partial<FinanceTransaction>): FinanceTransaction =>
  ({
    id: "tx-1",
    type: "expense",
    source: "manual",
    team_id: A,
    account_id: null,
    debt_id: null,
    invoice_id: null,
    refund_of_id: null,
    appointment_id: null,
    notes: null,
    amount: 10,
    ...patch,
  }) as unknown as FinanceTransaction;

describe("уровни выбранной команды", () => {
  test("владелец: всё «Меняет» при любом чипе и без карты прав", () => {
    for (const scope of [A, NO_TEAM, null]) {
      const access = financePageAccess({ role: "owner", map: undefined, scope });
      assert.equal(access.ready, true, String(scope));
      assert.equal(access.ops, "write");
      assert.equal(access.accounts, "write");
      assert.equal(access.debts, "write");
      assert.equal(access.documents, true);
      assert.equal(access.settings, true);
      assert.equal(access.refunds, true);
      assert.equal(access.noTeamChip, true);
      assert.equal(access.recordMoney, true);
      assert.deepEqual(access.footer("all"), { enabled: true, reason: null });
      assert.equal(access.view("documents"), "documents");
    }
  });

  test("роль ещё не пришла — ни одной живой кнопки", () => {
    const access = financePageAccess({ role: undefined, map: undefined, scope: A });
    assert.equal(access.ready, false);
    assert.equal(access.ops, "locked");
    assert.deepEqual(access.footer("all"), { enabled: false, reason: null });
    assert.equal(access.search, false);
  });

  test("человека в компании нет — закрыто", () => {
    const access = financePageAccess({ role: null, map: undefined, scope: A });
    assert.equal(access.ready, false);
    assert.equal(access.debts, "locked");
    assert.deepEqual(access.footer("debt"), { enabled: false, reason: null });
  });

  test("сотрудник без карты прав — закрыто", () => {
    const access = financePageAccess({ role: "master", map: undefined, scope: A });
    assert.equal(access.ready, false);
    assert.equal(access.ops, "locked");
    assert.equal(access.accounts, "locked");
  });

  test("сотрудник: «Смотрит» по операциям, «Меняет» по долгам, счета скрыты", () => {
    const access = financePageAccess({
      role: "master",
      map: employeeMap({
        [A]: { "finance.operations": "read", "finance.accounts": "off", "finance.debts": "write" },
      }),
      scope: A,
    });
    assert.equal(access.ops, "read");
    assert.equal(access.accounts, "locked");
    assert.equal(access.debts, "write");
    assert.equal(access.search, true);
    assert.deepEqual(access.footer("all"), { enabled: false, reason: VIEW_ONLY_REASON });
    assert.deepEqual(access.footer("debt"), { enabled: true, reason: null });
    assert.deepEqual(access.footer("accounts"), { enabled: false, reason: null });
    assert.equal(access.view("accounts"), "all");
    // ПЛАШКА «ДОКУМЕНТЫ» ОТКРЫВАЕТСЯ (владелец 20.09: «всё равно остаётся
    // плашка „Документы“, и там просто не показываются документы»): вид
    // включается, список приходит пустым, а футер остаётся владельческим.
    assert.equal(access.view("documents"), "documents");
    assert.deepEqual(access.footer("documents"), { enabled: false, reason: VIEW_ONLY_REASON });
    assert.equal(access.view("debt"), "debt");
    assert.equal(access.documents, false);
    assert.equal(access.settings, false);
    assert.equal(access.refunds, false);
    assert.equal(access.noTeamChip, false);
    assert.equal(access.recordMoney, false);
    assert.equal(access.periodLocked, false);
  });

  test("чип, которого нет в карте прав, — закрыт целиком", () => {
    const access = financePageAccess({
      role: "master",
      map: employeeMap({ [A]: { "finance.operations": "write" } }),
      scope: B,
    });
    assert.equal(access.ops, "locked");
    assert.equal(access.accounts, "locked");
    assert.equal(access.debts, "locked");
    assert.equal(access.periodLocked, true);
    assert.equal(access.search, false);
  });

  test("«Без команды» и пустой чип сотруднику закрыты, даже когда в команде «Меняет»", () => {
    for (const scope of [NO_TEAM, null]) {
      const access = financePageAccess({
        role: "master",
        map: employeeMap({ [A]: { "finance.operations": "write", "finance.accounts": "write" } }),
        scope,
      });
      assert.equal(access.ops, "locked", String(scope));
      assert.equal(access.accounts, "locked", String(scope));
      assert.deepEqual(access.footer("all"), { enabled: false, reason: null });
    }
  });

  test("документы и настройки не открывает даже уровень в карте", () => {
    const access = financePageAccess({
      role: "master",
      map: map({
        company: { "finance.categories": "write", "finance.templates": "write", "finance.vat": "write" },
        calendars: { [A]: { "finance.operations": "write", "finance.documents": "write" } },
      }),
      scope: A,
    });
    assert.equal(access.documents, false);
    assert.equal(access.settings, false);
    assert.equal(access.refunds, false);
    // Уровень в карте документы всё равно не открывает — но и плашку больше
    // не прячет: вид включается, а список сотруднику не приходит.
    assert.equal(access.view("documents"), "documents");
    assert.deepEqual(access.footer("documents"), { enabled: false, reason: VIEW_ONLY_REASON });
  });
});

describe("строка журнала — по своему календарю", () => {
  const access = financePageAccess({
    role: "master",
    map: employeeMap({
      [A]: { "finance.operations": "write", "finance.accounts": "write", "finance.debts": "read" },
      [B]: { "finance.operations": "read" },
    }),
    scope: A,
  });

  test("свой расход на счёте своей команды — правится", () => {
    const account = teamAccount("acc-a", A);
    assert.equal(access.txEditable(tx({ account_id: account.id }), { account }), true);
    assert.equal(access.txEditable(tx({})), true);
  });

  test("доход, инвойс, возврат и авто-строка — не правятся", () => {
    assert.equal(access.txEditable(tx({ type: "income" })), false);
    assert.equal(access.txEditable(tx({ invoice_id: "inv-1" })), false);
    assert.equal(access.txEditable(tx({ refund_of_id: "tx-0" })), false);
    assert.equal(access.txEditable(tx({ source: "auto" })), false);
  });

  test("чужой календарь строки и «Смотрит» в нём — не правится", () => {
    assert.equal(access.txEditable(tx({ team_id: B })), false);
    assert.equal(access.txEditable(tx({ team_id: null })), false);
  });

  test("общий счёт компании и неизвестный счёт — не правится", () => {
    const shared = companyAccount("acc-company");
    assert.equal(access.txEditable(tx({ account_id: shared.id }), { account: shared }), false);
    assert.equal(access.txEditable(tx({ account_id: "acc-a" })), false);
    const other = teamAccount("acc-b", B);
    assert.equal(access.txEditable(tx({ account_id: other.id }), { account: other }), false);
  });

  test("долг, который можно только смотреть, закрывает правку строки", () => {
    const d = debt("debt-1", A);
    assert.equal(access.txEditable(tx({ debt_id: d.id }), { debt: d }), false);
  });

  test("владелец правит по прежнему правилу, авто-строку — нет", () => {
    const owner = financePageAccess({ role: "owner", map: undefined, scope: A });
    assert.equal(owner.txEditable(tx({ type: "income", team_id: B })), true);
    assert.equal(owner.txEditable(tx({ source: "auto" })), false);
  });
});

describe("счета, переводы и долги", () => {
  const access = financePageAccess({
    role: "master",
    map: employeeMap({
      [A]: { "finance.accounts": "write", "finance.operations": "write", "finance.debts": "write" },
      [B]: { "finance.accounts": "read", "finance.operations": "read", "finance.debts": "read" },
    }),
    scope: A,
  });

  test("остаток виден по счёту команды со «Смотрит», общий — нет", () => {
    assert.equal(access.balanceVisible(teamAccount("acc-a", A)), true);
    assert.equal(access.balanceVisible(teamAccount("acc-b", B)), true);
    assert.equal(access.balanceVisible(companyAccount("acc-company")), false);
  });

  test("остаток счёта команды без уровня «Счетов» не виден", () => {
    const opsOnly = financePageAccess({
      role: "master",
      map: employeeMap({ [A]: { "finance.operations": "read" } }),
      scope: A,
    });
    assert.equal(opsOnly.balanceVisible(teamAccount("acc-a", A)), false);
  });

  test("перевод отменяется только между своими записываемыми счетами", () => {
    assert.equal(
      access.transferCancelable(teamAccount("acc-a", A), teamAccount("acc-a2", A)),
      true,
    );
    assert.equal(access.transferCancelable(teamAccount("acc-a", A), teamAccount("acc-b", B)), false);
    assert.equal(access.transferCancelable(teamAccount("acc-a", A), null), false);
    assert.equal(
      access.transferCancelable(teamAccount("acc-a", A), companyAccount("acc-company")),
      false,
    );
  });

  test("долг правится и гасится по своему календарю", () => {
    assert.equal(access.debtEditable(debt("d-1", A)), true);
    assert.equal(access.debtPayable(debt("d-1", A)), true);
    assert.equal(access.debtEditable(debt("d-2", B)), false);
    assert.equal(access.debtPayable(debt("d-2", B)), false);
    assert.equal(access.debtEditable(debt("d-3", null)), false);
  });

  test("оплата долга требует и «Доходы и расходы» «Меняет»", () => {
    const debtsOnly = financePageAccess({
      role: "master",
      map: employeeMap({ [A]: { "finance.debts": "write", "finance.operations": "read" } }),
      scope: A,
    });
    assert.equal(debtsOnly.debtEditable(debt("d-1", A)), true);
    assert.equal(debtsOnly.debtPayable(debt("d-1", A)), false);
  });
});
