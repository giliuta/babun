import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ПРЕВЬЮ И ВЫПУСК — ОДНИ РЕКВИЗИТЫ (аудит 03.10). Пустой `company_id` сервер
// (`issue_invoice`) разрешает юрлицом КОМАНДЫ, а превью и номер — основным
// юрлицом; после смены основного документ уходил от другого юрлица другой
// серией.

const editor = () =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "InvoiceEditor.tsx"), "utf8");

describe("реквизиты инвойса", () => {
  test("на сервер уходят те, что напечатаны в превью", () => {
    assert.match(editor(), /company_id: companyId \?\? pickedCompany\?\.id \?\? null,/);
  });

  test("номер превью — из серии тех же реквизитов", () => {
    assert.match(editor(), /useNextInvoiceSeries\(issuedYear, pickedCompany\?\.id \?\? companyId\)/);
  });
});
