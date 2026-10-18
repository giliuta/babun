import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { invoiceEditorSource } from "./invoice-editor/editor-source";

// ПРЕВЬЮ И ВЫПУСК — ОДНИ РЕКВИЗИТЫ. Пустой `company_id` сервер
// (`issue_invoice`) разрешает юрлицом КОМАНДЫ, а превью и номер — основным
// юрлицом; после смены основного документ уходил от другого юрлица другой
// серией.

// The form is `InvoiceEditor.tsx` plus its `invoice-editor/` folder.
const editor = () => invoiceEditorSource();

describe("реквизиты инвойса", () => {
  test("на сервер уходят те, что напечатаны в превью", () => {
    assert.match(editor(), /company_id: owner \? \(pickedCompany\?\.id \?\? null\) : null,/);
  });

  // РЕКВИЗИТЫ СКРЫЛИ ПОСРЕДИ ЧЕРНОВИКА: выбранный id остаётся в состоянии
  // формы, превью уже печатает основные (`pickedCompany` берёт только живые),
  // и выпуск обязан уйти от тех же основных, а не от скрытых.
  test("скрытые посреди черновика реквизиты не уходят на сервер", () => {
    assert.doesNotMatch(editor(), /company_id: owner \? \(companyId/);
  });

  test("номер превью — из серии тех же реквизитов; партнёру не спрашивается", () => {
    assert.match(
      editor(),
      // У выставленного счёта (правка) номер свой — серию не спрашивают.
      /useNextInvoiceSeries\(\s*issuedYear,\s*owner \? \(pickedCompany\?\.id \?\? companyId\) : null,\s*owner && !existing,\s*\)/,
    );
  });
});

describe("дата нового инвойса (аудит 03.10)", () => {
  test("сегодня: прошлый визит не рождает документ просроченным, будущий — отказом сервера", () => {
    const src = editor();
    // Новый счёт — срок от даты выставления; выставленный (правка) — свой.
    assert.match(src, /existing\s*\? existing\.due_on\s*: addDaysYmd\(businessToday, Math\.max\(0, generator\.dueDays\)\),/);
    assert.match(src, /useState\(existing\?\.issued_on \?\? businessToday\)/);
  });
});
