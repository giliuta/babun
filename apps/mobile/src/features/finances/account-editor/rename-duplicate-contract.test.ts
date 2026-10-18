import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));

// ПЕРЕИМЕНОВАНИЕ — ТО ЖЕ ПРАВИЛО ДУБЛЯ, ЧТО И СОЗДАНИЕ: одна функция на обе двери.
const read = (file: string) => readFileSync(resolve(here, file), "utf8");

describe("дубль имени счёта проверяют и создание, и правка", () => {
  for (const file of ["CreateAccountSheet.tsx", "EditAccountSheet.tsx"]) {
    test(`${file} зовёт findDuplicateName и называет причину`, () => {
      const code = read(file);
      assert.match(code, /findDuplicateName\(/);
      assert.match(code, /duplicateNameNote\(/);
    });
  }

  test("правка не считает дублем сам редактируемый счёт", () => {
    assert.match(read("EditAccountSheet.tsx"), /other\.id !== saved\.id/);
  });
});
