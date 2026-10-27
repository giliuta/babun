import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// «Создать клиента» не ждёт перечитки всех списков: обещание из `onSuccess`
// держит `mutateAsync`, и кнопка стояла серой, пока не перечитается всё.
describe("создание клиента не ждёт перечитки списков", () => {
  test("onSuccess не возвращает обещание инвалидации", () => {
    const src = readFileSync(join(__dirname, "mutations-create.ts"), "utf8");
    assert.doesNotMatch(src, /onSuccess:\s*\([^)]*\)\s*=>\s*qc\.invalidateQueries/);
    assert.match(src, /void qc\.invalidateQueries\(\{ queryKey: clientKeys\.all\(\) \}\)/);
  });
});
