import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { NO_TEAM } from "../accounts-sections";
import { forClient, ledgerFilterFor, scopedAccountsFor } from "./home-scope";

describe("ledgerFilterFor", () => {
  test("team chip reads its own team", () => {
    assert.deepEqual(ledgerFilterFor("t1", []), { brigadeIds: ["t1"] });
  });

  test("no chip — no team filter at all", () => {
    assert.deepEqual(ledgerFilterFor(null, [{ id: "acc" }]), { brigadeIds: undefined });
  });

  test("«Без команды» with orphans slices by their accounts, not by team", () => {
    assert.deepEqual(ledgerFilterFor(NO_TEAM, [{ id: "o1" }, { id: "o2" }]), {
      accountIds: ["o1", "o2"],
    });
  });

  test("«Без команды» without orphans reads zero rows, not the whole company", () => {
    // An empty `accountIds` would mean "no filter" — the whole company ledger.
    assert.deepEqual(ledgerFilterFor(NO_TEAM, []), { brigadeIds: [NO_TEAM] });
  });
});

describe("forClient", () => {
  const rows = [
    { id: "a", client_id: "c1" },
    { id: "b", client_id: "c2" },
    { id: "c", client_id: null },
  ];

  test("no client — the very same array", () => {
    assert.equal(forClient(rows, undefined), rows);
  });

  test("client — only its rows", () => {
    assert.deepEqual(forClient(rows, "c1").map((r) => r.id), ["a"]);
  });
});

describe("scopedAccountsFor", () => {
  const a1 = { id: "a1", brigade_id: "t1" };
  const a2 = { id: "a2", brigade_id: "t2" };
  const orphan = { id: "o", brigade_id: null };
  const accounts = [a1, a2, orphan];

  test("team chip — exactly that team's accounts", () => {
    assert.deepEqual(scopedAccountsFor(accounts, [orphan], "t1"), [a1]);
  });

  test("«Без команды» — the orphans", () => {
    assert.deepEqual(scopedAccountsFor(accounts, [orphan], NO_TEAM), [orphan]);
  });

  test("no chip — every account", () => {
    assert.equal(scopedAccountsFor(accounts, [orphan], null), accounts);
  });
});
