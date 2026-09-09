import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveReturnTo, returnToParam } from "./return-to";

describe("resolveReturnTo", () => {
  test("без метки дороги нет — остаёмся там, куда привела навигация", () => {
    assert.equal(resolveReturnTo(undefined), null);
    assert.equal(resolveReturnTo(""), null);
  });

  test("вкладка денег", () => {
    assert.equal(resolveReturnTo("finances"), "/finances");
  });

  test("страницы-доноры несут свой id", () => {
    assert.equal(resolveReturnTo("invoice:abc-123"), "/invoices/abc-123");
    assert.equal(resolveReturnTo("account:7f0e"), "/accounts/7f0e");
  });

  test("донор без id не уводит на несуществующий маршрут", () => {
    assert.equal(resolveReturnTo("invoice:"), null);
    assert.equal(resolveReturnTo("account:  "), null);
  });

  test("разрез вкладки денег восстанавливается из адреса", () => {
    assert.equal(resolveReturnTo("finances:income"), "/finances?view=income");
    assert.equal(resolveReturnTo("finances:debt"), "/finances?view=debt");
  });

  test("незнакомый разрез открывает корень денег, а не собирает адрес из метки", () => {
    assert.equal(resolveReturnTo("finances:profit&x=1"), "/finances");
    assert.equal(resolveReturnTo("finances:../cabinet"), "/finances");
    assert.equal(resolveReturnTo("finances:"), "/finances");
  });

  test("незнакомая метка игнорируется", () => {
    assert.equal(resolveReturnTo("calendar"), null);
    assert.equal(resolveReturnTo("invoices:abc"), null);
  });
});

describe("returnToParam", () => {
  test("собирается только когда дорога передана", () => {
    assert.equal(returnToParam(undefined), "");
    assert.equal(returnToParam("finances"), "&from=finances");
  });

  test("экранирует id доноров", () => {
    assert.equal(returnToParam("invoice:a b"), "&from=invoice%3Aa%20b");
  });
});
