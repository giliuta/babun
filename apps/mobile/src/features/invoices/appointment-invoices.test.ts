import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { liveAppointmentInvoices } from "./appointment-invoices";

describe("liveAppointmentInvoices", () => {
  const rows = [
    { id: "inv-1", appointment_id: "a-1", status: "cancelled" },
    { id: "cn-1", appointment_id: "a-1", status: "issued" },
    { id: "inv-2", appointment_id: "a-1", status: "issued" },
    { id: "inv-3", appointment_id: "a-2", status: "paid" },
    { id: "inv-4", appointment_id: "a-1", status: "void" },
  ];
  const notes = new Map([["cn-1", "inv-1"]]);

  it("keeps only the live invoice of the record", () => {
    assert.deepEqual(liveAppointmentInvoices(rows, "a-1", notes).map((r) => r.id), ["inv-2"]);
  });

  it("never offers a credit note as the record invoice after cancellation", () => {
    const afterCancel = rows.filter((r) => r.id !== "inv-2");
    assert.deepEqual(liveAppointmentInvoices(afterCancel, "a-1", notes), []);
  });

  it("returns nothing without a record", () => {
    assert.deepEqual(liveAppointmentInvoices(rows, null, notes), []);
  });
});
