import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { persistInvoiceLanguage } from "./persist-invoice-language";

const noPause = async () => {};

describe("persistInvoiceLanguage", () => {
  test("записалось с первого раза — одна попытка", async () => {
    let calls = 0;
    const saved = await persistInvoiceLanguage(async () => {
      calls++;
    }, noPause);
    assert.equal(saved, true);
    assert.equal(calls, 1);
  });

  test("первая попытка моргнула, вторая прошла", async () => {
    let calls = 0;
    const saved = await persistInvoiceLanguage(async () => {
      calls++;
      if (calls === 1) throw new Error("сеть");
    }, noPause);
    assert.equal(saved, true);
    assert.equal(calls, 2);
  });

  test("обе попытки отказали — false, а не исключение: документ уже выставлен", async () => {
    let calls = 0;
    const saved = await persistInvoiceLanguage(async () => {
      calls++;
      throw new Error("setInvoiceLanguage: язык не сохранился");
    }, noPause);
    assert.equal(saved, false);
    assert.equal(calls, 2);
  });
});
