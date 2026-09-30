import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { iconChange, kindForIcon } from "./account-kind";

describe("тип счёта по значку", () => {
  test("денежные значки говорят сами за себя", () => {
    assert.equal(kindForIcon("cash", "other"), "cash");
    assert.equal(kindForIcon("handcoins", "card"), "cash");
    assert.equal(kindForIcon("wallet", "bank"), "cash");
    assert.equal(kindForIcon("card", "cash"), "card");
    assert.equal(kindForIcon("bank", "cash"), "bank");
  });

  test("остальные значки, эмодзи старого мастера и пустой выбор тип не трогают", () => {
    assert.equal(kindForIcon("star", "card"), "card");
    assert.equal(kindForIcon("receipts", "cash"), "cash");
    assert.equal(kindForIcon("💵", "bank"), "bank");
    assert.equal(kindForIcon(null, "cash"), "cash");
    assert.equal(kindForIcon(undefined, "other"), "other");
  });
});

describe("смена значка у счёта", () => {
  const fresh = { kind: "cash" as const, has_history: false };
  const used = { kind: "cash" as const, has_history: true };

  test("без операций: не денежный значок меняет только вид", () => {
    assert.deepEqual(iconChange(fresh, "star"), { ok: true, patch: { icon: "star" } });
    assert.deepEqual(iconChange(fresh, null), { ok: true, patch: { icon: null } });
  });

  test("без операций: денежный значок другого типа меняет и тип", () => {
    assert.deepEqual(iconChange(fresh, "card"), {
      ok: true,
      patch: { icon: "card", kind: "card" },
    });
  });

  test("с операциями: значок того же типа и не денежный — только вид", () => {
    assert.deepEqual(iconChange(used, "wallet"), { ok: true, patch: { icon: "wallet" } });
    assert.deepEqual(iconChange(used, "star"), { ok: true, patch: { icon: "star" } });
  });

  test("с операциями: денежный значок другого типа не пишется, а объясняется", () => {
    const card = iconChange(used, "card");
    assert.equal(card.ok, false);
    assert.match(card.ok ? "" : card.message, /наличные/);
    const other = iconChange({ kind: "other", has_history: true }, "cash");
    assert.equal(other.ok, false);
  });
});
