import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatInvoiceNumber } from "./numbering";

// Образец в настройках и номер, который выдаст сервер, обязаны совпадать: иначе
// человек настроит одно, а клиент получит другое.
describe("номер инвойса", () => {
  test("со сбросом по годам номер содержит год", () => {
    assert.equal(
      formatInvoiceNumber({ prefix: "INV", year: 2026, seq: 2, padding: 3, yearlyReset: true }),
      "INV-2026-002",
    );
  });

  test("сквозная нумерация обходится без года", () => {
    assert.equal(
      formatInvoiceNumber({ prefix: "AF", year: 2026, seq: 1421, padding: 5, yearlyReset: false }),
      "AF-01421",
    );
  });

  test("номер длиннее ширины не обрезается", () => {
    assert.equal(
      formatInvoiceNumber({ prefix: "INV", year: 2026, seq: 12345, padding: 3, yearlyReset: false }),
      "INV-12345",
    );
  });

  test("пустой префикс и мусорная ширина не ломают номер", () => {
    assert.equal(
      formatInvoiceNumber({ prefix: "  ", year: 2026, seq: 1, padding: 0, yearlyReset: true }),
      "INV-2026-1",
    );
    assert.equal(
      formatInvoiceNumber({ prefix: "СЧ-", year: 2026, seq: 7, padding: 4, yearlyReset: true }),
      "СЧ-2026-0007",
    );
  });
});
