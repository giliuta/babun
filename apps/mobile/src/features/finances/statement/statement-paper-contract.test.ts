import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ЛИСТ НА ЭКРАНЕ = ФАЙЛ, КОТОРЫЙ УЙДЁТ (владелец 03.10: «сначала создаётся
// превью файла, а потом уже можно только передавать это»). Тот же приём, что
// у чека (`documents/receipt-paper-contract.test.ts`): оба рендера сверяются
// по исходному тексту — каждое поле модели читают оба и в одном порядке.

const here = dirname(fileURLToPath(import.meta.url));
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const paperCode = strip(readFileSync(resolve(here, "StatementPaper.tsx"), "utf8"));
const pdfCode = strip(readFileSync(resolve(here, "statement-pdf.ts"), "utf8")).replace(/<head>[\s\S]*?<\/head>/, "");
const documentSource = readFileSync(resolve(here, "statement-document.ts"), "utf8");

function documentFields(): string[] {
  const match = documentSource.match(/export interface StatementDocument \{([\s\S]*?)\n\}/);
  assert.ok(match, "интерфейс StatementDocument не найден — поправь регэксп теста");
  return [...(match?.[1] ?? "").matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1] ?? "");
}

const firstUse = (code: string, needle: string) => code.search(new RegExp(`\\b${needle}\\b`));

function assertAscending(code: string, needles: readonly string[], file: string): void {
  const positions = needles.map((needle) => firstUse(code, needle));
  positions.forEach((p, i) => assert.ok(p >= 0, `${file}: не нашёл «${needles[i]}»`));
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(
      (positions[i - 1] ?? -1) < (positions[i] ?? -1),
      `${file}: «${needles[i - 1]}» должно печататься раньше «${needles[i]}»`,
    );
  }
}

describe("бумага выписки и PDF печатают одну модель в одном порядке", () => {
  const fields = documentFields();

  test("поля модели — в порядке печати", () => {
    assert.deepEqual(fields, [
      "accountName",
      "teamName",
      "period",
      "opening",
      "days",
      "income",
      "expense",
      "closing",
    ]);
  });

  test("оба рендера читают каждое поле и в том же порядке", () => {
    const order = fields.map((field) => `doc\\.${field}`);
    assertAscending(pdfCode, order, "statement-pdf.ts");
    assertAscending(paperCode, order, "StatementPaper.tsx");
  });

  test("строка операции: заголовок → подпись → сумма → остаток", () => {
    const order = ["row\\.title", "row\\.detail", "row\\.amount", "row\\.balance"];
    assertAscending(pdfCode, order, "statement-pdf.ts");
    assertAscending(paperCode, order, "StatementPaper.tsx");
  });

  test("слова листа одни и те же", () => {
    const words = ["Выписка по счёту", "Период", "Остаток на начало", "Операция", "Сумма", "Остаток", "Поступило", "Списано", "Остаток на конец"];
    for (const [file, code] of [["statement-pdf.ts", pdfCode], ["StatementPaper.tsx", paperCode]] as const) {
      let from = 0;
      for (const word of words) {
        const at = code.indexOf(word, from);
        assert.ok(at >= 0, `${file}: нет «${word}» после предыдущего слова`);
        from = at + word.length;
      }
    }
  });
});
