import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// Список чеков читается страницами (аудит финансов 2026-09-30): PostgREST
// отдаёт не больше тысячи строк, и без цикла тысяча первый чек молча
// пропадал из «Документов».

const source = readFileSync(join(__dirname, "receipts-queries.ts"), "utf8").replace(/\s+/g, " ");

describe("чеки — постранично", () => {
  test("цикл по страницам в тысячу строк до неполной страницы", () => {
    assert.match(source, /const RECEIPTS_PAGE = 1000;/);
    assert.match(source, /q\.range\(from, from \+ RECEIPTS_PAGE - 1\)/);
    assert.match(source, /if \(page\.length < RECEIPTS_PAGE\) break;/);
  });

  test("порядок однозначный — id последним ключом", () => {
    assert.match(
      source,
      /\.order\("year", \{ ascending: false \}\) \.order\("seq", \{ ascending: false \}\) \.order\("id", \{ ascending: true \}\)/,
    );
  });
});
