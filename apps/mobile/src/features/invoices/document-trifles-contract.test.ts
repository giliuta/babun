import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// МЕЛОЧИ ДОКУМЕНТОВ (аудит 035, F-37). По исходнику: модули тянут react-native.
const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(resolve(here, "..", file), "utf8");

describe("год серии — год компании, а не телефона", () => {
  for (const file of ["companies/company-sheet/SeriesBlock.tsx", "cabinet/CabinetRequisitesRow.tsx"]) {
    test(file, () => {
      const source = read(file);
      assert.match(source, /Number\(useBusinessToday\(\)\.slice\(0, 4\)\)/);
      assert.doesNotMatch(source, /new Date\(\)\.getFullYear\(\)/);
    });
  }
});

describe("убранная позиция инвойса", () => {
  const editor = read("invoices/InvoiceEditor.tsx");

  test("снимок для «Вернуть» — из самого обновления, не устаревший из отрисовки", () => {
    assert.match(editor, /setLines\(\(current\) => \{\s*before = current;/);
    assert.doesNotMatch(editor, /const before = lines;/);
  });

  test("пустая своя строка уходит без тоста", () => {
    assert.match(editor, /const empty = !line\.serviceId && !line\.title\.trim\(\) && !\(parseDecimal\(line\.unitPrice\) \?\? 0\);\s*if \(empty\) return;/);
  });
});
