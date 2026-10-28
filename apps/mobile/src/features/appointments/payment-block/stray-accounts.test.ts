import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Account } from "@babun/shared/local/finance/account";
import type { PaymentRow } from "../payment-draft";
import { HIDDEN_ACCOUNT_NAME, noAccountsReason, strayPaymentAccounts } from "./stray-accounts";

const here = dirname(fileURLToPath(import.meta.url));

const account = (over: Partial<Account>): Account =>
  ({
    id: "acc",
    name: "Наличные",
    kind: "cash",
    scope: "team",
    brigade_id: "team-1",
    icon: null,
    color: null,
    position: 0,
    is_active: true,
    deleted_at: null,
    ...over,
  }) as Account;

const row = (accountId: string, amount: number): PaymentRow => ({
  id: `p-${accountId}`,
  kind: "settlement",
  amount,
  accountId,
  paidAt: "",
  cancellable: true,
});

describe("деньги на счёте, ушедшем из оплаты записи", () => {
  test("платёж на скрытый счёт — оплаченная плитка с именем счёта", () => {
    const rows = new Map([["cash", [row("cash", 50)]]]);
    const all = [account({ id: "cash", name: "Наличные", is_hidden: true })];
    const stray = strayPaymentAccounts([], rows, all);
    assert.equal(stray.length, 1);
    assert.equal(stray[0]?.name, "Наличные");
  });

  test("счёт, который принимает оплату, второй плиткой не встаёт", () => {
    const rows = new Map([["cash", [row("cash", 50)]]]);
    assert.deepEqual(strayPaymentAccounts([{ id: "cash" }], rows, []), []);
  });

  test("скрытый счёт партнёру не виден — плитка без имени счёта", () => {
    const rows = new Map([["secret", [row("secret", 20)]]]);
    assert.equal(strayPaymentAccounts([], rows, [])[0]?.name, HIDDEN_ACCOUNT_NAME);
  });
});

describe("пустой блок оплаты называет причину", () => {
  test("нет права — не «нет счёта»", () => {
    assert.equal(noAccountsReason({ canTakeMoney: false, teamId: "team-1", all: [account({})] }), "right");
  });

  test("счета команды есть, но скрыты или не в оплате — не звать заводить второй", () => {
    const all = [account({ is_hidden: true })];
    assert.equal(noAccountsReason({ canTakeMoney: true, teamId: "team-1", all }), "off");
  });

  test("у команды правда нет живого счёта — «нет счёта»", () => {
    const all = [
      account({ brigade_id: "team-2" }),
      account({ id: "old", is_active: false }),
      account({ id: "gone", deleted_at: "2026-10-01T00:00:00Z" }),
    ];
    assert.equal(noAccountsReason({ canTakeMoney: true, teamId: "team-1", all }), "none");
  });

  test("блок рисует плитки ушедших счетов и передаёт причину в пустой блок", () => {
    const block = readFileSync(resolve(here, "../PaymentBlock.tsx"), "utf8");
    assert.match(block, /\[\.\.\.accounts, \.\.\.strayAccounts\]\.map/);
    assert.match(block, /isPaid && \(stray \|\| paidTileIntent\(amountMode\) === "cancel"\)/);
    assert.match(block, /<NoAccountsNotice\s+reason=\{emptyReason\}/);
    const tiles = readFileSync(resolve(here, "../PaymentTiles.tsx"), "utf8");
    assert.match(tiles, /const offerCreate = canCreate && reason === "none";/);
  });
});
