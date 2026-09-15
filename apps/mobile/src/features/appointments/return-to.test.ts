import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveReturnTo, returnToParam } from "./return-to";

const ACCOUNT = "7f0e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b";

describe("resolveReturnTo", () => {
  test("без метки дороги нет — остаёмся там, куда привела навигация", () => {
    assert.equal(resolveReturnTo(undefined), null);
    assert.equal(resolveReturnTo(""), null);
  });

  test("вкладка денег", () => {
    assert.equal(resolveReturnTo("finances"), "/finances");
  });

  test("страница инвойса несёт свой id", () => {
    assert.equal(resolveReturnTo("invoice:abc-123"), "/invoices/abc-123");
  });

  test("инвойс без id не уводит на несуществующий маршрут", () => {
    assert.equal(resolveReturnTo("invoice:"), null);
    assert.equal(resolveReturnTo("invoice:  "), null);
  });

  test("разрез вкладки денег восстанавливается из адреса", () => {
    assert.equal(resolveReturnTo("finances:income"), "/finances?view=income");
    assert.equal(resolveReturnTo("finances:debt"), "/finances?view=debt");
    assert.equal(resolveReturnTo("finances:accounts"), "/finances?view=accounts");
  });

  test("«Счета» возвращаются вместе с выбранным счётом", () => {
    assert.equal(
      resolveReturnTo(`finances:accounts:${ACCOUNT}`),
      `/finances?view=accounts&account=${ACCOUNT}`,
    );
  });

  test("счёт из адреса — только uuid и только у «Счетов»", () => {
    assert.equal(
      resolveReturnTo("finances:accounts:1&view=profit"),
      "/finances?view=accounts",
    );
    assert.equal(
      resolveReturnTo(`finances:income:${ACCOUNT}`),
      "/finances?view=income",
    );
  });

  test("незнакомый разрез открывает корень денег, а не собирает адрес из метки", () => {
    assert.equal(resolveReturnTo("finances:profit&x=1"), "/finances");
    assert.equal(resolveReturnTo("finances:../cabinet"), "/finances");
    assert.equal(resolveReturnTo("finances:"), "/finances");
  });

  test("незнакомая метка игнорируется", () => {
    assert.equal(resolveReturnTo("calendar"), null);
    assert.equal(resolveReturnTo("invoices:abc"), null);
    // Страницы операций счёта больше нет: метка старой сборки никуда не ведёт.
    assert.equal(resolveReturnTo(`account:${ACCOUNT}`), null);
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
