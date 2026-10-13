import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { invoiceEditorSource } from "./invoice-editor/editor-source";

// ПРЕВЬЮ И ВЫПУСК — ОДНИ РЕКВИЗИТЫ (аудит 03.10). Пустой `company_id` сервер
// (`issue_invoice`) разрешает юрлицом КОМАНДЫ, а превью и номер — основным
// юрлицом; после смены основного документ уходил от другого юрлица другой
// серией.

// The form is `InvoiceEditor.tsx` plus its `invoice-editor/` folder.
const editor = () => invoiceEditorSource();

describe("реквизиты инвойса", () => {
  test("на сервер уходят те, что напечатаны в превью", () => {
    assert.match(editor(), /company_id: owner \? \(companyId \?\? pickedCompany\?\.id \?\? null\) : null,/);
  });

  test("номер превью — из серии тех же реквизитов; партнёру не спрашивается", () => {
    assert.match(
      editor(),
      // У выставленного счёта (правка, 04.10) номер свой — серию не спрашивают.
      /useNextInvoiceSeries\(\s*issuedYear,\s*owner \? \(pickedCompany\?\.id \?\? companyId\) : null,\s*owner && !existing,\s*\)/,
    );
  });
});

describe("дата нового инвойса (аудит 03.10)", () => {
  test("не раньше сегодня: прошлый визит не рождает документ просроченным", () => {
    const src = editor();
    assert.match(src, /const firstIssuedOn = sourceIssuedOn > businessToday \? sourceIssuedOn : businessToday;/);
    // Новый счёт — срок от даты выставления; выставленный (правка) — свой.
    assert.match(src, /existing\s*\? existing\.due_on\s*: addDaysYmd\(firstIssuedOn, Math\.max\(0, generator\.dueDays\)\),/);
    assert.match(src, /useState\(existing\?\.issued_on \?\? firstIssuedOn\)/);
  });
});
