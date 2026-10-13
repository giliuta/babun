import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newClientDraftHref } from "./draft-href";
import { residentsLineOf } from "./people-types";

describe("newClientDraftHref", () => {
  test("from the shared address the draft opens on the same address", () => {
    assert.deepEqual(newClientDraftHref("/client", null, { name: "Мария" }), {
      pathname: "/client",
      params: { id: "new", name: "Мария" },
    });
  });

  test("a foreign company carries its tenant", () => {
    assert.deepEqual(
      newClientDraftHref("/clients/c1", { tenantId: "t2", isActive: false }, { linkGroup: "g1" }),
      { pathname: "/clients/[id]", params: { id: "new", tenant: "t2", linkGroup: "g1" } },
    );
  });

  test("the active company opens the tab card without a tenant", () => {
    assert.deepEqual(newClientDraftHref("/clients/c1", { tenantId: "t1", isActive: true }, { split: "x" }), {
      pathname: "/clients/[id]",
      params: { id: "new", split: "x" },
    });
    assert.deepEqual(newClientDraftHref("/clients/c1", null, {}), {
      pathname: "/clients/[id]",
      params: { id: "new" },
    });
  });
});

describe("residentsLineOf", () => {
  test("no residents — no line", () => {
    assert.equal(residentsLineOf([]), undefined);
  });

  test("name and role by «·», people by comma, blanks dropped", () => {
    assert.equal(
      residentsLineOf([
        { name: " Мария Спиру ", role: "жилец" },
        { name: "Андреас", role: " " },
      ]),
      "Мария Спиру · жилец, Андреас",
    );
  });
});
