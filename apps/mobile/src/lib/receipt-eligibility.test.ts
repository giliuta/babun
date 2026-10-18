import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { InvoicePaymentLedger } from "@babun/shared/local/finance/invoice-ledger";
import { readModuleSource } from "@/lib/module-source";
import {
  paymentFullyRefunded,
  paymentsAwaitingReceipt,
  receiptRefusal,
  receiptRefusalText,
} from "./receipt-eligibility";

// «ВЫПИСАТЬ ЧЕК» НЕ ПРЕДЛАГАЕТСЯ ТАМ, ГДЕ СЕРВЕР ЕГО НЕ ВЫПУСТИТ: у инвойса без
// клиента и у оплаты, возвращённой целиком.

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readModuleSource(resolve(here, path));

function payment(over: Partial<InvoicePaymentLedger>): InvoicePaymentLedger {
  return {
    id: "p-1",
    invoice_id: "inv",
    type: "income",
    amount: 100,
    account_id: "acc",
    payment_method: "cash",
    occurred_on: "2026-10-01",
    refund_of_id: null,
    notes: null,
    created_at: "2026-10-01T10:00:00Z",
    ...over,
  };
}
const refund = (of: string, amount: number) =>
  payment({ id: `r-${of}`, type: "refund", amount: -amount, refund_of_id: of });
const issued = { client_id: "c-1", status: "paid", kind: "invoice" };

describe("paymentsAwaitingReceipt", () => {
  test("берёт приходы без чека, не возвращённые целиком", () => {
    const list = [
      payment({ id: "a" }),
      payment({ id: "b" }),
      payment({ id: "c" }),
      refund("c", 100),
      refund("a", 30),
    ];
    const ids = paymentsAwaitingReceipt(list, new Set(["b"])).map((p) => p.id);
    assert.deepEqual(ids, ["a"]);
  });
});

describe("receiptRefusal", () => {
  test("есть клиент и оплата без чека — можно", () => {
    assert.equal(
      receiptRefusal({ invoice: issued, payments: [payment({})], receiptTransactionIds: new Set() }),
      null,
    );
  });

  test("инвойс без клиента — тупик, сервер скажет «чек не нужен»", () => {
    assert.equal(
      receiptRefusal({
        invoice: { ...issued, client_id: null },
        payments: [payment({})],
        receiptTransactionIds: new Set(),
      }),
      "no-client",
    );
  });

  test("оплата возвращена целиком — причина «возвращена», не «нечего выписывать»", () => {
    assert.equal(
      receiptRefusal({
        invoice: issued,
        payments: [payment({}), refund("p-1", 100)],
        receiptTransactionIds: new Set(),
      }),
      "refunded",
    );
  });

  test("чек уже есть — выписывать нечего", () => {
    assert.equal(
      receiptRefusal({ invoice: issued, payments: [payment({})], receiptTransactionIds: new Set(["p-1"]) }),
      "nothing",
    );
  });

  test("отменённый инвойс и кредит-нота чека не получают", () => {
    for (const bad of [
      { ...issued, status: "cancelled" },
      { ...issued, status: "void" },
      { ...issued, kind: "credit_note" },
    ]) {
      assert.equal(
        receiptRefusal({ invoice: bad, payments: [payment({})], receiptTransactionIds: new Set() }),
        "not-an-invoice",
      );
    }
  });

  test("у каждой причины есть слова", () => {
    for (const refusal of ["no-client", "not-an-invoice", "refunded", "nothing"] as const) {
      assert.ok(receiptRefusalText(refusal).length > 10, refusal);
    }
    assert.match(receiptRefusalText("no-client"), /нет клиента/);
  });
});

describe("paymentFullyRefunded", () => {
  test("видит полный возврат, частичный и отсутствие журнала", () => {
    assert.equal(paymentFullyRefunded("p-1", [payment({}), refund("p-1", 100)]), true);
    assert.equal(paymentFullyRefunded("p-1", [payment({}), refund("p-1", 40)]), false);
    assert.equal(paymentFullyRefunded("p-1", undefined), false);
    assert.equal(paymentFullyRefunded("zzz", [payment({})]), false);
  });
});

describe("двери чека берут одно правило", () => {
  test("страница инвойса: кнопка и ссылка идут через receiptRefusal", () => {
    const detail = readModuleSource(
      resolve(here, "../features/invoices/detail/InvoiceDetailScreen.tsx"),
      resolve(here, "../features/invoices/detail"),
    );
    assert.match(detail, /receiptRefusal\(\{/);
    assert.match(detail, /receiptRefusal\(\{ invoice: row, payments, receiptTransactionIds \}\) === null/);
    assert.match(read("../features/invoices/detail/use-invoice-detail.ts"), /notify\(\s*"Чек не выписывается",\s*receiptRefusalText\(refusal\)/);
  });

  test("меню «Документов» не предлагает чек без клиента", () => {
    const panel = read("../features/finances/DocumentsPanel.tsx");
    assert.match(panel, /const needsReceipt =[\s\S]*?receiptRefusal\(\{ invoice, payments: own, receiptTransactionIds: withReceipt \}\) === null/);
  });

  test("составитель: у оплаты без клиента и возвращённой — честная причина, клиент берётся из оплаты", () => {
    const page = readFileSync(resolve(here, "../../app/documents/receipt-new.tsx"), "utf8");
    assert.match(page, /const clientId = forPayment \? \(paymentTx\?\.client_id \?\? null\) : draft\.clientId;/);
    assert.match(page, /"У оплаты нет клиента — чек выписывается на человека, поэтому на эту оплату его не выписать"/);
    assert.match(page, /paymentFullyRefunded\(/);
    assert.match(page, /"Оплата возвращена целиком — чек на неё не выписывается"/);
  });
});
