import { describe, expect, it } from "bun:test";
import {
  calculateInvoicePaymentRefundable,
  calculateInvoiceTotals,
  calculateInvoiceSettlement,
  formatInvoiceNumber,
  invoiceDisplayStatus,
  invoicePaymentRefundDestination,
  parseInvoiceClientSnapshot,
  parseInvoiceSellerSnapshot,
} from "./invoice-ledger";

describe("calculateInvoiceTotals", () => {
  const lines = [
    { title: "Работа", qty: 2, unit_price: 50 },
    { title: "Материал", qty: 1, unit_price: 19 },
  ];

  it("keeps a no-VAT invoice unchanged", () => {
    expect(calculateInvoiceTotals(lines, "off", 19)).toEqual({
      subtotal_net: 119,
      vat_amount: 0,
      total: 119,
    });
  });

  it("splits VAT-inclusive prices to cents", () => {
    expect(calculateInvoiceTotals(lines, "inclusive", 19)).toEqual({
      subtotal_net: 100,
      vat_amount: 19,
      total: 119,
    });
  });

  it("adds VAT on top of net prices", () => {
    expect(calculateInvoiceTotals(lines, "exclusive", 19)).toEqual({
      subtotal_net: 119,
      vat_amount: 22.61,
      total: 141.61,
    });
  });

  it("sums cent-rounded line totals so header and rows cannot drift", () => {
    expect(
      calculateInvoiceTotals(
        [
          { title: "A", qty: 1, unit_price: 0.333 },
          { title: "B", qty: 1, unit_price: 0.333 },
          { title: "C", qty: 1, unit_price: 0.333 },
        ],
        "off",
        0,
      ).total,
    ).toBe(0.99);
  });
});

describe("invoiceDisplayStatus", () => {
  it("derives overdue only for an unpaid issued invoice", () => {
    expect(
      invoiceDisplayStatus(
        { status: "issued", due_on: "2026-07-01" },
        "2026-07-20",
      ),
    ).toBe("overdue");
    expect(
      invoiceDisplayStatus(
        { status: "paid", due_on: "2026-07-01" },
        "2026-07-20",
      ),
    ).toBe("paid");
  });
});

describe("calculateInvoiceSettlement", () => {
  const invoice = { status: "issued" as const, total: 119 };
  const payment = (overrides: Partial<{
    id: string;
    type: "income" | "refund";
    amount: number;
    refund_of_id: string | null;
  }> = {}) => ({
    id: overrides.id ?? "payment-1",
    invoice_id: "invoice-1",
    type: overrides.type ?? ("income" as const),
    amount: overrides.amount ?? 40,
    account_id: "account-1",
    payment_method: "card",
    occurred_on: "2026-07-20",
    refund_of_id: overrides.refund_of_id ?? null,
    notes: null,
    created_at: "2026-07-20T10:00:00Z",
  });

  it("tracks multiple partial payments and the exact remaining balance", () => {
    expect(
      calculateInvoiceSettlement(invoice, [
        payment({ id: "one", amount: 40 }),
        payment({ id: "two", amount: 20.5 }),
      ]),
    ).toMatchObject({ paid: 60.5, remaining: 58.5, isPartial: true, isPaid: false });
  });

  it("subtracts refunds from paid value", () => {
    expect(
      calculateInvoiceSettlement(invoice, [
        payment({ amount: 119 }),
        payment({ id: "refund", type: "refund", amount: -19, refund_of_id: "payment-1" }),
      ]),
    ).toMatchObject({ income: 119, refunded: 19, paid: 100, remaining: 19 });
  });

  it("becomes paid only when multiple payments cover the full total", () => {
    const partial = calculateInvoiceSettlement(invoice, [
      payment({ id: "one", amount: 60 }),
      payment({ id: "two", amount: 58.99 }),
    ]);
    const covered = calculateInvoiceSettlement(invoice, [
      payment({ id: "one", amount: 60 }),
      payment({ id: "two", amount: 59 }),
    ]);
    expect(partial).toMatchObject({ paid: 118.99, remaining: 0.01, isPaid: false });
    expect(covered).toMatchObject({ paid: 119, remaining: 0, isPaid: true });
  });

  it("reopens a legacy paid invoice after a refund", () => {
    expect(
      calculateInvoiceSettlement(
        { status: "paid", total: 119 },
        [payment({ id: "refund", type: "refund", amount: -19 })],
      ),
    ).toMatchObject({ paid: 100, remaining: 19, isPartial: true, isPaid: false });
  });

  it("keeps a legacy paid invoice fully settled without payment rows", () => {
    expect(calculateInvoiceSettlement({ status: "paid", total: 119 }, [])).toMatchObject({
      paid: 119,
      remaining: 0,
      isPaid: true,
    });
  });
});

describe("calculateInvoicePaymentRefundable", () => {
  const income = {
    id: "income-1",
    invoice_id: "invoice-1",
    type: "income" as const,
    amount: 119,
    account_id: "account-1",
    payment_method: "other",
    occurred_on: "2026-07-20",
    refund_of_id: null,
    notes: null,
    created_at: "2026-07-20T10:00:00Z",
  };

  it("subtracts only refunds tied to the selected income", () => {
    expect(calculateInvoicePaymentRefundable(income, [
      income,
      { ...income, id: "refund-1", type: "refund", amount: -20, refund_of_id: income.id },
      { ...income, id: "refund-other", type: "refund", amount: -90, refund_of_id: "income-2" },
    ])).toBe(99);
  });

  it("clamps repeated/legacy refund noise at zero", () => {
    expect(calculateInvoicePaymentRefundable(income, [
      income,
      { ...income, id: "refund-1", type: "refund", amount: -100, refund_of_id: income.id },
      { ...income, id: "refund-2", type: "refund", amount: -30, refund_of_id: income.id },
    ])).toBe(0);
  });

  it("routes appointment-owned income back to the appointment action", () => {
    const manual = { ...income, id: "manual", amount: 40, source: "manual" };
    const automatic = {
      ...income,
      id: "auto",
      amount: 40,
      source: "auto",
      appointment_payment_kind: "settlement",
    };
    expect(invoicePaymentRefundDestination(manual, [manual])).toBe("invoice");
    expect(invoicePaymentRefundDestination(automatic, [automatic])).toBe("appointment");
    expect(invoicePaymentRefundDestination(automatic, [
      automatic,
      {
        ...income,
        id: "auto-refund",
        type: "refund",
        amount: -40,
        refund_of_id: automatic.id,
      },
    ])).toBeNull();
  });
});

describe("invoice party snapshot parsing", () => {
  it("accepts object snapshots and normalizes invalid fields", () => {
    expect(parseInvoiceSellerSnapshot({
      schema_version: 1,
      tenant_id: "tenant-1",
      legal_name: "  Historical Ltd  ",
      vat_number: 123,
    })).toMatchObject({
      tenant_id: "tenant-1",
      legal_name: "Historical Ltd",
      vat_number: null,
    });
    expect(parseInvoiceClientSnapshot({
      client_id: "client-1",
      full_name: " Historical Client ",
      archived: true,
    })).toMatchObject({
      client_id: "client-1",
      full_name: "Historical Client",
      archived: true,
    });
  });

  it("rejects arrays and primitive JSON", () => {
    expect(parseInvoiceSellerSnapshot([])).toBeNull();
    expect(parseInvoiceClientSnapshot("client")).toBeNull();
  });
});

it("normalizes a configured invoice prefix", () => {
  expect(formatInvoiceNumber(" INV- ", 2026, 7)).toBe("INV-2026-007");
});
