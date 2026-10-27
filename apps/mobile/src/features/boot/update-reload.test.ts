import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { markSplashLeft, splashOnScreen } from "./splash-state";

// ВТОРОЙ ЗАСТАВКИ НЕТ: обновление по воздуху перезапускает приложение только
// пока на экране первая. `apply-update-on-start` тянет expo-updates и под
// раннером не поднимается — правило проверяется по исходнику.

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

describe("перезапуск обновлением", () => {
  test("заставка помнит, что ушла", () => {
    assert.equal(splashOnScreen(), true);
    markSplashLeft();
    assert.equal(splashOnScreen(), false);
  });

  test("перезапуск — только в срок и только под заставкой", () => {
    const src = read("apply-update-on-start.ts");
    assert.match(src, /return msLeft > 0 && splashVisible;/);
    assert.match(src, /if \(!fetched\?\.isNew \|\| !mayReloadNow\(left\(\), splashOnScreen\(\)\)\) return;/);
    assert.match(read("BootSplash.tsx"), /const leave = \(\) => \{\s*markSplashLeft\(\);/);
  });
});
