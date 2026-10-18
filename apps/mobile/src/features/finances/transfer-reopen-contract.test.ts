import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// Логику «тот же id — только для того же перевода» проверяет
// `transfer-intent.test.ts`; здесь — что лист перевода закрывает намерение при
// каждом открытии: лист смонтирован и между открытиями, и намерение, оставшееся
// от прошлой неудачи, склеило бы новый такой же перевод со старым.

const here = dirname(fileURLToPath(import.meta.url));
const source = (relative: string) =>
  readFileSync(resolve(here, relative), "utf8").replace(/\/\/.*$/gm, "");

describe("id перевода следует за открытием листа", () => {
  test("перевод: каждое открытие листа — новое намерение", () => {
    const code = source("transfer-sheet/use-transfer-send.ts");
    assert.match(
      code,
      /useEffect\(\(\)\s*=>\s*\{\s*if\s*\(s\.visible\)\s*intent\.done\(\);?\s*\},\s*\[s\.visible,\s*intent\]\)/,
    );
  });
});
