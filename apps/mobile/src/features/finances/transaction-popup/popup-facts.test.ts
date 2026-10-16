import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Account } from "@babun/shared/local/finance/account";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { popupMetaRows, transferLegsOf } from "./popup-facts";

const tx = (over: Partial<FinanceTransaction> = {}): FinanceTransaction =>
  ({
    id: "t1",
    type: "income",
    amount: 100,
    occurred_on: "2026-10-04",
    master_id: null,
    payment_method: null,
    vat_amount: null,
    vat_rate: null,
    source: "manual",
    ...over,
  }) as unknown as FinanceTransaction;

const acc = (id: string, name: string, brigade: string | null): Account =>
  ({ id, name, brigade_id: brigade }) as unknown as Account;

const base = {
  category: undefined,
  people: undefined,
  transferLegs: null,
  account: undefined,
  team: undefined,
  teams: [],
  isAppointmentLedger: false,
  alreadyRefunded: 0,
  refundRemainingCents: 10000,
};

const labels = (rows: { label: string }[]) => rows.map((r) => r.label);

describe("transferLegsOf", () => {
  const own = acc("a", "Карта", "t1");
  const other = acc("b", "Наличные", "t1");

  test("the minus leg is «from»", () => {
    assert.deepEqual(transferLegsOf({ type: "transfer", amount: -5 }, own, other), { from: own, to: other });
    assert.deepEqual(transferLegsOf({ type: "transfer", amount: 5 }, own, other), { from: other, to: own });
  });

  test("not a transfer or no counterpart — no legs", () => {
    assert.equal(transferLegsOf({ type: "income", amount: 5 }, own, other), null);
    assert.equal(transferLegsOf({ type: "transfer", amount: 5 }, own, undefined), null);
  });
});

describe("popupMetaRows", () => {
  test("date always first; account, team, method in order", () => {
    const rows = popupMetaRows({
      ...base,
      tx: tx({ payment_method: "card" }),
      category: { name: "Работа" },
      account: acc("a", "Карта", null),
      team: { name: "Y&D" },
    });
    assert.deepEqual(labels(rows), ["Дата", "Категория", "Счёт", "Команда", "Способ оплаты"]);
    assert.equal(rows[4].value, "Карта");
  });

  test("payee row for a salary payout", () => {
    const rows = popupMetaRows({
      ...base,
      tx: tx({ master_id: "m1" }),
      people: [{ id: "m1", full_name: "Иван" }],
    });
    assert.deepEqual(rows[1], { label: "Кому", value: "Иван" });
  });

  test("transfer legs replace «Счёт»; owners named only across teams", () => {
    const from = acc("a", "Карта", "t1");
    const to = acc("b", "Наличные", "t2");
    const teams = [
      { id: "t1", name: "A" },
      { id: "t2", name: "B" },
    ];
    const across = popupMetaRows({ ...base, tx: tx({ type: "transfer" }), transferLegs: { from, to }, account: from, teams });
    assert.deepEqual(across.slice(1), [
      { label: "Откуда", value: "Карта · A" },
      { label: "Куда", value: "Наличные · B" },
    ]);
    const same = popupMetaRows({
      ...base,
      tx: tx({ type: "transfer" }),
      transferLegs: { from, to: acc("c", "Сейф", "t1") },
      teams,
    });
    assert.deepEqual(same.slice(1).map((r) => r.value), ["Карта", "Сейф"]);
  });

  test("VAT snapshot, auto source and appointment ledger rows", () => {
    const rows = popupMetaRows({
      ...base,
      tx: tx({ vat_amount: -19, vat_rate: 19, source: "auto" }),
      isAppointmentLedger: true,
    });
    assert.deepEqual(labels(rows), ["Дата", "VAT", "Источник", "Изменение"]);
    assert.match(rows[1].value, /^в т\.ч\. .*19.* \(19%\)$/);
    assert.equal(popupMetaRows({ ...base, tx: tx({ vat_amount: 0 }) }).length, 1);
  });

  test("already refunded: marked «полностью» when nothing remains", () => {
    const partial = popupMetaRows({ ...base, tx: tx(), alreadyRefunded: 40, refundRemainingCents: 6000 });
    assert.equal(partial.at(-1)?.label, "Уже возвращено");
    assert.doesNotMatch(partial.at(-1)?.value ?? "", /полностью/);
    const full = popupMetaRows({ ...base, tx: tx(), alreadyRefunded: 100, refundRemainingCents: 0 });
    assert.match(full.at(-1)?.value ?? "", / · полностью$/);
    assert.equal(popupMetaRows({ ...base, tx: tx(), alreadyRefunded: Infinity }).length, 1);
  });
});
