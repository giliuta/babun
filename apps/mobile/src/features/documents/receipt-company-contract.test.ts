import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ЧЕК ПАРТНЁРА — ОТ ЮРЛИЦА КОМАНДЫ, КАК ИНВОЙС: реквизиты не-владельца решает
// сервер (`_issue_receipt_core`), телефон шлёт `null`.
const here = dirname(fileURLToPath(import.meta.url));
const screen = readFileSync(resolve(here, "../../../app/documents/receipt-new.tsx"), "utf8");

test("не-владелец не шлёт юрлицо по умолчанию", () => {
  assert.match(screen, /const sentCompanyId = owner \? companyId : null;/);
  assert.match(screen, /companyId: sentCompanyId,/);
});
