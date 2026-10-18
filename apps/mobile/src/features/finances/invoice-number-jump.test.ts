import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { jumpMessage, numberWithSeq, skippedNumbers } from "./invoice-number-jump";

// РУЧНОЙ ПЕРЕХОД НОМЕРА ВПЕРЁД ОСТАВЛЯЕТ ДЫРУ — БЕЗ ВОПРОСА ОН НЕ ПИШЕТСЯ.

const here = dirname(fileURLToPath(import.meta.url));
const next = { seq: 5, number: "INV-2026-005" };

describe("skippedNumbers", () => {
  test("вперёд — пропадают номера от следующего до предшествующего выбранному", () => {
    assert.deepEqual(skippedNumbers(next, 104), {
      count: 99,
      first: "INV-2026-005",
      last: "INV-2026-103",
    });
  });

  test("на один вперёд — пропадает один номер", () => {
    assert.deepEqual(skippedNumbers(next, 6), { count: 1, first: "INV-2026-005", last: "INV-2026-005" });
  });

  test("тот же номер, назад или номер ещё неизвестен — перехода нет", () => {
    assert.equal(skippedNumbers(next, 5), null);
    assert.equal(skippedNumbers(next, 2), null);
    assert.equal(skippedNumbers(null, 104), null);
  });
});

describe("numberWithSeq", () => {
  test("сохраняет префикс, год и ширину хвоста", () => {
    assert.equal(numberWithSeq("INV-2026-005", 12), "INV-2026-012");
    assert.equal(numberWithSeq("RC-2026-9", 10), "RC-2026-10");
  });
});

describe("jumpMessage", () => {
  test("называет диапазон и количество, дыру и невозвратность", () => {
    const text = jumpMessage(skippedNumbers(next, 104)!);
    assert.match(text, /99 номеров: INV-2026-005 – INV-2026-103/);
    assert.match(text, /дырой в серии/);
  });

  test("один номер — без диапазона", () => {
    assert.match(jumpMessage(skippedNumbers(next, 6)!), /1 номер: INV-2026-005\)/);
  });
});

describe("строка номера", () => {
  const row = readFileSync(resolve(here, "InvoiceNumberRow.tsx"), "utf8");

  test("запись номера вперёд идёт только через confirmThen", () => {
    assert.match(row, /skippedNumbers\(next, typed\)/);
    assert.match(row, /confirmThen\([\s\S]*?jumpMessage\(skipped\)[\s\S]*?write,\s*\);/);
    // Прямой вызов записи остаётся лишь для номера без пропусков.
    assert.match(row, /if \(!skipped\) \{\s*write\(\);\s*return;\s*\}/);
  });

  test("в комментариях нет прежнего «только пока в серии нет инвойсов»", () => {
    const queries = readFileSync(resolve(here, "invoices-queries.ts"), "utf8");
    assert.doesNotMatch(queries, /только пока в серии|пока в серии года нет ни одного/);
    assert.doesNotMatch(row, /20261004021143/);
  });
});
