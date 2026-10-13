import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  OFFLINE_REASON,
  amountForNewSource,
  transferDateFloor,
  transferIsDirty,
  transferOpening,
  transferReason,
  transferSourceCaption,
  transferTitle,
} from "./transfer-rules";
import type { TransferAccount } from "../transfer-options";

const acc = (id: string, balance: number, extra: Partial<TransferAccount> = {}): TransferAccount => ({
  id,
  scope: "team",
  brigade_id: "t1",
  name: id,
  kind: "cash",
  position: 0,
  balance,
  is_active: true,
  ...extra,
});

const none = () => null;

describe("transferOpening", () => {
  test("from a source row: form with the whole balance, locked source", () => {
    const accounts = [acc("cash", 640), acc("card", 10)];
    const o = transferOpening({
      accounts,
      presetFromId: "cash",
      presetToId: null,
      presetAmount: null,
      businessToday: "2026-10-13",
      remembered: none,
    });
    assert.equal(o.step, "form");
    assert.equal(o.fromId, "cash");
    // The only other account is the target without asking.
    assert.equal(o.toId, "card");
    assert.equal(o.sourceLocked, true);
    assert.notEqual(o.amount, "");
    assert.deepEqual(o.opened, { from: "cash", to: "card", amount: o.amount, on: "2026-10-13" });
  });

  test("a remembered target wins over the single-account rule", () => {
    const accounts = [acc("cash", 5), acc("card", 0), acc("bank", 0)];
    const o = transferOpening({
      accounts,
      presetFromId: "cash",
      presetToId: null,
      presetAmount: 2,
      businessToday: "2026-10-13",
      remembered: (id) => (id === "cash" ? "bank" : null),
    });
    assert.equal(o.toId, "bank");
  });

  test("a named target finds the fullest donor; the source stays unlocked", () => {
    const accounts = [acc("minus", -20), acc("small", 5), acc("big", 90), acc("empty", 0)];
    const o = transferOpening({
      accounts,
      presetFromId: null,
      presetToId: "minus",
      presetAmount: 20,
      businessToday: "2026-10-13",
      remembered: none,
    });
    assert.equal(o.step, "form");
    assert.equal(o.fromId, "big");
    assert.equal(o.toId, "minus");
    assert.equal(o.sourceLocked, false);
  });

  test("nothing known: the sheet opens on the source question with no amount", () => {
    const o = transferOpening({
      accounts: [acc("a", 10), acc("b", 0)],
      presetFromId: null,
      presetToId: null,
      presetAmount: null,
      businessToday: "2026-10-13",
      remembered: none,
    });
    assert.equal(o.step, "from");
    assert.equal(o.fromId, null);
    assert.equal(o.toId, null);
    assert.equal(o.amount, "");
  });

  test("a non-positive balance does not prefill the amount", () => {
    const o = transferOpening({
      accounts: [acc("a", -5), acc("b", 0)],
      presetFromId: "a",
      presetToId: null,
      presetAmount: null,
      businessToday: "2026-10-13",
      remembered: none,
    });
    assert.equal(o.amount, "");
  });
});

describe("amountForNewSource", () => {
  test("an untouched amount follows the new source", () => {
    assert.notEqual(amountForNewSource(null, null, { balance: 50 }), null);
    assert.notEqual(amountForNewSource(4000, { balance: 40 }, { balance: 50 }), null);
    assert.equal(amountForNewSource(null, null, { balance: 0 }), "");
  });

  test("a typed amount and a cleared source are left alone", () => {
    assert.equal(amountForNewSource(1500, { balance: 40 }, { balance: 50 }), null);
    assert.equal(amountForNewSource(null, null, null), null);
  });
});

describe("transferReason", () => {
  test("offline first, then the missing side, then validation", () => {
    assert.equal(transferReason(false, null, null, 0), OFFLINE_REASON);
    const from = transferReason(true, null, acc("b", 0), 1);
    const to = transferReason(true, acc("a", 10), null, 1);
    assert.ok(from && to && from !== to);
    assert.equal(transferReason(true, acc("a", 10), acc("b", 0), 5), null);
    assert.notEqual(transferReason(true, acc("a", 10), acc("b", 0), 50), null);
  });
});

describe("transferIsDirty", () => {
  const start = { from: "a", to: "b", amount: "10", on: "2026-10-13" };
  const same = { fromId: "a", toId: "b", amount: "10", occurredOn: "2026-10-13", note: "  " };
  test("unchanged sheet closes without asking", () => {
    assert.equal(transferIsDirty(start, same), false);
    assert.equal(transferIsDirty(null, { ...same, amount: "99" }), false);
  });
  test("any field changed asks first", () => {
    for (const patch of [{ fromId: "x" }, { toId: "x" }, { amount: "9" }, { occurredOn: "2026-10-12" }, { note: "n" }]) {
      assert.equal(transferIsDirty(start, { ...same, ...patch }), true, JSON.stringify(patch));
    }
  });
});

describe("transferDateFloor", () => {
  test("the first movement, or the start of last month without history", () => {
    assert.equal(
      transferDateFloor([{ first_tx_on: "2026-05-02" }, { first_tx_on: null }, { first_tx_on: "2026-03-09" }], "2026-10-13"),
      "2026-03-09",
    );
    assert.equal(transferDateFloor([{ first_tx_on: null }], "2026-10-13"), "2026-09-01");
    assert.equal(transferDateFloor([{ first_tx_on: "2026-11-01" }], "2026-01-20"), "2025-12-01");
  });
});

describe("transferTitle and transferSourceCaption", () => {
  test("each step has its own title", () => {
    const titles = new Set((["form", "from", "to", "date"] as const).map(transferTitle));
    assert.equal(titles.size, 4);
  });

  test("cash on hand shows since when; other accounts only the balance", () => {
    assert.equal(transferSourceCaption(null, "2026-10-13", "EUR"), null);
    const card = { kind: "card", balance: 5, last_outflow_on: "2026-10-01", first_tx_on: null };
    const cash = { ...card, kind: "cash" };
    const plain = transferSourceCaption(card, "2026-10-13", "EUR");
    const aged = transferSourceCaption(cash, "2026-10-13", "EUR");
    assert.ok(plain && aged && aged.startsWith(plain) && aged.length > plain.length);
    assert.equal(transferSourceCaption({ ...cash, last_outflow_on: "2026-10-13" }, "2026-10-13", "EUR"), plain);
  });
});
