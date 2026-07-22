import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Client } from "@babun/shared/local/clients";
import type { InvoiceLedgerWithLines } from "@babun/shared/local/finance/invoice-ledger";
import type { Tenant } from "@/features/settings/tenant";
import { buildInvoicePdfHtml, escapeHtml } from "./pdf";

const invoice: InvoiceLedgerWithLines = {
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
  notes: "Оплата по договору <A&B>",
  created_at: "2026-07-20T08:00:00Z",
  updated_at: "2026-07-20T08:00:00Z",
  created_by: null,
  lines: [{
    id: "line-1",
    invoice_id: "invoice-1",
    position: 0,
    title: "Сервис <премиум>",
    qty: 1,
    unit_price: 100,
    total: 100,
  }],
};

const tenant = {
  name: "AC Service",
  legal_name: "AC Service Ltd",
  vat_number: "CY123",
  iban: "CY00 0000",
  bank_name: "Bank",
  business_address: "Limassol",
  contact_email: "billing@example.com",
  contact_phone: "+357 000000",
} as Tenant;

const client = {
  full_name: "Иван & Мария",
  email: "client@example.com",
  phone: "+357 111111",
  address: "Старый адрес",
  city: "Лимасол",
  locations: [{
    id: "location-1",
    label: "Дом",
    address: "Основной адрес 5",
    mapUrl: "",
    isPrimary: true,
  }],
} as Client;

describe("invoice PDF HTML", () => {
  it("includes legal requisites, recipient, totals and safe escaped lines", () => {
    const html = buildInvoicePdfHtml({
      invoice,
      tenant,
      client,
      settlement: {
        income: 50,
        refunded: 0,
        paid: 50,
        remaining: 69,
        overpaid: 0,
        isPartial: true,
        isPaid: false,
      },
      payments: [{
        id: "payment-1",
        invoice_id: invoice.id,
        type: "income",
        amount: 50,
        account_id: "account-1",
        payment_method: "transfer",
        occurred_on: "2026-07-21",
        refund_of_id: null,
        notes: null,
        created_at: "2026-07-21T08:00:00Z",
      }],
      accountNames: new Map([["account-1", "Основной счёт"]]),
    });

    assert.match(html, /AC Service Ltd/);
    assert.match(html, /CY123/);
    assert.match(html, /CY00 0000/);
    assert.match(html, /Иван &amp; Мария/);
    assert.match(html, /Основной адрес 5/);
    assert.match(html, /Сервис &lt;премиум&gt;/);
    assert.match(html, /Частично оплачен/);
    assert.match(html, /Основной счёт · Перевод/);
    assert.doesNotMatch(html, /<A&B>/);
  });

  it("states honestly when a recipient is absent", () => {
    const html = buildInvoicePdfHtml({
      invoice: { ...invoice, client_id: null },
      tenant,
      settlement: {
        income: 0,
        refunded: 0,
        paid: 0,
        remaining: 119,
        overpaid: 0,
        isPartial: false,
        isPaid: false,
      },
      payments: [],
    });

    assert.match(html, /Получатель не указан/);
    assert.doesNotMatch(html, /Иван/);
  });

  it("prefers immutable party snapshots over edited live records", () => {
    const html = buildInvoicePdfHtml({
      invoice: {
        ...invoice,
        seller_snapshot: {
          schema_version: 1,
          tenant_id: "tenant-1",
          name: "Historical Seller Ltd",
          display_name: "Historical Seller",
          legal_name: "Historical Seller Ltd",
          vat_number: "OLD-VAT",
          business_address: "Old seller address",
          address: "Old seller address",
          city: "Old City",
          country: "CY",
          contact_email: "old-seller@example.com",
          contact_phone: "+357 000001",
          iban: "OLD-IBAN",
          bank_name: "Old Bank",
          currency: "EUR",
        },
        client_snapshot: {
          schema_version: 1,
          client_id: "client-1",
          full_name: "Historical Client",
          phone: "+357 000002",
          phone_e164: "+357000002",
          whatsapp_phone: null,
          email: "old-client@example.com",
          address: "Old client address",
          city: "Old City",
          primary_address: "Old client address",
          archived: false,
          deleted_at: null,
        },
      },
      tenant: { ...tenant, legal_name: "Renamed Seller Ltd", vat_number: "NEW-VAT" },
      client: { ...client, full_name: "Renamed Client", email: "new-client@example.com" },
      settlement: {
        income: 0,
        refunded: 0,
        paid: 0,
        remaining: 119,
        overpaid: 0,
        isPartial: false,
        isPaid: false,
      },
      payments: [],
    });

    assert.match(html, /Historical Seller Ltd/);
    assert.match(html, /OLD-VAT/);
    assert.match(html, /Historical Client/);
    assert.match(html, /old-client@example\.com/);
    assert.doesNotMatch(html, /Renamed Seller Ltd/);
    assert.doesNotMatch(html, /Renamed Client/);
    assert.doesNotMatch(html, /NEW-VAT/);
  });

  it("does not fill blank issued snapshot fields from later live edits", () => {
    const html = buildInvoicePdfHtml({
      invoice: {
        ...invoice,
        seller_snapshot: {
          schema_version: 1,
          tenant_id: "tenant-1",
          name: "Historical Seller Ltd",
          display_name: "Historical Seller",
          legal_name: "Historical Seller Ltd",
          vat_number: null,
          business_address: null,
          address: null,
          city: null,
          country: null,
          contact_email: null,
          contact_phone: null,
          iban: null,
          bank_name: null,
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
          address: null,
          city: null,
          primary_address: null,
          archived: false,
          deleted_at: null,
        },
      },
      tenant: { ...tenant, vat_number: "LATER-VAT", iban: "LATER-IBAN" },
      client: { ...client, email: "later-client@example.com" },
      settlement: {
        income: 0,
        refunded: 0,
        paid: 0,
        remaining: 119,
        overpaid: 0,
        isPartial: false,
        isPaid: false,
      },
      payments: [],
    });

    assert.doesNotMatch(html, /LATER-VAT/);
    assert.doesNotMatch(html, /LATER-IBAN/);
    assert.doesNotMatch(html, /later-client@example\.com/);
  });

  it("escapes every HTML control character", () => {
    assert.equal(escapeHtml(`<&>\"'`), "&lt;&amp;&gt;&quot;&#039;");
  });
});
