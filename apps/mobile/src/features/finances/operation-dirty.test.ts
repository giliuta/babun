import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  operationDraftKey,
  operationIsDirty,
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

