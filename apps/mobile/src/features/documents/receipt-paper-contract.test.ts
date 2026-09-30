import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import { buildReceiptPdfHtml } from "./receipt-pdf";

// СОСТАВ ДОКУМЕНТА ЖИВЁТ В МОДЕЛИ, А НЕ В ДВУХ ВЁРСТКАХ.
//
// Владелец 2026-09-20: «давай сделаем, чтобы визуал был точно такой же, как в
// PDF — то есть оно открывает один в один зеркало PDF, который мы
// сгенерировали». `ReceiptPaper.tsx` (экран) и `receipt-pdf.ts` (PDF) — два
// РЕНДЕРА одной модели `ReceiptDocument` (`receipt-document.ts`), тем же
// приёмом, что у инвойса (`invoices/document.ts` + `InvoicePaper.tsx` +
// `invoices/pdf.ts`). Ни у экрана, ни у PDF нет права печатать поле, которого
// нет в модели, или печатать поля модели в другом порядке — иначе «зеркало»
// разойдётся с бумагой, которую реально получает клиент.
//
// RN-компонент здесь НЕ рендерится: в дереве нет `react-native` тест-рендерера
// (см. `docs/coding-patterns.md` — тесты гоняет `bun:test`/`node:test`, а не
// снапшоты компонентов), поэтому оба рендера сверяются по ИСХОДНОМУ ТЕКСТУ —
// тем же приёмом, что `blocks-catalog.test.ts` и `finance-levels-contract.test.ts`
// сверяют код с каталогом/миграцией. Комментарии из сравнения вычищены — иначе
// прозаическое упоминание поля рядом с шапкой файла ломает проверку порядка.

const here = dirname(fileURLToPath(import.meta.url));
const paperSource = readFileSync(resolve(here, "ReceiptPaper.tsx"), "utf8");
const pdfSource = readFileSync(resolve(here, "receipt-pdf.ts"), "utf8");
const documentSource = readFileSync(resolve(here, "receipt-document.ts"), "utf8");

/** Код без `/* … *\/` и `// …` — комментарий не имеет права ни подтвердить,
 *  ни сломать проверку состава. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const paperCode = stripComments(paperSource);
// ПОРЯДОК СЧИТАЕТСЯ ПО ТЕЛУ, А НЕ ПО ВСЕМУ ФАЙЛУ. В <head> печатаемого HTML
// с 2026-09-20 живёт <title>Чек RC-…</title> — имя файла для браузера; оно не
// печатается на бумаге, но слово «Чек» в нём стоит раньше названия компании и
// ломало проверку порядка. Сравниваем то, что видит глаз.
const pdfCode = stripComments(pdfSource).replace(/<head>[\s\S]*?<\/head>/, "");

/** Имена полей `ReceiptDocument`, в порядке объявления интерфейса. */
function documentFields(): string[] {
  const match = documentSource.match(/export interface ReceiptDocument \{([\s\S]*?)\n\}/);
  assert.ok(match, "интерфейс ReceiptDocument не найден — поправь регэксп теста");
  return [...(match?.[1] ?? "").matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1] ?? "");
}

/** Позиция первого чтения `doc.<field>` в очищенном от комментариев коде. */
function firstUse(code: string, field: string): number {
  return code.search(new RegExp(`\\bdoc\\.${field}\\b`));
}

/** Каждая позиция найдена и строго раньше следующей — порядок печати. */
function assertAscending(positions: number[], names: readonly string[]): void {
  positions.forEach((position, i) => assert.ok(position >= 0, `не нашёл «${names[i]}»`));
  for (let i = 1; i < positions.length; i += 1) {
    const previous = positions[i - 1] ?? -1;
    const current = positions[i] ?? -1;
    assert.ok(previous < current, `«${names[i - 1]}» должно печататься раньше «${names[i]}»`);
  }
}

describe("бумага чека и PDF печатают одну модель в одном порядке", () => {
  const fields = documentFields();

  test("модель не разрослась тихо — поля идут в этом порядке", () => {
    assert.deepEqual(fields, [
      "number",
      "voidLabel",
      "seller",
      "issuedOn",
      "lines",
      "linesTotal",
      "discount",
      "amount",
      "vat",
    ]);
  });

  test("каждое поле модели читают оба рендера — PDF и экранная бумага", () => {
    for (const field of fields) {
      assert.ok(firstUse(pdfCode, field) >= 0, `receipt-pdf.ts не печатает doc.${field}`);
      assert.ok(firstUse(paperCode, field) >= 0, `ReceiptPaper.tsx не печатает doc.${field}`);
    }
  });

  test(
    "порядок один и тот же в обоих рендерах: компания → номер → дата → строки → итог работ → скидка → VAT → получено → аннулирован",
    () => {
      const order = [
        "seller",
        "number",
        "issuedOn",
        "lines",
        "linesTotal",
        "discount",
        "vat",
        "amount",
        "voidLabel",
      ];
      for (const code of [pdfCode, paperCode]) {
        assertAscending(
          order.map((field) => firstUse(code, field)),
          order,
        );
      }
    },
  );

  test("«ЧЕК» стоит между компанией и номером — как просил владелец", () => {
    for (const code of [pdfCode, paperCode]) {
      const sellerPos = firstUse(code, "seller");
      const chekPos = code.indexOf("Чек");
      const numberPos = firstUse(code, "number");
      assert.ok(chekPos >= 0, "нет подписи «Чек»");
      assert.ok(sellerPos < chekPos && chekPos < numberPos, "«Чек» должен стоять между компанией и номером");
    }
  });

  test("шапка таблицы — тот же порядок колонок: Услуга · Кол-во · Цена · Сумма", () => {
    const columns = ["Услуга", "Кол-во", "Цена", "Сумма"];
    for (const code of [pdfCode, paperCode]) {
      assertAscending(
        columns.map((label) => code.indexOf(label)),
        columns,
      );
    }
  });

  test("статичные подписи документа — слово в слово одни и те же на бумаге и в PDF", () => {
    const labels = ["Чек", "Дата", "Услуга", "Кол-во", "Цена", "Сумма", "Итого работ", "Получено"];
    for (const label of labels) {
      assert.ok(pdfCode.includes(label), `receipt-pdf.ts потерял подпись «${label}»`);
      assert.ok(paperCode.includes(label), `ReceiptPaper.tsx потерял подпись «${label}»`);
    }
  });

  test("слова-приглашения зеркала не попадают в PDF", () => {
    // Зеркало (`ReceiptPaper` с пропом `edit`) зовёт тапнуть словами
    // «Добавить услугу», «Скидка», «VAT», «Юр. адрес». В бумаге, которую
    // получает клиент, их быть не может ни при каких данных: `receipt-pdf.ts`
    // печатает модель и об этих словах не знает вовсе. Проверяем это как
    // факт, а не как намерение.
    for (const invite of ["Добавить услугу", "Юр. адрес"]) {
      assert.ok(
        !pdfCode.includes(invite),
        `receipt-pdf.ts печатает слово-приглашение «${invite}»`,
      );
    }
    const empty = buildReceiptPdfHtml(
      {
        id: "r",
        tenant_id: "t",
        number: "RC-2026-001",
        year: 2026,
        seq: 1,
        issued_on: "2026-09-20",
        amount: 10,
        currency: "EUR",
        vat_rate: null,
        vat_amount: null,
        client_id: "c",
        appointment_id: null,
        invoice_id: null,
        transaction_id: "tx",
        account_id: null,
        payment_method: null,
        status: "issued",
        seller_snapshot: {},
        client_snapshot: null,
        lines: null,
        created_at: "2026-09-20T00:00:00Z",
      },
      undefined,
    );
    for (const invite of ["Добавить услугу", "Юр. адрес", "Скидка", "VAT"]) {
      assert.ok(
        !empty.includes(invite),
        `пустой чек напечатал слово-приглашение «${invite}»`,
      );
    }
  });

  test("«Аннулирован» не зашито в вёрстку — это значение модели, doc.voidLabel", () => {
    assert.doesNotMatch(pdfCode, /Аннулирован/);
    assert.doesNotMatch(paperCode, /Аннулирован/);
  });

  test("бумага экрана не форматирует деньги сама — только готовые строки doc", () => {
    assert.doesNotMatch(paperCode, /formatInvoiceMoney|\bmoney\(/);
  });

  test("живой документ со всеми полями печатается PDF в заявленном порядке", () => {
    const receipt: Receipt = {
      id: "receipt-1",
      tenant_id: "tenant-1",
      number: "RC-2026-099",
      year: 2026,
      seq: 99,
      issued_on: "2026-09-19",
      amount: 214.2,
      currency: "EUR",
      vat_rate: 19,
      vat_amount: 34.2,
      client_id: "client-1",
      appointment_id: null,
      invoice_id: null,
      transaction_id: "transaction-1",
      account_id: "account-1",
      payment_method: "transfer",
      status: "void",
      seller_snapshot: { name: "AC Service Ltd", address: "Limassol" },
      lines: null,
      client_snapshot: { name: "Клиент", phone: "+357 111111" },
      created_at: "2026-09-19T08:00:00Z",
    };
    // Та же причина, что выше: <title> в <head> не печатается на бумаге, но
    // содержит слово «Чек». Порядок проверяем по телу документа.
    const html = buildReceiptPdfHtml(receipt, {
      lines: [{ name: "Чистка", qty: 1, unit: null, unitPrice: 200, sum: 200 }],
      discountAmount: 20,
    }).replace(/<head>[\s\S]*?<\/head>/, "");
    const order = [
      "AC Service Ltd",
      "Чек",
      "RC-2026-099",
      "19.09.2026",
      "Чистка",
      "Итого работ",
      "Скидка",
      "VAT 19% в сумме",
      "Получено",
      "Аннулирован",
    ];
    assertAscending(
      order.map((needle) => html.indexOf(needle)),
      order,
    );
  });
});
