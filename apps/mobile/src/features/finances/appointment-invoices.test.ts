import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appointmentInvoiceFiles,
  appointmentPayableInvoice,
  liveAppointmentInvoices,
} from "./appointment-invoices";

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

describe("кредит-нота к чеку не бывает инвойсом записи", () => {
  // Нота к чеку ссылается на чек: связи «нота → инвойс» у неё нет, в карту
  // кредит-нот она не попадает — узнаётся только по виду документа.
  const rows = [
    { id: "cn-receipt", appointment_id: "a-1", status: "issued", kind: "credit_note" },
    { id: "inv-1", appointment_id: "a-1", status: "paid", kind: "invoice" },
  ];

  it("живые инвойсы записи её не берут", () => {
    assert.deepEqual(liveAppointmentInvoices(rows, "a-1", new Map()).map((r) => r.id), ["inv-1"]);
  });

  it("без единого инвойса — пусто, а не нота", () => {
    assert.deepEqual(liveAppointmentInvoices(rows.slice(0, 1), "a-1", new Map()), []);
  });

  it("в «Файлах» записи нота к чеку тоже не инвойс", () => {
    assert.deepEqual(appointmentInvoiceFiles(rows, "a-1", new Map()).map((r) => r.id), ["inv-1"]);
  });
});

describe("appointmentPayableInvoice", () => {
  // Список — от новых к старым.
  const newerPaid = { id: "inv-2", appointment_id: "a-1", status: "paid" };
  const olderIssued = { id: "inv-1", appointment_id: "a-1", status: "issued" };

  it("ведёт к инвойсу, который ждёт оплату, даже если новейший оплачен", () => {
    assert.equal(appointmentPayableInvoice([newerPaid, olderIssued])?.id, "inv-1");
  });

  it("при нескольких ждущих берёт самый новый из них", () => {
    const newerIssued = { id: "inv-3", appointment_id: "a-1", status: "issued" };
    assert.equal(appointmentPayableInvoice([newerIssued, olderIssued])?.id, "inv-3");
  });

  it("ждущих нет — самый новый живой; живых нет — ничего", () => {
    assert.equal(appointmentPayableInvoice([newerPaid])?.id, "inv-2");
    assert.equal(appointmentPayableInvoice([]), null);
  });
});
