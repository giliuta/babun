import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// «ВЕРНУТЬ» ИЗ КОРЗИНЫ — ТОЖЕ ЗАПИСЬ РАСХОДА: вернувшийся
// расход, перешедший лимит категории, должен дать уведомление о бюджете, как
// вставка и правка. Хук тянет react-query — по исходнику.
const here = dirname(fileURLToPath(import.meta.url));
const hooks = readFileSync(resolve(here, "deleted-operations.ts"), "utf8");

test("возврат расхода из корзины пересчитывает бюджет его дня", () => {
  assert.match(
    hooks,
    /if \(restored\?\.transaction\.type === "expense"\) \{\s*checkBudgetsAfterWrite\(qc, tenantId, restored\.transaction\.occurred_on\);/,
  );
});
