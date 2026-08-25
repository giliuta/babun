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

  // КОНТРАКТ ПАРИТЕТА С СЕРВЕРОМ. У SQL `format_invoice_number` ширина —
  // greatest(coalesce(padding,3), 1, length(seq)), верхней границы нет. Клиент
  // капал её восемью, и значение >8, записанное вебом или прямым SQL, давало
  // образец в настройках, не совпадающий с выданным номером.
  test("ширина больше восьми не срезается — как на сервере", () => {
    assert.equal(
      formatInvoiceNumber({ prefix: "INV", year: 2026, seq: 42, padding: 10, yearlyReset: false }),
      "INV-0000000042",
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
