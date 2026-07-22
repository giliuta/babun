import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { InvoiceLedgerWithLines } from "@babun/shared/local/finance/invoice-ledger";
import { buildInvoiceShareText } from "./text";

const invoice = {
  id: "invoice-1",
  tenant_id: "tenant-1",
  number: "INV-2026-007",
  year: 2026,
  seq: 7,
  issued_on: "2026-07-20",
  due_on: "2026-07-27",
  client_id: "client-1",
  appointment_id: null,
  brigade_id: null,
  subtotal_net: 100,
  vat_percent: 19,
  vat_amount: 19,
  total: 119,
  currency: "EUR",
  status: "issued",
  pdf_url: null,
  notes: null,
  created_at: "2026-07-20T08:00:00Z",
  updated_at: "2026-07-20T08:00:00Z",
  created_by: null,
  seller_snapshot: {
    schema_version: 1,
    tenant_id: "tenant-1",
    name: "Historical Seller Ltd",
    display_name: "Historical Seller",
    legal_name: "Historical Seller Ltd",
    vat_number: "OLD-VAT",
    business_address: "Old seller address",
    address: "Old seller address",
    city: "Limassol",
    country: "CY",
    contact_email: "old-seller@example.com",
    contact_phone: null,
    iban: "OLD-IBAN",
    bank_name: "Old Bank",
    currency: "EUR",
  },
  client_snapshot: {
    schema_version: 1,
    client_id: "client-1",
    full_name: "Historical Client",
    phone: null,
    phone_e164: null,
    whatsapp_phone: null,
    email: null,
    address: "Old client address",
    city: "Limassol",
    primary_address: "Old client address",
    archived: false,
    deleted_at: null,
  },
  lines: [{
    id: "line-1",
    invoice_id: "invoice-1",
    position: 0,
    title: "Service",
    qty: 1,
    unit_price: 100,
    total: 100,
  }],
} satisfies InvoiceLedgerWithLines;

describe("invoice text sharing", () => {
  it("uses issued snapshots instead of mutable live names", () => {
    const text = buildInvoiceShareText({
      invoice,
      companyName: "Renamed Seller",
      clientName: "Renamed Client",
      settlement: {
        income: 50,
        refunded: 0,
        paid: 50,
        remaining: 69,
        overpaid: 0,
        isPartial: true,
        isPaid: false,
      },
    });

    assert.match(text, /Historical Seller Ltd/);
    assert.match(text, /Historical Client/);
    assert.match(text, /Old client address/);
    assert.match(text, /OLD-IBAN/);
    assert.doesNotMatch(text, /Renamed Seller/);
    assert.doesNotMatch(text, /Renamed Client/);
  });

  it("does not replace a blank snapshotted name from mutable live data", () => {
    const text = buildInvoiceShareText({
      invoice: {
        ...invoice,
        seller_snapshot: { ...invoice.seller_snapshot, legal_name: null, name: null, display_name: null },
        client_snapshot: { ...invoice.client_snapshot, full_name: null },
      },
      companyName: "Later Seller",
      clientName: "Later Client",
    });

    assert.match(text, /Продавец не указан/);
    assert.match(text, /Клиент: не указан/);
    assert.doesNotMatch(text, /Later Seller/);
    assert.doesNotMatch(text, /Later Client/);
  });
});
