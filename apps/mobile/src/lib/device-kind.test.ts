import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { deviceKindOf } from "./device-kind";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(resolve(here, path), "utf8");

describe("слово этого устройства", () => {
  test("веб — браузер, Android — телефон, iOS — iPhone", () => {
    assert.equal(deviceKindOf("web"), "browser");
    assert.equal(deviceKindOf("android"), "phone");
    assert.equal(deviceKindOf("ios"), "iphone");
  });

  test("экраны берут слово у `device-word`, а не своей веткой платформы", () => {
    for (const file of [
      "../../app/(dashboard)/cabinet/sync.tsx",
      "../features/cabinet/MemberQueueCards.tsx",
      "../features/cabinet/HelpScreen.tsx",
      "../features/cabinet/NotificationsScreen.tsx",
    ]) {
      const source = read(file);
      assert.doesNotMatch(source, /этом iPhone|"iPhone"/, file);
      assert.match(source, /@\/lib\/device-word/, file);
    }
  });
});
