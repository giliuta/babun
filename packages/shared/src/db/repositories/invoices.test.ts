import { describe, expect, it } from "bun:test";
import { listInvoices } from "./invoices";

function invoiceRow(index: number) {
  return {
    id: `invoice-${String(index).padStart(4, "0")}`,
    tenant_id: "tenant-1",
    number: `INV-2026-${index}`,
    year: 2026,
    seq: index,
    issued_on: "2026-07-20",
    due_on: null,
    client_id: null,
    appointment_id: null,
    brigade_id: null,
    subtotal_net: 10,
    vat_percent: 0,
    vat_amount: 0,
    total: 10,
    currency: "EUR",
    status: "issued",
    pdf_url: null,
    notes: null,
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
    created_by: null,
    seller_snapshot: {},
    client_snapshot: null,
  };
}

describe("invoice repository paging", () => {
  it("reads past the PostgREST 1000-row cap with a stable total order", async () => {
    const source = Array.from({ length: 1001 }, (_, index) => invoiceRow(index + 1));
    const ranges: Array<[number, number]> = [];
    const orderCalls: Array<[string, boolean]> = [];
    const supabase = {
      from: () => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: (column: string, options: { ascending: boolean }) => {
            orderCalls.push([column, options.ascending]);
            return builder;
          },
          range: async (from: number, to: number) => {
            ranges.push([from, to]);
            return { data: source.slice(from, to + 1), error: null };
          },
        };
        return builder;
      },
    };

    const rows = await listInvoices(supabase as never, "tenant-1");

    expect(rows).toHaveLength(1001);
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(orderCalls.slice(0, 3)).toEqual([
      ["year", false],
      ["seq", false],
      ["id", false],
    ]);
  });
});
