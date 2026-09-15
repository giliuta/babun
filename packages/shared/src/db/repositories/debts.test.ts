import { describe, expect, it } from "bun:test";
import { listDebts } from "./debts";

// ДОЛГИ ЧИТАЮТСЯ ПОСТРАНИЧНО (15.09). «Финансы» берут долги всей компании за
// период и отбирают команду на устройстве, поэтому срез по `limit` до отбора
// тихо терял бы долги команды. Клиент базы здесь — запись вызовов: страница
// отдаётся по `range`, как её отдал бы PostgREST.

type Call = [string, ...unknown[]];

function debtRow(i: number) {
  return {
    id: `debt-${String(i).padStart(5, "0")}`,
    tenant_id: "tenant-1",
    direction: "incoming",
    client_id: null,
    counterparty: `Клиент ${i}`,
    amount: 10,
    currency: "EUR",
    category_id: null,
    note: null,
    receipt_url: null,
    occurred_on: "2026-09-01",
    occurred_time: null,
    team_id: i % 2 === 0 ? "team-a" : null,
    created_at: "2026-09-01T10:00:00Z",
  };
}

function pagedClient(total: number, options: { fail?: boolean } = {}) {
  const queries: Call[][] = [];
  const client = {
    from(table: string) {
      const calls: Call[] = [["from", table]];
      queries.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "gte", "lte", "order", "limit", "range"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push([method, ...args]);
          return builder;
        };
      }
      builder.then = (resolve: (value: unknown) => unknown) => {
        if (options.fail) {
          return Promise.resolve(resolve({ data: null, error: { message: "нет связи" } }));
        }
        const range = calls.find((call) => call[0] === "range");
        const limit = calls.find((call) => call[0] === "limit");
        const start = range ? (range[1] as number) : 0;
        const end = range
          ? (range[2] as number)
          : limit
            ? (limit[1] as number) - 1
            : total - 1;
        const last = Math.min(end, total - 1);
        const data = Array.from({ length: Math.max(0, last - start + 1) }, (_, k) =>
          debtRow(start + k),
        );
        return Promise.resolve(resolve({ data, error: null }));
      };
      return builder;
    },
  };
  return { queries, client };
}

describe("listDebts", () => {
  it("дочитывает все страницы: 2345 долгов приходят целиком", async () => {
    const mock = pagedClient(2345);
    const debts = await listDebts(mock.client as never, "tenant-1", "2026-09-01", "2026-09-30");

    expect(debts).toHaveLength(2345);
    expect(debts[0]?.id).toBe("debt-00000");
    expect(debts[2344]?.id).toBe("debt-02344");
    expect(mock.queries.map((calls) => calls.find((call) => call[0] === "range"))).toEqual([
      ["range", 0, 999],
      ["range", 1000, 1999],
      ["range", 2000, 2999],
    ]);
    expect(mock.queries.every((calls) => !calls.some((call) => call[0] === "limit"))).toBe(true);
  });

  it("ровно 1000 — ещё один пустой запрос, строк не больше и не меньше", async () => {
    const mock = pagedClient(1000);
    const debts = await listDebts(mock.client as never, "tenant-1", "2026-09-01", "2026-09-30");
    expect(debts).toHaveLength(1000);
    expect(mock.queries).toHaveLength(2);
  });

  it("порядок каждой страницы устойчив: день, создание, номер — по убыванию", async () => {
    const mock = pagedClient(3);
    await listDebts(mock.client as never, "tenant-1", "2026-09-01", "2026-09-30");
    const orders = mock.queries[0]?.filter((call) => call[0] === "order");
    expect(orders).toEqual([
      ["order", "occurred_on", { ascending: false }],
      ["order", "created_at", { ascending: false }],
      ["order", "id", { ascending: false }],
    ]);
  });

  it("без команды — вся компания за период; команда сужает только когда названа", async () => {
    const company = pagedClient(4);
    const all = await listDebts(company.client as never, "tenant-1", "2026-09-01", "2026-09-30");
    expect(all).toHaveLength(4);
    const eqs = company.queries[0]?.filter((call) => call[0] === "eq");
    expect(eqs).toEqual([["eq", "tenant_id", "tenant-1"]]);
    expect(company.queries[0]).toContainEqual(["gte", "occurred_on", "2026-09-01"]);
    expect(company.queries[0]).toContainEqual(["lte", "occurred_on", "2026-09-30"]);

    const team = pagedClient(4);
    await listDebts(team.client as never, "tenant-1", "2026-09-01", "2026-09-30", {
      teamId: "team-a",
    });
    expect(team.queries[0]).toContainEqual(["eq", "team_id", "team-a"]);
  });

  it("ошибка базы называется, а не превращается в пустой список", async () => {
    const mock = pagedClient(10, { fail: true });
    await expect(
      listDebts(mock.client as never, "tenant-1", "2026-09-01", "2026-09-30"),
    ).rejects.toThrow("listDebts: нет связи");
  });
});
