import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ОДНИ ЧЕРНИЛА НА ВСЕ ДОКУМЕНТЫ (пачка 5, Д14). Инвойс и чек печатались
// двумя гаммами; цвет бумаги теперь называет только `palette.ts`.
const src = (path: string) => readFileSync(join(__dirname, "..", "..", "..", path), "utf8");

const RENDERS = [
  "src/features/invoices/InvoicePaper.tsx",
  "src/components/blocks/ReceiptPaperParts.tsx",
  "src/lib/paper/pdf.ts",
  "src/features/documents/receipt-pdf.ts",
];

describe("палитра бумаги", () => {
  test("рендеры документов не называют цвет числом", () => {
    for (const file of RENDERS) {
      assert.doesNotMatch(src(file), /#[0-9a-fA-F]{6}\b/, file);
      assert.match(src(file), /from "@\/lib\/paper\/palette"/, file);
    }
  });
});
