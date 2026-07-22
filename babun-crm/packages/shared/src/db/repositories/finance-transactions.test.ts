import { describe, expect, it } from "vitest";
import {
  createTransfer,
  insertTransaction,
  listAccountBalanceDeltas,
  listRefundTotals,
  listTransactionsForRange,
  updateTransaction,
} from "./finance-transactions";

function ledgerRow(index: number, overrides: Record<string, unknown> = {}) {
  const id = `tx-${String(index).padStart(5, "0")}`;
  return {
    id,
    tenant_id: "tenant-1",
    type: "income",
    amount: 1,
    currency: "EUR",
    category_id: null,
    account_id: "account-1",
    appointment_id: null,
    appointment_payment_kind: null,
    client_id: null,
    team_id: "team-1",
    master_id: null,
    payment_method: "cash",
    notes: null,
    occurred_on: "2026-07-20",
    receipt_url: null,
    transfer_group_id: null,
    invoice_id: null,
    refund_of_id: null,
    source: "manual",
    created_at: `2026-07-20T00:${String(index % 60).padStart(2, "0")}:00Z`,
    updated_at: "2026-07-20T00:00:00Z",
    created_by: null,
    ...overrides,
  };
}

function pagedSupabase(
  source: Array<Record<string, unknown>>,
  ranges: Array<[number, number]>,
  orders: Array<[string, boolean]>,
) {
  return {
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        lte: () => builder,
        in: () => builder,
        not: () => builder,
        order: (column: string, options: { ascending: boolean }) => {
          orders.push([column, options.ascending]);
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
}

describe("finance transaction repository paging", () => {
  it("reads a date-range ledger past the PostgREST 1000-row cap", async () => {
    const source = Array.from({ length: 1001 }, (_, i) => ledgerRow(i + 1));
    const ranges: Array<[number, number]> = [];
    const orders: Array<[string, boolean]> = [];

    const rows = await listTransactionsForRange(
      pagedSupabase(source, ranges, orders) as never,
      "tenant-1",
      "2026-07-01",
      "2026-07-31",
    );

    expect(rows).toHaveLength(1001);
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(orders.slice(0, 3)).toEqual([
      ["occurred_on", false],
      ["created_at", false],
      ["id", false],
    ]);
  });

  it("sums every balance delta with stable id paging", async () => {
    const source = Array.from({ length: 1001 }, (_, i) => ledgerRow(i + 1));
    const ranges: Array<[number, number]> = [];
    const orders: Array<[string, boolean]> = [];

    const totals = await listAccountBalanceDeltas(
      pagedSupabase(source, ranges, orders) as never,
      "tenant-1",
    );

    expect(totals.get("account-1")).toBe(1001);
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(orders[0]).toEqual(["id", true]);
  });

  it("counts refunds outside the visible period past 1000 rows", async () => {
    const source = Array.from({ length: 1001 }, (_, i) =>
      ledgerRow(i + 1, {
        type: "refund",
        amount: -1,
        refund_of_id: "income-1",
      }),
    );
    const ranges: Array<[number, number]> = [];
    const orders: Array<[string, boolean]> = [];

    const totals = await listRefundTotals(
      pagedSupabase(source, ranges, orders) as never,
      "tenant-1",
    );

    expect(totals.get("income-1")).toBe(1001);
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(orders[0]).toEqual(["id", true]);
  });
});

describe("finance transaction business date", () => {
  it("uses the tenant business date when a manual operation omits its date", async () => {
    let inserted: Record<string, unknown> | null = null;
    const supabase = {
      from: () => {
        const builder = {
          insert: (payload: Record<string, unknown>) => {
            inserted = payload;
            return builder;
          },
          select: () => builder,
          single: async () => ({
            data: ledgerRow(1, inserted ?? {}),
            error: null,
          }),
        };
        return builder;
      },
    };

    await insertTransaction(supabase as never, "tenant-1", {
      type: "expense",
      amount: 5,
      account_id: "account-1",
      team_id: "team-1",
      payment_method: "cash",
      business_today: "2026-07-20",
    });

    expect(inserted).toMatchObject({ occurred_on: "2026-07-20" });
    expect(inserted).not.toHaveProperty("business_today");
  });

  it("rejects a future edit before issuing a database write", async () => {
    let queried = false;
    const supabase = {
      from: () => {
        queried = true;
        throw new Error("database should not be called");
      },
    };

    await expect(
      updateTransaction(supabase as never, "tx-1", {
        occurred_on: "2026-07-21",
        business_today: "2026-07-20",
      }),
    ).rejects.toThrow("будущей датой");
    expect(queried).toBe(false);
  });
});

describe("finance transaction money precision", () => {
  const noDatabase = {
    from: () => {
      throw new Error("database should not be called");
    },
    rpc: () => {
      throw new Error("database should not be called");
    },
  };

  it("rejects values Postgres numeric(12,2) would silently round", async () => {
    await expect(
      insertTransaction(noDatabase as never, "tenant-1", {
        type: "income",
        amount: 1.005,
      }),
    ).rejects.toThrow("двух знаков");
    await expect(
      updateTransaction(noDatabase as never, "tx-1", {
        amount: Number.POSITIVE_INFINITY,
      }),
    ).rejects.toThrow("двух знаков");
    await expect(
      createTransfer(noDatabase as never, "tenant-1", {
        from_account_id: "from",
        to_account_id: "to",
        amount: 12.345,
      }),
    ).rejects.toThrow("двух знаков");
  });

  it("requires refunds to be negative ledger movements", async () => {
    await expect(
      insertTransaction(noDatabase as never, "tenant-1", {
        type: "refund",
        amount: 10,
      }),
    ).rejects.toThrow("уменьшать остаток");
  });
});
