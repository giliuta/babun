import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readModuleSource } from "@/lib/module-source";

// КРЕДИТ-НОТА — ФОРМА → ПРЕВЬЮ → «ВЫПИСАТЬ» (владелец 2026-10-04: «сначала
// превью… закрепляется чётко за инвойсом»). Страница инвойса не выпускает
// ноту сама: «Отменить инвойс» открывает форму, выпуск — только из её листа.

const app = resolve(dirname(fileURLToPath(import.meta.url)), "../../../app/invoices");
const read = (name: string) => readFileSync(resolve(app, name), "utf8");

describe("кредит-нота", () => {
  test("«Кредит-нота» в меню ведёт в форму, а не выпускает ноту", () => {
    // Меню одно на «⋯» страницы и долгое нажатие в «Документах».
    const menu = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../finances/invoice-menu.ts"), "utf8");
    assert.match(menu, /router\.push\(`\/invoices\/credit-note\?invoiceId=\$\{invoice\.id\}`/);
    assert.doesNotMatch(menu, /useCancelInvoice/);
    // The page is the thin route plus `src/features/invoices/detail/`.
    assert.doesNotMatch(
      readModuleSource(resolve(app, "[id].tsx"), resolve(app, "../../src/features/invoices/detail")),
      /useCancelInvoice/,
    );
  });

  test("выпуск — из листа превью формы", () => {
    const form = read("credit-note.tsx");
    assert.match(form, /<InvoicePreviewSheet[\s\S]*onIssue=\{\(\) => void issue\(\)\}/);
    assert.match(form, /cancel\.mutateAsync\(/);
  });
});
