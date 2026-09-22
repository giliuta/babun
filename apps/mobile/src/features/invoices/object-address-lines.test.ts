import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { objectAddressLines } from "./document";
import { invoiceDictionary } from "./dictionary";

// АДРЕС ПОЛУЧАТЕЛЯ — ТОЛЬКО ТОЧНЫЙ АДРЕС ОБЪЕКТА (владелец 2026-09-22):
// строки бумаги на её языке; без «где» — адреса нет вовсе.
describe("objectAddressLines", () => {
  const parts = {
    street: "Makariou 12",
    complex: "Sunny Court",
    entrance: "2",
    floor: "3",
    apartment: "5",
    city: "Limassol",
    zip: "4000",
  };

  it("prints the exact address in English words", () => {
    assert.deepEqual(objectAddressLines(parts, invoiceDictionary("en")), [
      "Makariou 12, Sunny Court",
      "Entrance 2, Floor 3, Apt 5",
      "Limassol 4000",
    ]);
  });

  it("prints the same address in Russian words", () => {
    assert.deepEqual(objectAddressLines(parts, invoiceDictionary("ru"))[1], "подъезд 2, эт. 3, кв. 5");
  });

  it("prints nothing without a street, complex or city", () => {
    assert.deepEqual(objectAddressLines({ floor: "3", apartment: "5" }, invoiceDictionary("en")), []);
    assert.deepEqual(objectAddressLines(null, invoiceDictionary("en")), []);
  });
});
