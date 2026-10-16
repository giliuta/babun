import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// Логику «тот же id — только для того же черновика» проверяет
// `request-intent.test.ts`; здесь — что формы денег ею действительно
// пользуются, а не держат один id на всё открытие листа.

const here = dirname(fileURLToPath(import.meta.url));
const source = (relative: string) =>
  readFileSync(resolve(here, relative), "utf8").replace(/\/\/.*$/gm, "");

describe("id записи денег следует за черновиком", () => {
  test("новая операция: id по ключу черновика, а не один на открытие", () => {
    const code = source("operation-sheet/use-operation-save.ts");
    assert.match(code, /idFor\(\s*draftIntentKey\(/);
    assert.doesNotMatch(code, /request_id:\s*s\.requestId/);
  });

  test("возврат: id по сумме возврата", () => {
    const code = source("TransactionPopup.tsx");
    assert.match(code, /refundIntent\.idFor\(/);
    assert.doesNotMatch(code, /useState\(randomUuid\)/);
  });

  test("перевод: каждое открытие листа — новое намерение", () => {
    const code = source("transfer-sheet/use-transfer-send.ts");
    assert.match(
      code,
      /useEffect\(\(\)\s*=>\s*\{\s*if\s*\(s\.visible\)\s*intent\.done\(\);?\s*\},\s*\[s\.visible,\s*intent\]\)/,
    );
  });
});
