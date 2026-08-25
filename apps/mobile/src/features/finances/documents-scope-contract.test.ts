import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ПЛИТКА И СПИСОК ПОД НЕЙ РЕЖУТ ПО ОДНОМУ ПРАВИЛУ. Арифметика плитки живёт в
// JSX-странице и другим способом не проверяется, а расхождение здесь стоит
// дороже всего: инвойс без команды выпадал из счётчика «Документы», его
// работа уже была вычеркнута из «Долгов» как выставленная, и дебиторка
// исчезала с экрана целиком.
const financesScreen = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../app/(dashboard)/finances/index.tsx",
  ),
  "utf8",
);

describe("срез команды у плитки «Документы»", () => {
  test("плитка зовёт общее правило invoiceInTeamScope", () => {
    assert.ok(financesScreen.includes("invoiceInTeamScope(invoice, scope)"));
  });

  test("строгое сравнение, прятавшее бумагу без команды, не вернулось", () => {
    assert.doesNotMatch(financesScreen, /invoice\.brigade_id\s*!==\s*scope/);
  });
});
