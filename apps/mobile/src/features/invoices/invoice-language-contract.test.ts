import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { UI_LOCALES } from "@babun/shared/i18n/locales";
import type { InvoiceLedgerWithLines } from "@babun/shared/local/finance/invoice-ledger";
import { RECEIPT_WORDS } from "../documents/receipt-words";
import { invoiceDictionary } from "./dictionary";
import { buildInvoiceDocument } from "./document";

// ЯЗЫК БУМАГИ НЕ ОСТАЁТСЯ РУССКИМ МОЛЧА (аудит 03.10). Язык пишется вторым
// запросом после выставления, ошибка глоталась, а переключателя на странице
// документа не было — английское превью уходило клиенту русской бумагой.

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(resolve(here, path), "utf8");

describe("язык бумаги инвойса", () => {
  test("запись языка после выставления — вторая попытка, документ несёт записанный язык", () => {
    const queries = read("queries.ts");
    assert.match(queries, /for \(let attempt = 0; attempt < 2; attempt\+\+\) \{\s*try \{\s*await setInvoiceLanguage\(supabase, invoice\.id, language\);\s*return \{ \.\.\.invoice, language \};/);
  });

  test("не записался — экран выставления говорит об этом", () => {
    assert.match(read("../../../app/invoices/new.tsx"), /if \(value\.language && invoice\.language !== value\.language\) \{\s*notify\(/);
  });

  // Владелец 2026-10-04: «в инвойсе не надо менять язык; если надо — пусть
  // переделывает полностью». Язык — в превью выставления и правки.
  test("у выставленного инвойса язык не переключается — только через «Изменить»", () => {
    const page = read("../../../app/invoices/[id].tsx");
    assert.doesNotMatch(page, /useSetInvoiceLanguage|Бумага на (русском|английском)/);
    assert.match(page, /useInvoiceMenu\(\)/);
    assert.match(read("invoice-menu.ts"), /label: "Изменить инвойс",[^}]*run: edit/);
  });

  // ЯЗЫК ВЫСТАВЛЕННОГО ИНВОЙСА НЕ МЕНЯЮТ (владелец 04.10: «если надо поменять —
  // пусть переделывает полностью»): его выбирают при выставлении и при
  // «Изменить инвойс». Отсюда — только то, что выставление и запись языка
  // принимают любой язык приложения, а не «ru» | «en».
  test("выставление и запись языка принимают любой язык приложения", () => {
    assert.match(read("queries.ts"), /\}: IssueInvoiceDraft & \{ language\?: InvoiceLanguage \}\) => \{/);
    assert.match(read("../../../../../packages/shared/src/db/repositories/invoices.ts"), /language: UiLocale,\n\): Promise<void>/);
  });

  // ВСЕ ЯЗЫКИ ПРИЛОЖЕНИЯ — ЯЗЫКИ БУМАГИ (владелец 2026-10-04). Словарь у
  // каждого свой, и даты с деньгами печатаются локалью того же языка.
  test("у каждого языка приложения есть бумага инвойса и чека на нём", () => {
    for (const { code, intl } of UI_LOCALES) {
      assert.equal(invoiceDictionary(code).locale, intl, code);
      assert.equal(RECEIPT_WORDS[code].locale, intl, code);
    }
    assert.equal(invoiceDictionary("bg").invoice, "ФАКТУРА");
    assert.equal(invoiceDictionary("xx").invoice, invoiceDictionary("ru").invoice);
  });

  // ИТОГ КРЕДИТ-НОТЫ — НЕ «К ОПЛАТЕ» (019, 04.10): платить по ней нечего.
  test("у кредит-ноты итог на любом языке — «Итого», а не «К оплате»", () => {
    const note = {
      id: "cn-1", tenant_id: "t", number: "CN-2026-0001", year: 2026, seq: 1,
      issued_on: "2026-10-04", due_on: null, client_id: null, appointment_id: null,
      brigade_id: null, subtotal_net: -100, vat_percent: 0, vat_amount: 0, total: -100,
      currency: "EUR", language: "ru", vat_mode: "off", status: "issued", pdf_url: null,
      notes: "", created_at: "2026-10-04T08:00:00Z", updated_at: "2026-10-04T08:00:00Z",
      created_by: null, lines: [],
    } as unknown as InvoiceLedgerWithLines;
    const settlement = { income: 0, refunded: 0, paid: 0, remaining: 0, overpaid: 0, isPartial: false, isPaid: false };
    for (const { code } of UI_LOCALES) {
      const dict = invoiceDictionary(code);
      const doc = buildInvoiceDocument({
        invoice: note, settlement, payments: [], language: code,
        creditNote: { originalNumber: "INV-2026-0007" },
      });
      const grand = doc.totals.find((row) => row.grand);
      assert.equal(grand?.label, dict.creditNoteTotal, code);
    }
    assert.notEqual(invoiceDictionary("ru").creditNoteTotal, invoiceDictionary("ru").grandTotal);

    // КРЕДИТ-НОТА К ЧЕКУ (возврат по чеку без инвойса, 019, 04.10): о чеке, не об инвойсе.
    for (const { code } of UI_LOCALES) {
      const dict = invoiceDictionary(code);
      const doc = buildInvoiceDocument({
        invoice: { ...note, notes: "Возврат по чеку RC-2026-017" }, settlement, payments: [], language: code,
        creditNote: { originalNumber: "RC-2026-017", ofReceipt: true },
      });
      assert.equal(doc.reference, dict.creditNoteForReceipt("RC-2026-017"), code);
      assert.equal(doc.lines[0]?.title, dict.creditNoteReceiptLine("RC-2026-017"), code);
      assert.equal(doc.notes, "", code);
    }
    assert.equal(invoiceDictionary("ru").creditNoteForReceipt("RC-1"), "К чеку RC-1");

    // ЧАСТИЧНАЯ КРЕДИТ-НОТА (019, 04.10): инвойс в силе — не «Отмена инвойса».
    for (const { code } of UI_LOCALES) {
      const dict = invoiceDictionary(code);
      const doc = buildInvoiceDocument({
        invoice: { ...note, credit_partial: true, notes: "Частичная отмена инвойса INV-2026-0007" },
        settlement, payments: [], language: code,
        creditNote: { originalNumber: "INV-2026-0007" },
      });
      assert.equal(doc.lines[0]?.title, dict.creditNotePartialLine("INV-2026-0007"), code);
      assert.notEqual(doc.lines[0]?.title, dict.creditNoteLine("INV-2026-0007"), code);
      assert.equal(doc.notes, "", code);
    }
  });

  // КЛИЕНТ НА ЧЕКЕ — «ПЛАТЕЛЬЩИК», А НЕ «ПОЛУЧАТЕЛЬ» ИНВОЙСА (019, 04.10).
  test("на чеке клиент подписан словом чека, а не словом инвойса", () => {
    const doc = read("../documents/receipt-document.ts");
    assert.doesNotMatch(doc, /label: dict\.recipient/);
    assert.equal((doc.match(/label: words\.payer/g) ?? []).length, 2);
    for (const { code } of UI_LOCALES) assert.ok(RECEIPT_WORDS[code].payer.trim(), code);
    assert.equal(RECEIPT_WORDS.ru.payer, "Плательщик");
  });

  test("в форме инвойса язык — строкой «Язык» в «Реквизитах», по умолчанию English", () => {
    const editor = read("InvoiceEditor.tsx");
    // Новый — English, правка выставленного — на его языке, любом из семи.
    assert.match(editor, /useState<InvoiceLanguage>\(\s*isUiLocale\(existingLanguage\) \? existingLanguage : "en",\s*\)/);
    assert.match(read("queries.ts"), /link_to_tx_id"> & \{ language\?: InvoiceLanguage \}\) => \{/);
    assert.match(read("../documents/use-receipt-source.ts"), /isUiLocale\(rowLanguage\) \? rowLanguage : "en"/);
    assert.match(editor, /language=\{\{ value: localeInfo\(language\)\.name, onPress: \(\) => setLanguageOpen\(true\) \}\}/);
    assert.match(editor, /<PaperLanguageSheet\s+visible=\{languageOpen\}\s+value=\{language\}\s+onChange=\{setLanguage\}/);
    assert.match(read("InvoiceBlocks.tsx"), /<InvoiceRequisitesBlock[\s\S]*?language=\{language\}/);
  });

  test("перед выставлением язык — блоком «Язык» и вторым шагом листа", () => {
    const sheet = read("InvoicePreviewSheet.tsx");
    assert.doesNotMatch(sheet, /SegmentedControl/);
    assert.match(sheet, /<SectionCard dense title="Язык">/);
    assert.match(sheet, /<LanguageOptionList\s+selected=\{language\}/);
  });
});
