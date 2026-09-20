import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { InvoiceLedgerWithLines } from "@babun/shared/local/finance/invoice-ledger";
import { buildInvoiceDocument } from "./document";
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
  language: "ru",
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
    description: null,
    qty: 1,
    unit: null,
    unit_price: 100,
    total: 100,
  }],
} satisfies InvoiceLedgerWithLines;

const settlement = {
  income: 50,
  refunded: 0,
  paid: 50,
  remaining: 69,
  overpaid: 0,
  isPartial: true,
  isPaid: false,
};

/** Текст собирается ИЗ ДОКУМЕНТА — так же, как PDF и экран. Помощник держит
 *  этот путь в одном месте, чтобы тест не изобретал свой. */
function shareText(
  over: Partial<Parameters<typeof buildInvoiceDocument>[0]> = {},
): string {
  return buildInvoiceShareText(
    buildInvoiceDocument({
      invoice,
      settlement,
      payments: [],
      businessToday: "2026-07-21",
      ...over,
    } as Parameters<typeof buildInvoiceDocument>[0]),
  );
}

describe("текст инвойса для клиента", () => {
  it("берёт снимок выставления, а не сегодняшние имена", () => {
    const text = shareText({
      tenant: { legal_name: "Renamed Seller", name: "Renamed Seller" } as never,
      client: { full_name: "Renamed Client" } as never,
    });
    assert.match(text, /Historical Seller Ltd/);
    assert.doesNotMatch(text, /Renamed Seller/);
  });

  it("не подставляет бренд платформы вместо продавца", () => {
    const text = shareText({ invoice: { ...invoice, seller_snapshot: null } });
    assert.doesNotMatch(text, /Babun/);
  });

  // РЕГРЕССИЯ АУДИТА БУМАГИ 2026-09-20: сообщение считало состав само и
  // расходилось с вложением за одну отправку — говорило «Итого» там, где
  // бумага говорит «К оплате», и печатало клиента, которого на бумаге нет.
  it("говорит теми же словами и числами, что бумага", () => {
    const doc = buildInvoiceDocument({
      invoice,
      settlement,
      payments: [],
      businessToday: "2026-07-21",
    } as Parameters<typeof buildInvoiceDocument>[0]);
    const text = buildInvoiceShareText(doc);
    for (const row of doc.totals) {
      assert.ok(
        text.includes(`${row.label}: ${row.value}`),
        `в сообщении нет строки итога «${row.label}»`,
      );
    }
    assert.ok(text.includes(doc.number), "в сообщении нет номера документа");
  });

  it("английский счёт уходит английским сообщением", () => {
    const text = shareText({
      invoice: { ...invoice, language: "en" },
      language: "en",
    });
    assert.doesNotMatch(text, /Инвойс|К оплате|Выставлен/);
  });
});
