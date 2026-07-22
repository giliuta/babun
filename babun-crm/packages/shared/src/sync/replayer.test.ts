// STORY-062 slice 3 — bun unit test for the shared sync-queue replayer.
//
// Run: cd packages/shared && bun test src/sync/replayer.test.ts
//
// Drives kickReplayer against a real SQLite queue (MemorySqlAdapter backed
// by bun:sqlite) and a hand-rolled fake Supabase client that records the
// PostgREST calls the replayer makes. Locks down the data-loss-critical
// guards ported byte-for-byte from the web replayer:
//   • insert idempotency: 23505 / «duplicate key» → op removed (success)
//   • UUID-guard: non-uuid row_id on update/delete → perm-failed, kept
//   • LWW UPDATE: expected_updated_at matched → op removed, no conflict
//   • LWW conflict: 0 rows on first pass → force-update via .maybeSingle()
//     (never .single()), onConflict toast fired, op removed
//   • injected QuotaGate: `.quota === true` throw → op perm-failed
//   • successful delete/insert drain the queue

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MemorySqlAdapter } from "../storage/sql/memory";
import { setSql } from "../storage/sql/provider";
import {
  __resetCacheForTests,
  enqueueOp,
  queueDepth,
  dequeueAll,
  cacheUpsert,
  cacheGetOne,
  type CachedClient,
} from "../db/cache/sql";
import {
  kickReplayer,
  setReplayerDefaults,
  type QuotaGate,
} from "./replayer";

const TENANT = "11111111-1111-1111-1111-111111111111";
const UUID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UUID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// ─── Fake Supabase PostgREST builder ──────────────────────────────────
// Records every terminal operation. Each `.from(table)` returns a builder
// whose delete/insert/update chains resolve to a { data, error } result
// driven by the `responses` script keyed by `${table}:${op}`.

type Result = { data: unknown; error: unknown };

interface Recorded {
  table: string;
  op: "insert" | "update" | "delete";
  payload?: unknown;
  filters: Record<string, unknown>;
  usedMaybeSingle: boolean;
  usedSingle: boolean;
}

interface RecordedRpc {
  name: string;
  args: Record<string, unknown>;
}

function makeFakeSupabase(
  script: (rec: Recorded) => Result,
  rpcScript: (rec: RecordedRpc) => Result = () => ({
    data: null,
    error: { code: "PGRST202", message: "RPC unavailable in test fake" },
  }),
): { client: unknown; calls: Recorded[]; rpcCalls: RecordedRpc[] } {
  const calls: Recorded[] = [];
  const rpcCalls: RecordedRpc[] = [];

  function builder(table: string) {
    let current: Recorded | null = null;

    const chain: Record<string, unknown> = {};

    const start = (op: Recorded["op"], payload?: unknown) => {
      current = {
        table,
        op,
        payload,
        filters: {},
        usedMaybeSingle: false,
        usedSingle: false,
      };
      calls.push(current);
      return chain;
    };

    // A thenable so `await filter` and `await filter.select()` both resolve.
    const resolve = (): Result => script(current as Recorded);

    chain.insert = (payload: unknown) => start("insert", payload);
    chain.upsert = (payload: unknown) => start("insert", payload);
    chain.update = (payload: unknown) => start("update", payload);
    chain.delete = () => start("delete");
    chain.eq = (col: string, val: unknown) => {
      if (current) current.filters[col] = val;
      return chain;
    };
    chain.select = (_cols?: string) => chain;
    chain.maybeSingle = () => {
      if (current) current.usedMaybeSingle = true;
      return Promise.resolve(resolve());
    };
    chain.single = () => {
      if (current) current.usedSingle = true;
      // .single() throwing on 0-rows is the exact footgun the port avoids;
      // if the replayer ever calls it, surface it loudly.
      return Promise.resolve(resolve());
    };
    // Make the builder awaitable at any point after a terminal op.
    chain.then = (
      onFulfilled: (r: Result) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve(resolve()).then(onFulfilled, onRejected);

    return chain;
  }

  return {
    client: {
      from: builder,
      rpc(name: string, args: Record<string, unknown>) {
        const call = { name, args };
        rpcCalls.push(call);
        return Promise.resolve(rpcScript(call));
      },
    },
    calls,
    rpcCalls,
  };
}

beforeEach(() => {
  setSql(new MemorySqlAdapter(new Database(":memory:")));
  __resetCacheForTests();
});
afterEach(() => {
  setReplayerDefaults(null);
  __resetCacheForTests();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asSupabase = (c: unknown) => c as any;

describe("replayer — insert", () => {
  test("successful insert drains the op", async () => {
    await enqueueOp({
      table: "clients",
      op: "insert",
      row_id: UUID_A,
      payload: { id: UUID_A, tenant_id: TENANT, full_name: "A" },
      expected_updated_at: null,
    });
    const { client, calls } = makeFakeSupabase(() => ({ data: null, error: null }));

    await kickReplayer({ supabase: asSupabase(client) });

    expect(await queueDepth()).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: "clients", op: "insert" });
  });

  test("duplicate-key (23505) is treated as success and drains", async () => {
    await enqueueOp({
      table: "clients",
      op: "insert",
      row_id: UUID_A,
      payload: { id: UUID_A, tenant_id: TENANT },
      expected_updated_at: null,
    });
    const { client } = makeFakeSupabase(() => ({
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "clients_pkey"' },
    }));

    await kickReplayer({ supabase: asSupabase(client) });
    expect(await queueDepth()).toBe(0);
  });

  test("tags op targets client_tags relation", async () => {
    await enqueueOp({
      table: "tags",
      op: "insert",
      row_id: UUID_A,
      payload: { id: UUID_A, tenant_id: TENANT, name: "VIP", color: "#f00" },
      expected_updated_at: null,
    });
    const { client, calls } = makeFakeSupabase(() => ({ data: null, error: null }));
    await kickReplayer({ supabase: asSupabase(client) });
    expect(calls[0]?.table).toBe("client_tags");
    expect(await queueDepth()).toBe(0);
  });

  test("offline client insert restores tags through one atomic RPC", async () => {
    await enqueueOp({
      table: "clients",
      op: "insert",
      row_id: UUID_A,
      payload: {
        id: UUID_A,
        tenant_id: TENANT,
        full_name: "A",
        __tag_ids: [UUID_B, UUID_C, UUID_B],
      },
      expected_updated_at: null,
    });
    const { client, calls, rpcCalls } = makeFakeSupabase(
      () => ({ data: null, error: null }),
      () => ({ data: { id: UUID_A }, error: null }),
    );

    await kickReplayer({ supabase: asSupabase(client) });

    expect(await queueDepth()).toBe(0);
    expect(calls).toHaveLength(0);
    expect(rpcCalls).toEqual([
      {
        name: "create_client_with_tags",
        args: {
          p_tenant_id: TENANT,
          p_client_id: UUID_A,
          p_client: { full_name: "A" },
          p_tag_ids: [UUID_B, UUID_C],
        },
      },
    ]);
  });

  test("a lost aggregate response repairs tags atomically after duplicate", async () => {
    await enqueueOp({
      table: "clients",
      op: "insert",
      row_id: UUID_A,
      payload: {
        id: UUID_A,
        tenant_id: TENANT,
        full_name: "A",
        __tag_ids: [UUID_B],
      },
      expected_updated_at: null,
    });
    const { client, rpcCalls } = makeFakeSupabase(
      () => ({ data: null, error: null }),
      (call) =>
        call.name === "create_client_with_tags"
          ? {
              data: null,
              error: { code: "23505", message: "duplicate key clients_pkey" },
            }
          : { data: { id: UUID_A }, error: null },
    );

    await kickReplayer({ supabase: asSupabase(client) });

    expect(await queueDepth()).toBe(0);
    expect(rpcCalls.map((call) => call.name)).toEqual([
      "create_client_with_tags",
      "update_client_with_tags",
    ]);
    expect(rpcCalls[1]?.args).toMatchObject({
      p_client_id: UUID_A,
      p_patch: {},
      p_tag_ids: [UUID_B],
    });
  });
});

describe("replayer — UUID guard", () => {
  test("non-uuid row_id on update is perm-failed and kept, no network call", async () => {
    await enqueueOp({
      table: "appointments",
      op: "update",
      row_id: "apt-12345-abc", // legacy local id, never reached Postgres
      payload: { status: "done" },
      expected_updated_at: null,
    });
    const { client, calls } = makeFakeSupabase(() => ({ data: [{ id: "x" }], error: null }));

    let permFailed = false;
    await kickReplayer({
      supabase: asSupabase(client),
      onPermanentFailure: () => {
        permFailed = true;
      },
    });

    expect(permFailed).toBe(true);
    expect(calls).toHaveLength(0); // never dispatched
    // Kept in queue (attempts bumped to sentinel) so the panel can drop it.
    const remaining = await dequeueAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].attempts).toBeGreaterThanOrEqual(3);
  });
});

describe("replayer — LWW update", () => {
  test("clean match (rows returned) drains without conflict toast", async () => {
    await enqueueOp({
      table: "clients",
      op: "update",
      row_id: UUID_A,
      payload: { full_name: "New" },
      expected_updated_at: "2026-01-01T00:00:00.000Z",
    });
    const { client, calls } = makeFakeSupabase((rec) => {
      // first (conditional) update returns a matched row
      if (rec.op === "update") return { data: [{ id: UUID_A }], error: null };
      return { data: null, error: null };
    });

    let conflicts = 0;
    await kickReplayer({
      supabase: asSupabase(client),
      onConflict: () => {
        conflicts += 1;
      },
    });

    expect(conflicts).toBe(0);
    expect(await queueDepth()).toBe(0);
    // conditional update carried both id + updated_at filters
    expect(calls[0].filters).toMatchObject({
      id: UUID_A,
      updated_at: "2026-01-01T00:00:00.000Z",
    });
  });

  test("0-row conflict → force-update via maybeSingle (never single), toast fires", async () => {
    await cacheUpsert("clients", {
      id: UUID_A,
      tenant_id: TENANT,
      updated_at: "2026-01-01T00:00:00.000Z",
    } as unknown as CachedClient);

    await enqueueOp({
      table: "clients",
      op: "update",
      row_id: UUID_A,
      payload: { full_name: "Mine" },
      expected_updated_at: "2026-01-01T00:00:00.000Z",
    });

    let call = 0;
    const { client, calls } = makeFakeSupabase((rec) => {
      if (rec.op === "update") {
        call += 1;
        if (call === 1) return { data: [], error: null }; // conflict: 0 rows
        // force-update returns the canonical server row
        return {
          data: {
            id: UUID_A,
            tenant_id: TENANT,
            full_name: "Mine",
            updated_at: "2026-02-02T00:00:00.000Z",
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    let toast = "";
    await kickReplayer({
      supabase: asSupabase(client),
      onConflict: (m) => {
        toast = m;
      },
    });

    expect(toast).toContain("другом устройстве");
    expect(await queueDepth()).toBe(0);
    // The force path MUST use maybeSingle, never single (PGRST116 footgun).
    const forceCall = calls[1];
    expect(forceCall.usedMaybeSingle).toBe(true);
    expect(forceCall.usedSingle).toBe(false);
    // Cache was write-through updated with the canonical row's updated_at.
    const cached = await cacheGetOne<CachedClient>("clients", UUID_A);
    expect(cached?.updated_at).toBe("2026-02-02T00:00:00.000Z");
  });

  test("archive conflict drains UPDATE and keeps archived client out of active cache", async () => {
    const archivedAt = "2026-03-03T00:00:00.000Z";
    await cacheUpsert("clients", {
      id: UUID_A,
      tenant_id: TENANT,
      full_name: "Archived",
      deleted_at: null,
      updated_at: "2026-01-01T00:00:00.000Z",
    } as unknown as CachedClient);

    await enqueueOp({
      table: "clients",
      op: "update",
      row_id: UUID_A,
      payload: { deleted_at: archivedAt },
      expected_updated_at: "2026-01-01T00:00:00.000Z",
    });

    let call = 0;
    const { client, calls } = makeFakeSupabase((rec) => {
      if (rec.op === "update") {
        call += 1;
        if (call === 1) return { data: [], error: null };
        return {
          data: {
            id: UUID_A,
            tenant_id: TENANT,
            full_name: "Archived",
            deleted_at: archivedAt,
            updated_at: "2026-03-03T00:00:01.000Z",
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    await kickReplayer({ supabase: asSupabase(client) });

    expect(calls).toHaveLength(2);
    expect(calls.every((record) => record.op === "update")).toBe(true);
    expect(calls[1]?.usedMaybeSingle).toBe(true);
    expect(await queueDepth()).toBe(0);
    expect(await cacheGetOne<CachedClient>("clients", UUID_A)).toBeNull();
  });
});

describe("replayer — injected quota gate", () => {
  test("host defaults protect wrapper kicks that provide only supabase", async () => {
    await enqueueOp({
      table: "clients",
      op: "insert",
      row_id: UUID_A,
      payload: { id: UUID_A, tenant_id: TENANT },
      expected_updated_at: null,
    });
    const { client, calls } = makeFakeSupabase(() => ({ data: null, error: null }));
    let notified = "";
    setReplayerDefaults({
      quota: {
        assertAvailable() {
          throw { quota: true, message: "Mobile quota reached" };
        },
      },
      onPermanentFailure: (op) => {
        notified = op.last_error ?? "";
      },
    });

    // Cached wrappers use this minimal form after enqueueing. Defaults must
    // still run; otherwise their immediate kick bypasses the mobile policy.
    await kickReplayer({ supabase: asSupabase(client) });

    expect(calls).toHaveLength(0);
    expect(notified).toContain("Mobile quota reached");
    expect((await dequeueAll())[0]?.attempts).toBeGreaterThanOrEqual(3);
  });

  test("quota-shaped throw perm-fails the insert without dispatching", async () => {
    await enqueueOp({
      table: "clients",
      op: "insert",
      row_id: UUID_A,
      payload: { id: UUID_A, tenant_id: TENANT },
      expected_updated_at: null,
    });
    const { client, calls } = makeFakeSupabase(() => ({ data: null, error: null }));
    const quota: QuotaGate = {
      assertAvailable() {
        throw { quota: true, message: "Quota exceeded: clients (5/5)" };
      },
    };

    let permMsg = "";
    await kickReplayer({
      supabase: asSupabase(client),
      quota,
      onPermanentFailure: (op) => {
        permMsg = op.last_error ?? "";
      },
    });

    expect(permMsg).toContain("Quota exceeded");
    expect(calls).toHaveLength(0); // gate blocked before dispatch
    const remaining = await dequeueAll();
    expect(remaining[0].attempts).toBeGreaterThanOrEqual(3);
  });

  test("non-quota gate error falls through to normal dispatch", async () => {
    await enqueueOp({
      table: "clients",
      op: "insert",
      row_id: UUID_A,
      payload: { id: UUID_A, tenant_id: TENANT },
      expected_updated_at: null,
    });
    const { client, calls } = makeFakeSupabase(() => ({ data: null, error: null }));
    const quota: QuotaGate = {
      assertAvailable() {
        throw new Error("transient network blip in gate");
      },
    };

    await kickReplayer({ supabase: asSupabase(client), quota });
    // Fell through → dispatched → drained.
    expect(calls).toHaveLength(1);
    expect(await queueDepth()).toBe(0);
  });
});

describe("replayer — delete", () => {
  test("successful delete drains", async () => {
    await enqueueOp({
      table: "clients",
      op: "delete",
      row_id: UUID_A,
      payload: { id: UUID_A, tenant_id: TENANT },
      expected_updated_at: null,
    });
    const { client, calls } = makeFakeSupabase(() => ({ data: null, error: null }));
    await kickReplayer({ supabase: asSupabase(client) });
    expect(calls[0]).toMatchObject({ op: "delete" });
    expect(await queueDepth()).toBe(0);
  });
});
