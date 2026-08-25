import { describe, expect, it } from "bun:test";
import { validateInvoiceDraft } from "./invoice-write-helpers";

const draft = {
  issued_on: "2026-07-20",
  due_on: "2026-07-30",
  vat_percent: 19,
  lines: [{ title: "Услуга", qty: 1, unit_price: 10 }],
};

describe("invoice write precision", () => {
  it("accepts cents and three-decimal quantities", () => {
    expect(
      validateInvoiceDraft({
        ...draft,
        lines: [{ title: "Материал", qty: 1.125, unit_price: 10.05 }],
      }),
    ).toEqual([
      {
        title: "Материал",
        qty: 1.125,
        unit_price: 10.05,
        description: null,
        unit: null,
      },
    ]);
  });

  it("rejects a unit price that would be silently rounded", () => {
    expect(() =>
      validateInvoiceDraft({
        ...draft,
        lines: [{ title: "Услуга", qty: 1, unit_price: 10.005 }],
      }),
    ).toThrow("двух знаков");
  });

  it("rejects a VAT rate that would be silently rounded", () => {
    expect(() =>
      validateInvoiceDraft({ ...draft, vat_percent: 19.999 }),
    ).toThrow("двух знаков");
  });
});

describe("единица измерения строки счёта", () => {
  it("проходит как слово и обрезается по краям", () => {
    expect(
      validateInvoiceDraft({
        ...draft,
        lines: [{ title: "Трасса", qty: 4, unit_price: 20, unit: "  м  " }],
      })[0].unit,
    ).toBe("м");
  });

  it("не пускает второе название позиции под видом единицы", () => {
    expect(() =>
      validateInvoiceDraft({
        ...draft,
        lines: [
          {
            title: "Трасса",
            qty: 4,
            unit_price: 20,
            unit: "метров погонных с изоляцией",
          },
        ],
      }),
    ).toThrow("Единица измерения слишком длинная");
  });
});
