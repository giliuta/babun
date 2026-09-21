import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// СОСТАВ ИНВОЙСА ЖИВЁТ В МОДЕЛИ, А НЕ В ДВУХ ВЁРСТКАХ.
//
// Тот же сторож, что у чека (`documents/receipt-paper-contract.test.ts`), и
// поставлен он по следам аудита бумаги 2026-09-21, который нашёл ровно то, от
// чего этот тест и сторожит: PDF печатал продавца ДВАЖДЫ, пустую позицию —
// строкой с ценой и без названия, пустой список позиций — немой шапкой
// таблицы, а подпись «В назначении платежа укажите …» была зашита по-русски в
// обоих рендерах сразу. Экран и PDF расходились ровно там, где данные
// неполны, то есть именно тогда, когда на бумагу смотрят внимательнее всего.
//
// RN-компонент здесь НЕ рендерится: в дереве нет react-native тест-рендерера,
// поэтому оба рендера сверяются по ИСХОДНОМУ ТЕКСТУ. Комментарии из сравнения
// вычищены — прозаическое упоминание поля рядом с шапкой файла иначе
// подтвердило бы проверку вместо кода.

const here = dirname(fileURLToPath(import.meta.url));
const paperSource = readFileSync(resolve(here, "InvoicePaper.tsx"), "utf8");
const pdfSource = readFileSync(resolve(here, "pdf.ts"), "utf8");
const dictionarySource = readFileSync(resolve(here, "dictionary.ts"), "utf8");

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\/.*$/gm, "");
}

const paperCode = stripComments(paperSource);
// ПОРЯДОК СЧИТАЕТСЯ ПО ТЕЛУ, А НЕ ПО ВСЕМУ ФАЙЛУ: в <head> печатаемого HTML с
// 2026-09-21 живёт <title>Инвойс INV-…</title> — имя файла для браузера, и
// слово оттуда стоит раньше всего остального.
const pdfCode = stripComments(pdfSource).replace(/<head>[\s\S]*?<\/head>/, "");
// ПОРЯДОК — ПО САМОМУ ШАБЛОНУ, А НЕ ПО ФАЙЛУ. Строки позиций собираются в
// переменную ДО разметки, и по всему файлу `doc.lines` встречается раньше
// продавца: это порядок вычислений, а не порядок печати.
const pdfTemplate = pdfCode.slice(pdfCode.indexOf("<!doctype html>"));

/** Позиция первого чтения `doc.<field>` в очищенном коде. */
function firstUse(code: string, field: string): number {
  return code.search(new RegExp(`\\bdoc\\.${field}\\b`));
}

function assertAscending(positions: number[], names: readonly string[]): void {
  positions.forEach((position, i) => assert.ok(position >= 0, `не нашёл «${names[i]}»`));
  for (let i = 1; i < positions.length; i += 1) {
    const previous = positions[i - 1] ?? -1;
    const current = positions[i] ?? -1;
    assert.ok(previous < current, `«${names[i - 1]}» должно печататься раньше «${names[i]}»`);
  }
}

describe("бумага инвойса и PDF печатают одну модель", () => {
  // ПОРЯДОК БЛОКОВ — ОДИН НА ДВА РЕНДЕРА. Сам список короткий нарочно:
  // сторожим скелет документа, а не каждую мелочь, иначе тест станет копией
  // вёрстки и будет краснеть на любой перестановке отступа.
  // Порядок бумаги AirFix #103 (22.09): номер и даты в шапке, затем стороны,
  // позиции, итоги и внизу реквизиты для оплаты.
  const backbone = [
    "issuedShort",
    "seller",
    "client",
    "lines",
    "totals",
    "payTo",
  ] as const;

  test("экран печатает блоки в каноническом порядке", () => {
    assertAscending(backbone.map((f) => firstUse(paperCode, f)), backbone);
  });

  // У PDF ПОРЯДОК НЕ СЧИТАЕМ, И ВОТ ПОЧЕМУ: строки позиций он собирает в
  // переменную ДО разметки, так что «первое упоминание в файле» у него — это
  // порядок вычислений. Сторожим то, что действительно ломалось: ни одно поле
  // модели не должно молча выпасть из печати.
  test("PDF читает все те же поля модели", () => {
    const missing = backbone.filter((f) => firstUse(pdfCode, f) < 0);
    assert.deepEqual(missing, [], `PDF не печатает: ${missing.join(", ")}`);
  });

  test("шапка PDF идёт раньше получателя, а итоги — позже позиций", () => {
    assertAscending(
      [
        firstUse(pdfTemplate, "seller"),
        pdfTemplate.indexOf("dict.recipient"),
        pdfTemplate.indexOf("lineRows"),
        // Итоги, как и строки, собраны в переменную до разметки — ищем её.
        pdfTemplate.indexOf("totalRows"),
        firstUse(pdfTemplate, "payTo"),
      ],
      ["продавец", "получатель", "позиции", "итоги", "реквизиты для оплаты"],
    );
  });

  // ПРОДАВЕЦ — ОДИН РАЗ. В PDF он печатался и в шапке, и карточкой «Продавец»
  // под ней: клиент получал имя, адрес, VAT и телефон компании двумя
  // одинаковыми колонками подряд.
  test("колонка продавца одна в каждом рендере", () => {
    const count = (code: string) => [...code.matchAll(/\bdoc\.dict\.seller\b/g)].length;
    assert.equal(count(pdfCode), 1, "в PDF продавец напечатан не одной колонкой");
    assert.equal(count(paperCode), 1, "на экране продавец напечатан не одной колонкой");
  });

  for (const key of ["untitled", "linesEmpty"] as const) {
    test(`«${key}» есть и на экране, и в PDF`, () => {
      assert.ok(paperCode.includes(`dict.${key}`), `на экране нет dict.${key}`);
      assert.ok(pdfCode.includes(`dict.${key}`), `в PDF нет dict.${key}`);
    });
  }

  // НИ ОДНОГО ЗАШИТОГО РУССКОГО СЛОВА В РЕНДЕРАХ. Всё, что читает клиент,
  // приходит из словаря — иначе английский счёт печатает русскую фразу, а
  // перевод приходится искать в двух местах сразу.
  for (const [name, code] of [
    ["экране", paperCode],
    ["PDF", pdfCode],
  ] as const) {
    test(`на ${name} нет зашитой кириллицы`, () => {
      // ПОДПИСИ ДЛЯ ЭКРАННОГО ЧИТАТЕЛЯ И ПРИГЛАШЕНИЯ РЕДАКТОРА — НЕ БУМАГА.
      // Их читает владелец, и канон продукта держит их по-русски; клиенту
      // они не уходят ни в PDF, ни в сообщение.
      const printed = code
        .split("\n")
        .filter((line) => !/accessibility|aria-|PAPER_INVITE|invite/i.test(line))
        .join("\n");
      const literals = [
        ...printed.matchAll(/"([^"\n]*[А-Яа-яЁё][^"\n]*)"/g),
        ...printed.matchAll(/'([^'\n]*[А-Яа-яЁё][^'\n]*)'/g),
      ].map((m) => m[1] ?? "");
      assert.deepEqual(
        literals,
        [],
        `эти слова не пройдут через словарь: ${literals.join(" | ")}`,
      );
    });
  }

  // СЛОВАРЬ ОДИНАКОВ НА ДВА ЯЗЫКА. Ключ, забытый в английском, печатается
  // `undefined` прямо на бумаге клиента.
  test("русский и английский словари знают одни и те же ключи", () => {
    const blocks = [...dictionarySource.matchAll(/=\s*\{([\s\S]*?)\n\};/g)].map(
      (m) => m[1] ?? "",
    );
    assert.ok(blocks.length >= 2, "не нашёл два словаря — поправь регэксп теста");
    const keysOf = (block: string) =>
      [...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1] ?? "").sort();
    const [ru, en] = [keysOf(blocks[0] ?? ""), keysOf(blocks[1] ?? "")];
    assert.deepEqual(en, ru, "словари разошлись ключами");
  });
});
