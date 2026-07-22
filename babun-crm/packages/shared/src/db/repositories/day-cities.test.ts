import { describe, expect, test } from "bun:test";
import { listDayCities } from "./day-cities";

describe("day city paging", () => {
  test("keeps labels beyond the first PostgREST page", async () => {
    const tenantId = "11111111-1111-1111-1111-111111111111";
    const rows = Array.from({ length: 1005 }, (_, index) => ({
      tenant_id: tenantId,
      team_id: `team-${String(index % 3).padStart(2, "0")}`,
      date: `2026-${String(Math.floor(index / 28 / 12) + 1).padStart(2, "0")}-${String(
        (index % 28) + 1,
      ).padStart(2, "0")}-${String(index).padStart(4, "0")}`,
      city: `Метка ${index}`,
    }));
    const client = {
      from() {
        let selected = rows;
        const chain = {
          select: () => chain,
          eq: (column: string, value: string) => {
            selected = selected.filter(
              (row) => row[column as keyof typeof row] === value,
            );
            return chain;
          },
          order: () => chain,
          range: (from: number, to: number) =>
            Promise.resolve({ data: selected.slice(from, to + 1), error: null }),
        };
        return chain;
      },
    };

    const result = await listDayCities(client as never, tenantId);

    expect(Object.keys(result)).toHaveLength(1005);
    expect(Object.values(result)).toContain("Метка 1004");
  });
});
