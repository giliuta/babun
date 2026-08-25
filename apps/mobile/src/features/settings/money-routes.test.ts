import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ГРАНИЦА ПРАВ У ДЕНЕГ СТОИТ НА КАТАЛОГЕ, А НЕ НА КОРНЕВОМ ЭКРАНЕ.
//
// Гейт внутри `finances/index.tsx` закрывал ровно один экран: соседние по
// стеку `/finances/vat` и `/finances/settings` открывались диплинком любой
// ролью — налоговые ставки и денежные настройки компании у бригадира. Ошибку
// не видно глазами: экран с гейтом выглядит защищённым, и следующий файл,
// положенный рядом, наследует дыру молча.
//
// Правило: у каждого денежного каталога маршрутов ЕСТЬ `_layout.tsx` с
// `RoleCapabilityBoundary capability="view-finances"`, и второй копии границы
// внутри каталога нет — иначе завтра снова разъедется, какая из них главная.

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../../app");

const MONEY_ROUTE_DIRS = [
  "(dashboard)/finances",
  "accounts",
  "invoices",
  "documents",
];

function screenFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) screenFiles(full, out);
    else if (full.endsWith(".tsx") && !full.endsWith("_layout.tsx")) out.push(full);
  }
  return out;
}

describe("денежные маршруты закрыты границей прав", () => {
  for (const route of MONEY_ROUTE_DIRS) {
    const dir = join(appRoot, route);

    test(`${route}: граница стоит в _layout.tsx`, () => {
      const layout = readFileSync(join(dir, "_layout.tsx"), "utf8");
      assert.match(
        layout,
        /RoleCapabilityBoundary[\s\S]{0,200}capability="view-finances"/,
        `${route}/_layout.tsx обязан оборачивать стек в `
          + "RoleCapabilityBoundary capability=\"view-finances\": без этого "
          + "любой экран каталога открывается диплинком мимо прав",
      );
    });

    test(`${route}: второй границы внутри каталога нет`, () => {
      for (const file of screenFiles(dir)) {
        const source = readFileSync(file, "utf8");
        assert.ok(
          !source.includes("RoleCapabilityBoundary"),
          `${file.slice(appRoot.length + 1)} держит вторую копию границы прав. `
            + "Она закрывает только себя и создаёт ложное чувство защиты у "
            + "соседних экранов — граница у денег одна, на каталоге.",
        );
      }
    });
  }
});
