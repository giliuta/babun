import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { canManagePartners } from "./invitation-flow";

// Порог приглашений и удаления партнёров — тот же, что у сервера
// (`create_invitation`, `update_invitation`, `invitations_partners_delete`,
// `tenant_members_delete_partners`): владелец ИЛИ «Партнёры: Управляет».
// Проверка «только владелец» на устройстве отказывала директору раньше
// сервера, и разрешённое ему действие кончалось тостом.

const read = (path: string) => readFileSync(join(__dirname, path), "utf8");

describe("partners gate", () => {
  test("owner and director pass, everyone else is refused", () => {
    assert.equal(canManagePartners("owner", false), true);
    assert.equal(canManagePartners("master", true), true);
    assert.equal(canManagePartners("dispatcher", true), true);
    assert.equal(canManagePartners("master", false), false);
    assert.equal(canManagePartners(null, null), false);
    assert.equal(canManagePartners("master", "true"), false);
  });

  test("invitation and member mutations ask the shared gate, not the owner role", () => {
    for (const path of ["./team-access.ts", "../access/master-page/invitation-api.ts"]) {
      const source = read(path);
      assert.doesNotMatch(source, /requireOwner/, path);
      assert.doesNotMatch(source, /data !== "owner"/, path);
      assert.match(source, /requirePartnersManager\(\)/, path);
    }
    const gate = read("./team-access.ts");
    assert.match(gate, /access_company", \{ p_block: "company\.partners", p_min: "write" \}/);
    assert.match(gate, /canManagePartners\(/);
  });
});
