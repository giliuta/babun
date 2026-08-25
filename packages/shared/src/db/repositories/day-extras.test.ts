import { describe, expect, it } from "bun:test";
import { setDayExtras } from "./day-extras";

const extra = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Топливо",
  amount: 25.5,
  kind: "expense" as const,
  category: "fuel" as const,
  payment_method: "cash" as const,
};

function rpcClient(data: Array<Record<string, unknown>>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        return { data, error: null };
      },
      from() {
        throw new Error("setDayExtras must not issue split table writes");
      },
    },
  };
}

describe("atomic day extras replacement", () => {
  it("uses one RPC for the complete replacement", async () => {
    const mock = rpcClient([
      {
        ...extra,
        tenant_id: "tenant-1",
        team_id: "team-1",
        date: "2026-07-20",
      },
    ]);

    await setDayExtras(
      mock.client as never,
      "tenant-1",
      "team-1",
      "2026-07-20",
      [extra],
    );

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.name).toBe("replace_day_extras");
    expect(mock.calls[0]?.args).toEqual({
      p_team_id: "team-1",
      p_date: "2026-07-20",
      p_extras: [
        {
          ...extra,
          receipt_url: null,
        },
      ],
    });
  });

  it("fails when the server does not confirm every submitted row", async () => {
    const mock = rpcClient([]);
    await expect(
      setDayExtras(mock.client as never, "tenant-1", "team-1", "2026-07-20", [
        extra,
      ]),
    ).rejects.toThrow("server did not confirm");
  });
});
