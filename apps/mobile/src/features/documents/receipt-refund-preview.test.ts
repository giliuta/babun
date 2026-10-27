import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ПРЕВЬЮ ВОЗВРАТА ПО ЧЕКУ ИНВОЙСА = ВЫПУЩЕННАЯ НОТА (аудит 035, F-32). Сервер
// (`refund_receipt` → `_issue_credit_note`) выпускает ноту к инвойсу на весь его
// остаток, с его строками и на его языке; превью рисовало ноту к чеку на сумму
// платежа и на выбранном языке. По исходнику: экран тянет react-native.
const here = dirname(fileURLToPath(import.meta.url));
const screen = readFileSync(resolve(here, "../../../app/documents/receipt-refund.tsx"), "utf8");
const sheet = readFileSync(resolve(here, "../invoices/InvoicePreviewSheet.tsx"), "utf8");

test("нота к инвойсу строится из инвойса: остаток, строки, «Отмена инвойса»", () => {
  assert.match(screen, /useInvoice\(receipt\?\.invoice_id \?\? undefined\)/);
  assert.match(screen, /credit_note_of_id: invoice\.id,/);
  assert.match(screen, /total: -left,/);
  assert.match(screen, /`Отмена инвойса \$\{invoice\.number\}`/);
  assert.match(screen, /creditNote: \{ originalNumber: invoice\.number \}/);
});

test("язык ноты к инвойсу — язык инвойса, выбора в превью нет", () => {
  assert.match(screen, /invoice\?\.language as InvoiceLanguage/);
  assert.match(screen, /onChangeLanguage=\{byInvoice \? undefined : setLanguage\}/);
  assert.match(sheet, /onChangeLanguage\?: \(next: InvoiceLanguage\) => void;/);
  assert.match(sheet, /\{onChangeLanguage \? \(/);
});

test("серия ноты к инвойсу — у юрлица инвойса", () => {
  assert.match(screen, /const noteCompanyId = byInvoice \? invoice\?\.company_id \?\? null : receipt\?\.company_id \?\? null;/);
});
