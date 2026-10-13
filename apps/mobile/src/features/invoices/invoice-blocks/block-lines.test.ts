import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { EditableInvoiceLine } from "../format";
import { invoiceBlockLines, serviceSelection, typedNumber } from "./block-lines";

const line = (over: Partial<EditableInvoiceLine> = {}): EditableInvoiceLine => ({
  id: "l1",
  title: "Чистка",
  qty: "1",
  unitPrice: "10",
  serviceId: "s1",
  ...over,
});

describe("invoiceBlockLines", () => {
  test("parses typed numbers and totals by the shared invoice rule", () => {
    const [row] = invoiceBlockLines([line({ qty: "1,5", unitPrice: "2,01", unit: "м", description: " Фреон " })]);
    assert.equal(row.qty, 1.5);
    assert.equal(row.pricePerUnit, 2.01);
    // 1.5 × 2.01 = 3.015 → €3,02 on paper, PDF and server alike.
    assert.equal(row.total, 3.02);
    assert.equal(row.unit, "м");
    assert.equal(row.subtitle, "Фреон");
    assert.equal("editableName" in row, false);
  });

  test("junk numbers count as zero; a blank title reads «Услуга»", () => {
    const [row] = invoiceBlockLines([line({ title: "  ", qty: "abc", unitPrice: "" })]);
    assert.equal(row.name, "Услуга");
    assert.equal(row.qty, 0);
    assert.equal(row.total, 0);
    assert.equal(row.subtitle, null);
  });

  test("a custom line (no service) is renamed in «Итого»", () => {
    const [row] = invoiceBlockLines([line({ serviceId: null, title: "Выезд" })]);
    assert.equal(row.editableName, "Выезд");
  });
});

describe("typedNumber", () => {
  test("quantity keeps three decimals, price two, no float tails", () => {
    assert.equal(typedNumber("qty", 1.0000001), "1");
    assert.equal(typedNumber("qty", 2.5), "2.5");
    assert.equal(typedNumber("unitPrice", 0.1 + 0.2), "0.3");
    assert.equal(typedNumber("unitPrice", 3.456), "3.46");
  });
});

describe("serviceSelection", () => {
  test("only price-list lines are selected; bad quantity counts as one", () => {
    const { selectedServiceIds, quantities } = serviceSelection([
      line({ serviceId: "a", qty: "3" }),
      line({ id: "l2", serviceId: null }),
      line({ id: "l3", serviceId: "b", qty: "x" }),
    ]);
    assert.deepEqual(selectedServiceIds, ["a", "b"]);
    assert.deepEqual(quantities, { a: 3, b: 1 });
  });
});
