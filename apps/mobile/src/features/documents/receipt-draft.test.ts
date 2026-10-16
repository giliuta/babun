import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AppointmentService } from "@babun/shared/local/appointments";
import type { Service } from "@/features/services/queries";
import {
  newLine,
  receiptDiscount,
  receiptLinesForServer,
  receiptTotals,
  recalc,
  type ReceiptDraftState,
} from "./receipt-draft";

const line = (over: Partial<AppointmentService> = {}): AppointmentService => ({
  serviceId: "s1",
  quantity: 1,
  pricePerUnit: 10,
  originalPrice: 10,
  totalPrice: 10,
  duration: 60,
  serviceName: "Чистка",
  unit: null,
  ...over,
});

const draft = (over: Partial<ReceiptDraftState> = {}): ReceiptDraftState => ({
  teamId: null,
  clientId: null,
  accountId: null,
  companyId: null,
  date: "2026-10-04",
  locationId: null,
  clientRequisitesId: null,
  lines: [],
  discountType: "percent",
  discountValue: "",
  vatMode: "none",
  ...over,
});

describe("receiptDiscount", () => {
  test("comma decimals parse; empty, zero and junk — no discount", () => {
    assert.deepEqual(receiptDiscount(draft({ discountValue: "12,5" })), { type: "percent", value: 12.5 });
    assert.equal(receiptDiscount(draft({ discountValue: "" })), null);
    assert.equal(receiptDiscount(draft({ discountValue: "0" })), null);
    assert.equal(receiptDiscount(draft({ discountValue: "abc" })), null);
  });
});

describe("receiptTotals", () => {
  test("works minus discount, rounded to cents", () => {
    const totals = receiptTotals(
      draft({
        lines: [line({ quantity: 3, pricePerUnit: 33.33 }), line({ serviceId: "s2", pricePerUnit: 0.1 })],
        discountValue: "10",
      }),
    );
    assert.equal(totals.works, 100.09);
    assert.equal(totals.discountAmount, 10.01);
    assert.equal(totals.total, 90.08);
  });

  test("a fixed discount above the works never makes the total negative", () => {
    const totals = receiptTotals(draft({ lines: [line()], discountType: "fixed", discountValue: "50" }));
    assert.equal(totals.total, 0);
  });
});

describe("receiptLinesForServer", () => {
  test("one server line per work line, priced by lineTotal", () => {
    const rows = receiptLinesForServer(
      draft({ lines: [line({ quantity: 2, pricePerUnit: 12.5, unit: "шт" })] }),
      (l) => `#${l.serviceId}`,
    );
    assert.deepEqual(rows, [{ name: "#s1", qty: 2, unit: "шт", unitPrice: 12.5, sum: 25 }]);
  });
});

describe("newLine and recalc", () => {
  test("a catalogue service becomes one line at its price", () => {
    const svc = { id: "x", price: 40, duration_minutes: 90, name: "Монтаж", unit: null } as unknown as Service;
    const made = newLine(svc);
    assert.equal(made.serviceId, "x");
    assert.equal(made.totalPrice, 40);
    assert.equal(made.duration, 90);
    assert.equal(made.serviceName, "Монтаж");
  });

  test("duration follows the quantity; price change re-totals", () => {
    const two = recalc(line({ duration: 60 }), { quantity: 2 });
    assert.equal(two.duration, 120);
    assert.equal(two.totalPrice, 20);
    const priced = recalc(two, { pricePerUnit: 7.5 });
    assert.equal(priced.totalPrice, 15);
    assert.equal(priced.duration, 120);
  });

  test("zero quantity keeps the duration as the per-one base", () => {
    assert.equal(recalc(line({ quantity: 0, duration: 30 }), { quantity: 3 }).duration, 90);
  });
});
