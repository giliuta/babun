import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// СТОРОЖ: у каждой вкладки корень лежит под любым её экраном (владелец
// 2026-09-24: «открываю финансы, нажимаю „назад“ — перекидывает на
// календарь»). Без `initialRouteName` экран, открытый снаружи вкладки,
// ложился в её стек один, и «назад» уводил из вкладки.
const here = dirname(fileURLToPath(import.meta.url));
const dashboard = join(here, "../../app/(dashboard)");

describe("вкладки: корень под любым экраном", () => {
  for (const tab of ["(home)", "clients", "finances", "cabinet", "chats"]) {
    test(tab, () => {
      const layout = readFileSync(join(dashboard, tab, "_layout.tsx"), "utf8");
      assert.match(
        layout,
        /export const unstable_settings = \{ initialRouteName: "index" \}/,
        `${tab}/_layout.tsx: без initialRouteName «назад» из экрана, открытого снаружи, уводит из вкладки`,
      );
    });
  }
});
