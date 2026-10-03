import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { unsentChangesNote } from "./unsent-changes";

const here = dirname(fileURLToPath(import.meta.url));

describe("выход и неотправленные правки (аудит 03.10)", () => {
  test("пустая очередь — спрашивать не о чем", () => {
    assert.equal(unsentChangesNote(0), null);
  });

  test("число и склонение", () => {
    assert.equal(
      unsentChangesNote(1),
      "1 изменение ждёт отправки — после выхода оно пропадёт с этого телефона.",
    );
    assert.equal(
      unsentChangesNote(3),
      "3 изменения ждут отправки — после выхода они пропадут с этого телефона.",
    );
    assert.equal(
      unsentChangesNote(12),
      "12 изменений ждут отправки — после выхода они пропадут с этого телефона.",
    );
  });

  test("оба выхода спрашивают до стирания", () => {
    const authClear = readFileSync(resolve(here, "auth-clear.ts"), "utf8");
    const local = authClear.slice(
      authClear.indexOf("export async function signOutAndWipe()"),
      authClear.indexOf("export async function signOutScopeAndWipe("),
    );
    assert.ok(
      local.indexOf("unsentChangesNow()") >= 0 &&
        local.indexOf("unsentChangesNow()") < local.indexOf("signOutScopeAndWipe(\"local\")"),
      "«Выйти» читает очередь раньше, чем стирает",
    );
    const account = readFileSync(
      resolve(here, "../../app/(dashboard)/cabinet/account.tsx"),
      "utf8",
    );
    assert.match(account, /await unsentChangesNow\(\)/);
  });
});
