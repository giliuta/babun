// STORY-062 slice 1 — bun unit test for the SQLite offline cache driven
// through the in-memory adapter (MemorySqlAdapter backed by bun:sqlite).
//
// Run: cd packages/shared && bun test
//
// Exercises the full public cache surface against a real SQLite engine:
//   - cacheUpsert → cacheRead → cacheGetOne → cacheDelete
//   - enqueueOp → dequeueAll (created_at ASC ordering, FIFO tiebreak)
//   - removeOp / bumpAttempt / markOpPermanentlyFailed / resetOpAttempts
//   - queueDepth / readMeta / writeMeta
//   - cacheClearTenant (tenant-scoped) and cacheClearAll (everything)
//   - enqueueOpWithCacheUpsert atomicity (both land, or neither on throw)

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MemorySqlAdapter } from "../../storage/sql/memory";
import { setSql } from "../../storage/sql/provider";
import {
  __resetCacheForTests,
  bumpAttempt,
  cacheBulkUpsert,
  cacheClearAll,
  cacheClearTenant,
  cacheDelete,
  cacheGetOne,
  cacheRead,
  cacheUpsert,
  dequeueAll,
  enqueueOp,
  enqueueOpWithCacheDelete,
  enqueueOpWithCacheUpsert,
  markOpPermanentlyFailed,
  queueDepth,
  readMeta,
  removeOp,
  resetOpAttempts,
  writeMeta,
  type CachedClient,
  type QueuedOp,
} from "./sql";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

// Minimal CachedClient factory — the cache stores the whole row as JSON,
// so only id / tenant_id / updated_at need to be real; the rest is opaque.
function client(
  id: string,
  tenantId: string,
  overrides: Partial<CachedClient> = {},
): CachedClient {
  return {
    id,
    tenant_id: tenantId,
    updated_at: "2026-01-01T00:00:00.000Z",
    name: `Client ${id}`,
    ...overrides,
  } as unknown as CachedClient;
}

beforeEach(() => {
  // Fresh in-memory SQLite per test → zero cross-test leakage.
  setSql(new MemorySqlAdapter(new Database(":memory:")));
  __resetCacheForTests();
});

afterEach(() => {
  __resetCacheForTests();
});

describe("cache row CRUD", () => {
  test("cacheUpsert → cacheRead → cacheGetOne → cacheDelete", async () => {
    await cacheUpsert("clients", client("c1", TENANT_A));
    await cacheUpsert("clients", client("c2", TENANT_A));

    const rows = await cacheRead<CachedClient>("clients", TENANT_A);
    expect(rows.map((r) => r.id).sort()).toEqual(["c1", "c2"]);

    const one = await cacheGetOne<CachedClient>("clients", "c1");
    expect(one?.id).toBe("c1");
    expect(one?.tenant_id).toBe(TENANT_A);

    const missing = await cacheGetOne<CachedClient>("clients", "nope");
    expect(missing).toBeNull();

    await cacheDelete("clients", "c1");
    expect(await cacheGetOne("clients", "c1")).toBeNull();
    const after = await cacheRead<CachedClient>("clients", TENANT_A);
    expect(after.map((r) => r.id)).toEqual(["c2"]);
  });

  test("cacheUpsert overwrites an existing row (ON CONFLICT)", async () => {
    await cacheUpsert("clients", client("c1", TENANT_A, { name: "Old" }));
    await cacheUpsert("clients", client("c1", TENANT_A, { name: "New" }));
    const rows = await cacheRead<CachedClient>("clients", TENANT_A);
    expect(rows.length).toBe(1);
    expect((rows[0] as unknown as { name: string }).name).toBe("New");
  });

  test("cacheRead is tenant-scoped", async () => {
    await cacheUpsert("clients", client("a1", TENANT_A));
    await cacheUpsert("clients", client("b1", TENANT_B));
    expect((await cacheRead("clients", TENANT_A)).length).toBe(1);
    expect((await cacheRead("clients", TENANT_B)).length).toBe(1);
  });

  test("cacheBulkUpsert writes many rows in one transaction", async () => {
    await cacheBulkUpsert("clients", [
      client("c1", TENANT_A),
      client("c2", TENANT_A),
      client("c3", TENANT_A),
    ]);
    const rows = await cacheRead<CachedClient>("clients", TENANT_A);
    expect(rows.length).toBe(3);
  });
});

describe("queue ordering + lifecycle", () => {
  function makeOp(
    overrides: Partial<Omit<QueuedOp, "id" | "created_at" | "attempts">> = {},
  ): Omit<QueuedOp, "id" | "created_at" | "attempts"> {
    return {
      table: "clients",
      op: "insert",
      row_id: crypto.randomUUID(),
      payload: { hello: "world" },
      expected_updated_at: null,
      ...overrides,
    };
  }

  test("dequeueAll returns ops in created_at ASC order (FIFO on ties)", async () => {
    // Three ops enqueued back-to-back — likely the same millisecond, so
    // the id ASC tiebreak must preserve insertion order.
    await enqueueOp(makeOp({ row_id: crypto.randomUUID() }));
    await enqueueOp(makeOp({ row_id: crypto.randomUUID() }));
    await enqueueOp(makeOp({ row_id: crypto.randomUUID() }));

    const ops = await dequeueAll();
    expect(ops.length).toBe(3);
    // ids are AUTOINCREMENT → strictly increasing in insertion order.
    expect(ops.map((o) => o.id)).toEqual([...ops.map((o) => o.id)].sort((a, b) => a - b));
    // created_at non-decreasing.
    for (let i = 1; i < ops.length; i++) {
      expect(ops[i]!.created_at).toBeGreaterThanOrEqual(ops[i - 1]!.created_at);
    }
  });

  test("enqueued op round-trips its fields", async () => {
    const rowId = crypto.randomUUID();
    await enqueueOp(
      makeOp({
        table: "appointments",
        op: "update",
        row_id: rowId,
        payload: { a: 1, b: "two" },
        expected_updated_at: "2026-02-02T00:00:00.000Z",
      }),
    );
    const [op] = await dequeueAll();
    expect(op).toBeDefined();
    expect(op!.table).toBe("appointments");
    expect(op!.op).toBe("update");
    expect(op!.row_id).toBe(rowId);
    expect(op!.payload).toEqual({ a: 1, b: "two" });
    expect(op!.expected_updated_at).toBe("2026-02-02T00:00:00.000Z");
    expect(op!.attempts).toBe(0);
    expect(op!.last_error).toBeUndefined();
    expect(typeof op!.id).toBe("number");
  });

  test("queueDepth / removeOp", async () => {
    await enqueueOp(makeOp());
    await enqueueOp(makeOp());
    expect(await queueDepth()).toBe(2);
    const ops = await dequeueAll();
    await removeOp(ops[0]!.id);
    expect(await queueDepth()).toBe(1);
    const remaining = await dequeueAll();
    expect(remaining.map((o) => o.id)).toEqual([ops[1]!.id]);
  });

  test("bumpAttempt increments + records last_error", async () => {
    await enqueueOp(makeOp());
    const [op] = await dequeueAll();
    await bumpAttempt(op!.id, "boom");
    const [after] = await dequeueAll();
    expect(after!.attempts).toBe(1);
    expect(after!.last_error).toBe("boom");
  });

  test("markOpPermanentlyFailed sets sentinel 999", async () => {
    await enqueueOp(makeOp());
    const [op] = await dequeueAll();
    await markOpPermanentlyFailed(op!.id, "quota");
    const [after] = await dequeueAll();
    expect(after!.attempts).toBe(999);
    expect(after!.last_error).toBe("quota");
  });

  test("resetOpAttempts clears attempts + last_error", async () => {
    await enqueueOp(makeOp());
    const [op] = await dequeueAll();
    await bumpAttempt(op!.id, "boom");
    await resetOpAttempts(op!.id);
    const [after] = await dequeueAll();
    expect(after!.attempts).toBe(0);
    expect(after!.last_error).toBeUndefined();
  });
});

describe("clear operations", () => {
  test("cacheClearTenant drops only the named tenant's rows", async () => {
    await cacheUpsert("clients", client("a1", TENANT_A));
    await cacheUpsert("clients", client("a2", TENANT_A));
    await cacheUpsert("clients", client("b1", TENANT_B));

    await cacheClearTenant("clients", TENANT_A);

    expect((await cacheRead("clients", TENANT_A)).length).toBe(0);
    expect((await cacheRead("clients", TENANT_B)).length).toBe(1);
  });

  test("cacheClearAll wipes every table including the queue + meta", async () => {
    await cacheUpsert("clients", client("a1", TENANT_A));
    await cacheUpsert("appointments", {
      id: "ap1",
      tenant_id: TENANT_A,
      date: "2026-03-03",
      updated_at: "2026-03-03T00:00:00.000Z",
    } as unknown as CachedClient);
    await cacheUpsert("tags", {
      id: "t1",
      tenant_id: TENANT_A,
    } as unknown as CachedClient);
    await enqueueOp({
      table: "clients",
      op: "insert",
      row_id: crypto.randomUUID(),
      payload: {},
      expected_updated_at: null,
    });
    await writeMeta("lastSync", "2026-01-01");

    await cacheClearAll();

    expect((await cacheRead("clients", TENANT_A)).length).toBe(0);
    expect((await cacheRead("appointments", TENANT_A)).length).toBe(0);
    expect((await cacheRead("tags", TENANT_A)).length).toBe(0);
    expect(await queueDepth()).toBe(0);
    expect(await readMeta("lastSync")).toBeNull();
  });
});

describe("meta kv", () => {
  test("writeMeta / readMeta round-trip + overwrite", async () => {
    expect(await readMeta("k")).toBeNull();
    await writeMeta("k", "v1");
    expect(await readMeta("k")).toBe("v1");
    await writeMeta("k", "v2");
    expect(await readMeta("k")).toBe("v2");
  });
});

describe("atomic enqueue + optimistic upsert (risk #6)", () => {
  test("both land on success", async () => {
    const c = client("c1", TENANT_A);
    await enqueueOpWithCacheUpsert(
      {
        table: "clients",
        op: "insert",
        row_id: "c1",
        payload: c as unknown as Record<string, unknown>,
        expected_updated_at: null,
      },
      "clients",
      c,
    );
    expect((await cacheGetOne("clients", "c1"))).not.toBeNull();
    expect(await queueDepth()).toBe(1);
  });

  test("neither lands if the transaction throws", async () => {
    const c = client("c2", TENANT_A);
    // Force a failure mid-transaction by handing enqueue a payload that
    // can't serialise (a BigInt makes JSON.stringify throw), after the
    // upsert has already run inside the same tx → rollback must undo it.
    const badOp = {
      table: "clients" as const,
      op: "insert" as const,
      row_id: "c2",
      payload: { bad: BigInt(1) } as unknown as Record<string, unknown>,
      expected_updated_at: null,
    };
    let threw = false;
    try {
      await enqueueOpWithCacheUpsert(badOp, "clients", c);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // Rolled back: neither the optimistic row nor the queue entry survive.
    expect(await cacheGetOne("clients", "c2")).toBeNull();
    expect(await queueDepth()).toBe(0);
  });

  test("enqueueOpWithCacheDelete removes the row + enqueues in one tx", async () => {
    await cacheUpsert("clients", client("c1", TENANT_A));
    expect(await cacheGetOne("clients", "c1")).not.toBeNull();

    await enqueueOpWithCacheDelete(
      {
        table: "clients",
        op: "delete",
        row_id: "c1",
        payload: { id: "c1", tenant_id: TENANT_A },
        expected_updated_at: null,
      },
      "clients",
      "c1",
    );

    expect(await cacheGetOne("clients", "c1")).toBeNull();
    expect(await queueDepth()).toBe(1);
    const [op] = await dequeueAll();
    expect(op!.op).toBe("delete");
    expect(op!.row_id).toBe("c1");
  });
});

describe("cacheGetOne tenant-scope (minor)", () => {
  test("tenant-scoped read only matches the active tenant", async () => {
    // Two DIFFERENT tenants, DIFFERENT ids — the realistic case. The
    // tenant-scoped read returns the row for the active tenant and null
    // for the other, while the unscoped read still finds either by id.
    await cacheUpsert("clients", client("a1", TENANT_A));
    await cacheUpsert("clients", client("b1", TENANT_B));

    // Scoped to A: a1 visible, b1 hidden (belongs to B).
    expect(await cacheGetOne("clients", "a1", TENANT_A)).not.toBeNull();
    expect(await cacheGetOne("clients", "b1", TENANT_A)).toBeNull();
    // Scoped to B: mirror image.
    expect(await cacheGetOne("clients", "b1", TENANT_B)).not.toBeNull();
    expect(await cacheGetOne("clients", "a1", TENANT_B)).toBeNull();
    // Unscoped (no tenant arg) still finds either by id — prior behaviour.
    expect(await cacheGetOne("clients", "a1")).not.toBeNull();
    expect(await cacheGetOne("clients", "b1")).not.toBeNull();
  });
});
