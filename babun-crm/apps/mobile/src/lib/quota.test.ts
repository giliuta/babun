import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  assertQuotaAvailable,
  createQuotaGate,
  fetchRemainingQuota,
  MobileQuotaExceededError,
  preflightQuotaForCreate,
} from "./quota";

function quotaStub({
  clientLimit = 100,
  appointmentLimit = 50,
  clients = 0,
  appointments = 0,
}: {
  clientLimit?: number;
  appointmentLimit?: number;
  clients?: number;
  appointments?: number;
} = {}) {
  const calls: string[] = [];
  const client = {
    rpc(name: string) {
      calls.push(`rpc:${name}`);
      return Promise.resolve({
        data:
          name === "tenant_quota_clients"
            ? clientLimit
            : appointmentLimit,
        error: null,
      });
    },
    from(table: string) {
      calls.push(`from:${table}`);
      const result = {
        count: table === "clients" ? clients : appointments,
        error: null,
      };
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.gte = () => chain;
      chain.then = (
        resolve: (value: typeof result) => unknown,
        reject?: (error: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject);
      return chain;
    },
  };
  return { client: client as never, calls };
}

describe("mobile quota preflight", () => {
  test("rejects an entire CSV batch before it can partially exceed the client cap", async () => {
    const { client } = quotaStub({ clientLimit: 100, clients: 98 });

    await assert.rejects(
      assertQuotaAvailable(client, "tenant-a", "clients", 5),
      (error: unknown) => {
        assert.ok(error instanceof MobileQuotaExceededError);
        assert.equal(error.quota, true);
        assert.equal(error.kind, "clients");
        assert.equal(error.current, 98);
        assert.equal(error.limit, 100);
        assert.equal(error.requested, 5);
        assert.match(error.message, /можно добавить ещё 2/);
        return true;
      },
    );
  });

  test("reports the exact remaining allowance", async () => {
    const { client } = quotaStub({ clientLimit: 1000, clients: 247 });
    assert.equal(
      await fetchRemainingQuota(client, "tenant-a", "clients"),
      753,
    );
  });

  test("replay gate checks clients and appointments but never blocks tags", async () => {
    const { client, calls } = quotaStub({
      clientLimit: 3,
      clients: 2,
      appointmentLimit: 10,
      appointments: 9,
    });
    const gate = createQuotaGate(client);

    await gate.assertAvailable({
      id: 1,
      table: "clients",
      op: "insert",
      row_id: "client-id",
      payload: { tenant_id: "tenant-a" },
      expected_updated_at: null,
      created_at: 1,
      attempts: 0,
    });
    await gate.assertAvailable({
      id: 2,
      table: "appointments",
      op: "insert",
      row_id: "appointment-id",
      payload: { tenant_id: "tenant-a" },
      expected_updated_at: null,
      created_at: 2,
      attempts: 0,
    });
    const beforeTag = calls.length;
    await gate.assertAvailable({
      id: 3,
      table: "tags",
      op: "insert",
      row_id: "tag-id",
      payload: { tenant_id: "tenant-a" },
      expected_updated_at: null,
      created_at: 3,
      attempts: 0,
    });

    assert.ok(calls.includes("rpc:tenant_quota_clients"));
    assert.ok(calls.includes("rpc:tenant_quota_appointments_month"));
    assert.equal(calls.length, beforeTag);
  });

  test("single online creates are preflighted with a friendly quota error", async () => {
    const { client } = quotaStub({ clientLimit: 2, clients: 2 });
    await assert.rejects(
      preflightQuotaForCreate(client, "tenant-a", "clients", {
        online: true,
        isNetworkUnavailable: () => false,
      }),
      (error: unknown) => {
        assert.ok(error instanceof MobileQuotaExceededError);
        assert.equal(error.requested, 1);
        assert.match(error.message, /лимит клиентов исчерпан/i);
        return true;
      },
    );
  });

  test("offline and confirmed transport failures defer to the offline wrapper", async () => {
    let calls = 0;
    const neverCalled = {
      rpc() {
        calls++;
        throw new Error("must stay offline");
      },
    } as never;
    assert.equal(
      await preflightQuotaForCreate(neverCalled, "tenant-a", "clients", {
        online: false,
        isNetworkUnavailable: () => false,
      }),
      "deferred-offline",
    );
    assert.equal(calls, 0);

    const transportFailure = {
      rpc() {
        return Promise.resolve({
          data: null,
          error: { message: "Network request failed" },
        });
      },
      from() {
        const result = { count: null, error: { message: "Network request failed" } };
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.gte = () => chain;
        chain.then = (resolve: (value: typeof result) => unknown) =>
          Promise.resolve(result).then(resolve);
        return chain;
      },
    } as never;
    assert.equal(
      await preflightQuotaForCreate(
        transportFailure,
        "tenant-a",
        "appointments_month",
        {
          online: true,
          isNetworkUnavailable: (error) =>
            /network request failed/i.test(String((error as Error).message)),
        },
      ),
      "deferred-offline",
    );
  });
});
