import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// БОЛЬШАЯ СУММА НА БУМАГЕ — ОДНОЙ СТРОКОЙ: €36 000,00 в ячейке
// итога переносилась «€36,000.0 / 0» — и на экране, и в PDF.
const here = dirname(fileURLToPath(import.meta.url));

test("итог на экранной бумаге не переносится", () => {
  const paper = readFileSync(resolve(here, "InvoicePaper.tsx"), "utf8");
  assert.match(paper, /numberOfLines=\{1\}\s+adjustsFontSizeToFit/);
});

test("итог в PDF — nowrap и ячейка не уже суммы", () => {
  const pdf = readFileSync(resolve(here, "../../lib/paper/pdf.ts"), "utf8");
  assert.match(pdf, /\.total-value \{ min-width: 124px;[^\n]*white-space: nowrap; \}/);
});
