import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { selectImportable, type MappedRow, type RowReason } from "./csv-validate";

// ДУБЛЬ ИЗ БАЗЫ ПРИ ИМПОРТЕ НЕ ИМПОРТИРУЕТСЯ (аудит 03.10): номер у клиента
// уникален, и вариант «Импортировать» гарантированно падал на каждой строке.

const row = (source: number, reasons: RowReason[] = []): MappedRow => ({
  source,
  full_name: `Клиент ${source}`,
  phone: "+35799000000",
  rawPhone: "99 000 000",
  email: "",
  city: "",
  address: "",
  comment: "",
  reasons,
});

describe("что уходит в импорт", () => {
  test("дубль из базы пропускается всегда", () => {
    const { keep, drop } = selectImportable([row(2), row(3, ["дубликат в базе"])]);
    assert.deepEqual(keep.map((r) => r.source), [2]);
    assert.deepEqual(drop.map((r) => r.source), [3]);
  });

  test("в предпросмотре нет выбора «Импортировать» дубли", () => {
    const sheet = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "ImportWizardSheet.tsx"),
      "utf8",
    );
    assert.doesNotMatch(sheet, /import_as_dup/);
    assert.match(sheet, /Клиенты с номерами, которые уже есть в базе, пропускаются\./);
  });
});
