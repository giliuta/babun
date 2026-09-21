import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { financeSettingsRows } from "./settings-rows";

describe("строки настроек финансов", () => {
  test("владелец видит обе группы целиком", () => {
    assert.deepEqual(financeSettingsRows("owner"), {
      accounts: true,
      categories: true,
      templates: true,
      vat: true,
      invoices: true,
      requisites: true,
      moneyGroup: true,
      documentsGroup: true,
      any: true,
    });
  });

  test("сотрудник: страница открыта, строк и заголовков нет", () => {
    const rows = financeSettingsRows("master");
    assert.equal(rows.any, false);
    for (const [name, shown] of Object.entries(rows)) {
      assert.equal(shown, false, `сотрудник не должен видеть «${name}»`);
    }
  });

  test("заголовок группы живёт только вместе со своими строками", () => {
    // Подпись «Деньги» над пустотой читается как сломанный экран, поэтому
    // группа считается по строкам, а не объявляется отдельно.
    const rows = financeSettingsRows("owner");
    assert.equal(rows.moneyGroup, rows.accounts || rows.categories || rows.templates);
    assert.equal(rows.documentsGroup, rows.vat || rows.invoices || rows.requisites);
  });
});
