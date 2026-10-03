import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// АУДИТ ФОРМЫ ЗАПИСИ, ИНВОЙСОВ И SMS 03.10 — сторожа на сборку экранов;
// чистые правила (цена лестницы, поля партнёра, части SMS) проверены своими
// тестами рядом с ними.
const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(here, "..", rel), "utf8");
const app = (rel: string) => readFileSync(resolve(here, "../../../app", rel), "utf8");

describe("аудит записи, инвойсов и SMS 03.10", () => {
  test("оплата судит «визит начался» по часам команды записи", () => {
    assert.match(src("appointments/business-now.ts"), /export function useBusinessNow\(teamId\?: string \| null\)/);
    assert.match(src("appointments/PaymentBlock.tsx"), /useBusinessNow\(teamId\)/);
  });

  test("маршрут листа выезда и события — общей шторкой карт", () => {
    for (const file of ["appointments/CrewWorkRecord.tsx", "appointments/CrewAppointmentSheet.tsx"]) {
      const body = src(file);
      assert.doesNotMatch(body, /maps\.apple\.com/, file);
      assert.match(body, /onPress=\{\(\) => route\.open\(null, address\)\}/, file);
      assert.match(body, /\{route\.sheet\}/, file);
    }
  });

  test("повтор SMS — той же командой и на тот же номер", () => {
    const sheet = src("sms/SmsMessageSheet.tsx");
    assert.match(sheet, /teamId: m\.teamId,\s*phone: m\.toPhone\.trim\(\) \|\| null,/);
  });

  test("инвойс: отказ выпуска виден в листе, VAT без номера ловится заранее", () => {
    const editor = src("invoices/InvoiceEditor.tsx");
    assert.match(editor, /error=\{error\}/);
    assert.match(editor, /vatMode !== "off" && rate > 0 && pickedCompany && !pickedCompany\.vat_number\?\.trim\(\)/);
    assert.match(src("invoices/InvoicePreviewSheet.tsx"), /\) : error \? \(/);
    assert.match(src("invoices/InvoiceRequisitesBlock.tsx"), /if \(!editing\) onCompanyChange\(id\);/);
  });

  test("SMS из карточки: «ближайшая запись» — по часам бизнеса", () => {
    const card = app("(dashboard)/clients/[id].tsx");
    assert.match(card, /today: now\.ymd,\s*nowHm: now\.hm,/);
  });
});
