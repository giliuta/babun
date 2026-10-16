import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyTxVat } from "@babun/shared/local/finance/vat";
import { parseMoneyInputToCents } from "@babun/shared/common/utils/money";
import { operationTransactionPatch, type OperationPatchBaseline } from "../operation-patch";
import { amountVatMode, hydratedAmountText, txVatMode, vatRowVisible } from "./vat-frame";

// Операция «налог сверху»: назначили 100, на счёт легло 119 при 19 %.
const exclusiveTx = { amount: 119, vat_mode: "exclusive" as const, vat_amount: 19, vat_rate: 19 };

const baseline = {
  amount: exclusiveTx.amount,
  vat_mode: "exclusive",
} as OperationPatchBaseline;

/** Что форма кладёт на счёт из текста поля — тот же путь, что у листа. */
function grossFromField(text: string, rowOnScreen: boolean): number {
  const amountNum = (parseMoneyInputToCents(text) ?? 0) / 100;
  return applyTxVat(amountNum, amountVatMode(exclusiveTx.vat_mode, rowOnScreen), 19).gross;
}

describe("строка VAT не исчезает посреди набора ставки", () => {
  test("открытая строка держится при ставке 0", () => {
    assert.equal(vatRowVisible({ isOwner: true, rate: 0, vatShown: true }), true);
  });
  test("закрытая при ставке 0 — клавиш нет, считать нечем", () => {
    assert.equal(vatRowVisible({ isOwner: true, rate: 0, vatShown: false }), false);
    assert.equal(vatRowVisible({ isOwner: true, rate: 19, vatShown: false }), true);
  });
  test("тому, кто не видит настроек налога, строки нет", () => {
    assert.equal(vatRowVisible({ isOwner: false, rate: 19, vatShown: true }), false);
  });
});

describe("правка «налог сверху», когда строки VAT не видно", () => {
  test("поле показывает сумму на счёте, а не без налога", () => {
    assert.equal(hydratedAmountText(exclusiveTx, false), "119");
  });

  test("сумму не трогали — итог на счёте не меняется, патча суммы нет", () => {
    const text = hydratedAmountText(exclusiveTx, false);
    const gross = grossFromField(text, false);
    assert.equal(gross, 119);
    const patch = operationTransactionPatch({ amount: gross, vat_mode: "exclusive" }, baseline);
    assert.deepEqual(patch, {});
  });

  test("сумму тронули — на счёт ложится ровно введённое", () => {
    // Набирают «настоящую» сумму 150 — налог сверху второй раз не прибавляется.
    assert.equal(grossFromField("150", false), 150);
    // Даже те суммы, что «сверху» по центам не собираются обратно.
    assert.equal(grossFromField("119,01", false), 119.01);
  });
});

describe("правка «налог сверху» с видимой строкой — по-прежнему", () => {
  test("поле без налога, на счёт — с налогом", () => {
    assert.equal(hydratedAmountText(exclusiveTx, true), "100");
    assert.equal(grossFromField("100", true), 119);
  });

  test("режим старой строки без колонки выводится из налога", () => {
    assert.equal(txVatMode({ amount: 119, vat_mode: null, vat_amount: 19, vat_rate: 19 }), "inclusive");
    assert.equal(txVatMode({ amount: 100, vat_mode: null, vat_amount: null, vat_rate: null }), "none");
  });
});
