// STORY-062 slice 5 — unit tests for the READ-path freshness machinery:
//   * cacheReplaceTenant — authoritative resync that PRUNES server-deleted
//     rows (vs. cacheBulkUpsert which only upserts);
//   * cacheSignature — order-independent change fingerprint (the loop guard);
//   * the revalidate bridge end-to-end through the tags wrapper: a warm-cache
//     online read revalidates, PRUNES a server-deleted row, and fires
//     `revalidated` ONLY when the server data actually changed (loop guard).
//
// Run: cd packages/shared && bun test src/sync/revalidateBridge.test.ts

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MemorySqlAdapter } from "../storage/sql/memory";
import {
  setSql,
  setNetwork,
  NavigatorOnlineNetwork,
} from "../storage/sql/provider";
import type { NetworkAdapter } from "../storage/sql/types";
import {
  __resetCacheForTests,
  cacheRead,
  cacheReplaceTenant,
  cacheBulkUpsert,
  type CachedTag,
} from "../db/cache/sql";
import { cacheSignature, subscribeRevalidated } from "./revalidate-events";
import { listClientTags } from "./tagsCached";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

class OnlineNetwork implements NetworkAdapter {
  isOnline(): boolean {
    return true;
  }
  subscribe(_cb: (online: boolean) => void): () => void {
    return () => {};
  }
}

/** Minimal Supabase stub modelling only `from("client_tags").select("*")
 *  .eq("tenant_id", …)`, resolving to the rows the test stages. Thenable so
 *  `await supabase.from(...).select(...).eq(...)` works. */
function tagStub(rowsByTenant: Record<string, CachedTag[]>) {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, value: string) => ({
          then: (
            onFulfilled: (r: { data: CachedTag[]; error: null }) => unknown,
          ) => Promise.resolve(onFulfilled({ data: rowsByTenant[value] ?? [], error: null })),
        }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const tag = (id: string, name = id, color = "#000"): CachedTag => ({
  id,
  tenant_id: TENANT_A,
  name,
  color,
});

beforeEach(() => {
  setSql(new MemorySqlAdapter(new Database(":memory:")));
  setNetwork(new OnlineNetwork());
  __resetCacheForTests();
});
afterEach(() => {
  __resetCacheForTests();
  setNetwork(new NavigatorOnlineNetwork());
});

describe("cacheReplaceTenant", () => {
  test("prunes rows the server no longer has, keeps other tenants", async () => {
    // Seed tenant A with two tags + tenant B with one.
    await cacheBulkUpsert("tags", [
      tag("t1"),
      tag("t2"),
      { id: "tb", tenant_id: TENANT_B, name: "b", color: "#111" },
    ]);

    // Server now only has t1 for tenant A → t2 must be pruned.
    await cacheReplaceTenant("tags", TENANT_A, [tag("t1", "renamed")]);

    const a = await cacheRead<CachedTag>("tags", TENANT_A);
    expect(a.map((r) => r.id).sort()).toEqual(["t1"]);
    expect(a[0]!.name).toBe("renamed"); // replaced, not merged

    // Tenant B untouched.
    const b = await cacheRead<CachedTag>("tags", TENANT_B);
    expect(b).toHaveLength(1);
    expect(b[0]!.id).toBe("tb");
  });

  test("empties the tenant when the server snapshot is empty", async () => {
    await cacheBulkUpsert("tags", [tag("t1"), tag("t2")]);
    await cacheReplaceTenant("tags", TENANT_A, []);
    expect(await cacheRead<CachedTag>("tags", TENANT_A)).toHaveLength(0);
  });
});

describe("cacheSignature", () => {
  test("order-independent; equal snapshots match", () => {
    const a = cacheSignature([
      { id: "1", updated_at: "x" },
      { id: "2", updated_at: "y" },
    ]);
    const b = cacheSignature([
      { id: "2", updated_at: "y" },
      { id: "1", updated_at: "x" },
    ]);
    expect(a).toBe(b);
  });

  test("changed updated_at, add, and remove all shift the signature", () => {
    const base = cacheSignature([{ id: "1", updated_at: "x" }]);
    expect(base).not.toBe(cacheSignature([{ id: "1", updated_at: "x2" }]));
    expect(base).not.toBe(
      cacheSignature([
        { id: "1", updated_at: "x" },
        { id: "2", updated_at: "y" },
      ]),
    );
    expect(base).not.toBe(cacheSignature([]));
  });

  test("no updated_at (tags): a rename/recolour shifts the signature", () => {
    const a = cacheSignature([{ id: "1", name: "vip", color: "#000" } as never]);
    const renamed = cacheSignature([
      { id: "1", name: "gold", color: "#000" } as never,
    ]);
    expect(a).not.toBe(renamed);
  });

  test("no updated_at (tags): equal data with DIFFERENT key order matches", () => {
    // The optimistic tag row is built {id, tenant_id, name, color}; PostgREST
    // select("*") returns {color, id, name, tenant_id}. Same data, different
    // column order — the loop-guard signature MUST treat them as identical, or
    // every tag write fires a wasted revalidate emit.
    const optimistic = cacheSignature([
      { id: "1", tenant_id: "t", name: "vip", color: "#000" } as never,
    ]);
    const server = cacheSignature([
      { color: "#000", id: "1", name: "vip", tenant_id: "t" } as never,
    ]);
    expect(optimistic).toBe(server);
  });
});

describe("revalidate bridge (tags wrapper)", () => {
  test("warm-cache online read prunes a server-deleted tag and emits ONCE", async () => {
    // Warm the cache with two tags.
    await cacheBulkUpsert("tags", [tag("t1"), tag("t2")]);

    // Server now only has t1 (t2 deleted elsewhere).
    const supabase = tagStub({ [TENANT_A]: [tag("t1")] });

    const emitted: string[] = [];
    const unsub = subscribeRevalidated((t) => emitted.push(t));

    // Warm-cache branch returns the cached snapshot immediately AND fires the
    // background revalidate. Await a tick so the fire-and-forget settles.
    const listed = await listClientTags(supabase, TENANT_A);
    expect(listed.map((r) => r.id).sort()).toEqual(["t1", "t2"]); // stale snapshot
    await flush();

    // Cache pruned to the server truth, and exactly one revalidate emit.
    const cached = await cacheRead<CachedTag>("tags", TENANT_A);
    expect(cached.map((r) => r.id).sort()).toEqual(["t1"]);
    expect(emitted).toEqual(["tags"]);

    unsub();
  });

  test("no emit when the server data is unchanged (loop guard)", async () => {
    await cacheBulkUpsert("tags", [tag("t1"), tag("t2")]);
    // Server matches the cache exactly.
    const supabase = tagStub({ [TENANT_A]: [tag("t1"), tag("t2")] });

    const emitted: string[] = [];
    const unsub = subscribeRevalidated((t) => emitted.push(t));

    await listClientTags(supabase, TENANT_A);
    await flush();

    expect(emitted).toEqual([]); // steady state — no invalidate → no loop
    unsub();
  });
});

/** Let the wrapper's fire-and-forget revalidate microtasks settle. */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 5));
}
