import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { storedInvoiceDraftKey } from "./stored-draft";

// НОВЫЙ ИНВОЙС ПЕРЕЖИВАЕТ ВЫГРУЗКУ ПРИЛОЖЕНИЯ (аудит 035, I-05).
const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(resolve(here, file), "utf8");

describe("снимок нового инвойса", () => {
  test("ключ — свой у компании и команды чипа", () => {
    assert.equal(storedInvoiceDraftKey("t1", null), "babun:invoices:new-draft:t1");
    assert.equal(storedInvoiceDraftKey("t1", "team-a"), "babun:invoices:new-draft:t1:team-a");
  });

  test("ключ объявлен среди именных ключей компании", () => {
    assert.match(read("../../../lib/tenant-prefs.ts"), /"babun:invoices:new-draft",/);
  });

  test("только инвойс «с нуля»: из записи, операции и клиента — не хранится", () => {
    const editor = read("../InvoiceEditor.tsx");
    assert.match(editor, /!existing &&\s*!prefill\?\.appointmentId &&\s*!prefill\?\.transactionId &&\s*!prefill\?\.clientId &&\s*!prefill\?\.amount;/);
  });

  test("снимается после выставления, после «уже выставлен» и после «Уйти»", () => {
    const screen = read("../../../../app/invoices/new.tsx");
    assert.equal(screen.match(/clearStoredInvoiceDraft\(tenantId, params\.teamId\);/g)?.length, 3);
  });

  test("подъём — один раз и только в нетронутую форму; до подъёма не пишем", () => {
    const hook = read("stored-draft.ts");
    assert.match(hook, /if \(stored && !latest\.current\.dirty\) latest\.current\.restore\(stored\);/);
    assert.match(hook, /if \(!key \|\| !restored\.current\) return;/);
  });

  test("строки снимка получают новые id, исчезнувшая команда не поднимается", () => {
    const draft = read("use-invoice-draft.ts");
    assert.match(draft, /lines: lines\.map\(\(\{ id: _id, \.\.\.line \}\) => line\)/);
    assert.match(draft, /stored\.lines\.map\(\(line\) =>\s*newLine\(/);
    assert.match(draft, /teams\.some\(\(team\) => team\.id === stored\.teamId\)/);
  });
});
