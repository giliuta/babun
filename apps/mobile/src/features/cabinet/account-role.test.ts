import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { roleInAccount } from "./account-role";

// РОЛЬ В АККАУНТЕ СТРАНИЦЫ (04.10): аккаунт со ссылки (`?tenant=`) на слово не
// берут — роль только из своих членств.
describe("роль в аккаунте страницы Кабинета", () => {
  const memberships = [
    { tenantId: "own", role: "owner" },
    { tenantId: "giliuta", role: "master" },
  ];

  test("своё членство — его роль", () => {
    assert.equal(roleInAccount(memberships, "giliuta"), "master");
    assert.equal(roleInAccount(memberships, "own"), "owner");
  });

  test("чужой аккаунт — никакой роли; членства ещё едут — «не знаю»", () => {
    assert.equal(roleInAccount(memberships, "stranger"), null);
    assert.equal(roleInAccount(undefined, "giliuta"), undefined);
    assert.equal(roleInAccount([{ tenantId: "x", role: "boss" }], "x"), null);
  });
});
