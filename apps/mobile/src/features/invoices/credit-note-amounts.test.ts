import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  creditNoteAmountForRefund,
  creditNoteLeftToPay,
  creditNoteVat,
} from "./credit-note-amounts";

// «ВЕРНУТЬ» ПЛАТЁЖ ЧАСТИЧНО ОПЛАЧЕННОГО ИНВОЙСА. Сервер
// (`issue_partial_credit_note`) возвращает деньги только сверх нового «к
// оплате»: to_refund = max(0, получено − (к оплате − сумма ноты)). Нота на
// сумму платежа (40 из 100 при оплаченных 40) не возвращала ничего — инвойс
// просто становился меньше, а деньги оставались у компании.

/** Ровно формула сервера. */
const serverRefund = (paid: number, due: number, amount: number) =>
  Math.max(0, Math.round((paid - (due - amount)) * 100) / 100);

describe("сумма ноты для возврата платежа", () => {
  test("частично оплаченный инвойс: возвращается весь платёж", () => {
    const settlement = { due: 100, paid: 40, overpaid: 0 };
    const amount = creditNoteAmountForRefund(40, settlement);
    assert.equal(serverRefund(40, 100, amount), 40);
  });

  test("два платежа, возврат второго — первый остаётся", () => {
    const settlement = { due: 100, paid: 70, overpaid: 0 };
    const amount = creditNoteAmountForRefund(30, settlement);
    assert.equal(amount, 60);
    assert.equal(serverRefund(70, 100, amount), 30);
  });

  test("оплачен целиком — сумма ноты равна платежу", () => {
    const amount = creditNoteAmountForRefund(100, { due: 100, paid: 100, overpaid: 0 });
    assert.equal(amount, 100);
    assert.equal(serverRefund(100, 100, amount), 100);
  });

  test("подсказка «к оплате» вычитает уже полученное", () => {
    // 100 к оплате, получено 40, нота на 20 → осталось заплатить 40.
    assert.equal(creditNoteLeftToPay(100, 40, 20), 40);
    assert.equal(creditNoteLeftToPay(100, 90, 20), 0);
  });

  test("экраны считают этими функциями", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const detail = readFileSync(resolve(here, "detail/InvoiceDetailScreen.tsx"), "utf8");
    const screen = readFileSync(resolve(here, "../../../app/invoices/credit-note.tsx"), "utf8");
    assert.match(detail, /amount=\$\{creditNoteAmountForRefund\(refundable, settlement\)\}/);
    assert.match(screen, /к оплате \$\{formatInvoiceMoney\(creditNoteLeftToPay\(due, paid, value\)/);
  });
});

describe("налог кредит-ноты — как у сервера", () => {
  const vat = (patch: Partial<Parameters<typeof creditNoteVat>[0]>) =>
    creditNoteVat({ vat: 10, total: 100, amount: 10, priorVat: 0, closes: false, ...patch });

  test("доля считается в центах: половина от 2,01 — 1,01, как round() сервера", () => {
    // Во float 2.01 * 0.5 = 1.00499… и превью печатало 1,00.
    assert.equal(vat({ vat: 2.01, total: 1, amount: 0.5 }), 1.01);
    assert.equal(vat({ vat: 1.61, total: 10, amount: 3.33 }), 0.54);
  });

  test("доля не больше остатка налога после прежних нот", () => {
    assert.equal(vat({ priorVat: 9.99 }), 0.01);
    assert.equal(vat({ priorVat: 10 }), 0);
  });

  test("закрывающая нота несёт весь остаток налога", () => {
    assert.equal(vat({ amount: 66.67, priorVat: 3.33, closes: true }), 6.67);
    assert.equal(vat({ amount: 100, closes: true }), 10);
  });

  test("без налога на бумаге — ноль", () => {
    assert.equal(vat({ vat: 0, closes: true }), 0);
    assert.equal(vat({ total: 0 }), 0);
  });

  test("превью ноты к инвойсу и к чеку считают этой функцией", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const note = readFileSync(resolve(here, "../../../app/invoices/credit-note.tsx"), "utf8");
    const refund = readFileSync(resolve(here, "../../../app/documents/receipt-refund.tsx"), "utf8");
    assert.match(note, /const vat = creditNoteVat\(/);
    assert.equal((refund.match(/creditNoteVat\(/g) ?? []).length, 2);
  });
});
