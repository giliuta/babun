import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  operationDraftKey,
  operationIsDirty,
  vatDirtyKey,
  type OperationDraftFields,
} from "./operation-dirty";

const blank: OperationDraftFields = {
  type: "expense",
  amount: "",
  categoryId: null,
  notes: "",
  receiptUrl: null,
  pickedAccountId: null,
};

describe("несохранённое в форме операции", () => {
  test("только что открытая форма — терять нечего", () => {
    assert.equal(operationIsDirty(operationDraftKey(blank), blank), false);
  });

  test("набранная сумма, заметка, категория или фото — есть что терять", () => {
    const key = operationDraftKey(blank);
    assert.equal(operationIsDirty(key, { ...blank, amount: "25" }), true);
    assert.equal(operationIsDirty(key, { ...blank, notes: "бензин" }), true);
    assert.equal(operationIsDirty(key, { ...blank, categoryId: "c1" }), true);
    assert.equal(operationIsDirty(key, { ...blank, receiptUrl: "r/1.jpg" }), true);
  });

  test("пробелы не считаются вводом; правка, вернувшая всё как было, — тоже", () => {
    const key = operationDraftKey({ ...blank, amount: "40", notes: "Долг: Андрей" });
    assert.equal(
      operationIsDirty(key, { ...blank, amount: " 40 ", notes: "Долг: Андрей " }),
      false,
    );
  });

  test("форма ещё не открылась — вопроса нет", () => {
    assert.equal(operationIsDirty(null, { ...blank, amount: "5" }), false);
  });
});

describe("день и время — набранное, только если меняли руками", () => {
  const base = {
    type: "expense" as const,
    amount: "10",
    categoryId: "c",
    notes: "",
    receiptUrl: null,
    pickedAccountId: null,
  };
  test("подставленное «сейчас» не делает форму грязной, выбранный день — делает", () => {
    const initial = operationDraftKey(base);
    assert.equal(operationIsDirty(initial, { ...base, when: null }), false);
    assert.equal(operationIsDirty(initial, { ...base, when: "2026-09-20 10:00" }), true);
  });
});


describe("налог — тоже набранное", () => {
  const base = {
    type: "income" as const,
    amount: "100",
    categoryId: "c",
    notes: "",
    receiptUrl: null,
    pickedAccountId: null,
  };
  test("поменяли только режим или ставку VAT — есть что терять", () => {
    const initial = operationDraftKey({ ...base, vat: vatDirtyKey("inclusive", 19) });
    assert.equal(operationIsDirty(initial, { ...base, vat: vatDirtyKey("inclusive", 19) }), false);
    assert.equal(operationIsDirty(initial, { ...base, vat: vatDirtyKey("exclusive", 19) }), true);
    assert.equal(operationIsDirty(initial, { ...base, vat: vatDirtyKey("inclusive", 5) }), true);
    assert.equal(operationIsDirty(initial, { ...base, vat: vatDirtyKey("none", 19) }), true);
  });
  test("без налога ставка ничего не значит; форма без поля vat читается как «без налога»", () => {
    assert.equal(vatDirtyKey("none", 19), vatDirtyKey("none", 5));
    assert.equal(operationIsDirty(operationDraftKey(base), { ...base, vat: vatDirtyKey("none", 19) }), false);
    assert.equal(operationIsDirty(operationDraftKey(base), { ...base, vat: vatDirtyKey("exclusive", 19) }), true);
  });
});
