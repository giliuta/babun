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
  markOpPermanentlyFailed,
  type CachedClient,
  type QueuedOp,
} from "../db/cache/sql";
import {
  __resetReplayerForTests,
  BOUND_TENANT_FIELD,
  kickReplayer,
  MAX_ATTEMPTS,
  READ_ONLY_VIEW_FIELD,
  setReplayerDefaults,
  tenantRefreshHeld,
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
  op: "insert" | "update" | "delete" | "select";
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
    // `select` без предшествующей терминальной операции — это ЧТЕНИЕ
    // (реплеер спрашивает сервер, есть ли строка после 23505).
    chain.select = (_cols?: string) => (current ? chain : start("select"));
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
  // Засов `draining` мог остаться от чужого файла (см. __resetReplayerForTests).
  __resetReplayerForTests();
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

  test("23505 по первичному ключу: строка УЖЕ на сервере — операция снимается", async () => {
    await enqueueOp({
      table: "clients",
      op: "insert",
      row_id: UUID_A,
      payload: { id: UUID_A, tenant_id: TENANT },
      expected_updated_at: null,
    });
    const { client } = makeFakeSupabase((rec) =>
      rec.op === "select"
        ? { data: { id: UUID_A }, error: null }
        : {
            data: null,
            error: {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "clients_pkey"',
            },
          },
    );

    await kickReplayer({ supabase: asSupabase(client) });
    expect(await queueDepth()).toBe(0);
  });

  test("23505 по ЧУЖОМУ индексу (номер занят): операцию не хороним молча", async () => {
    // Раньше любой 23505 считался успехом, и созданный офлайн клиент
    // исчезал вместе с объектами и заметками: на телефоне он есть, на
    // сервере его нет и не будет.
    await enqueueOp({
      table: "clients",
      op: "insert",
      row_id: UUID_A,
      payload: { id: UUID_A, tenant_id: TENANT },
      expected_updated_at: null,
    });
    const { client } = makeFakeSupabase((rec) =>
      rec.op === "select"
        ? { data: null, error: null }
        : {
            data: null,
            error: {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "clients_tenant_phone_e164_idx"',
            },
          },
    );

    await kickReplayer({ supabase: asSupabase(client) });
    // Операция осталась в очереди и попадёт в панель ошибок с человеческим
    // текстом — вместо тихой потери клиента.
    expect(await queueDepth()).toBe(1);
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

  test("offline client with a tag: queue fields the RPC refuses do not reach it (повторный аудит 03.10)", async () => {
    await enqueueOp({
      table: "clients",
      op: "insert",
      row_id: UUID_A,
      payload: {
        id: UUID_A,
        tenant_id: TENANT,
        full_name: "A",
        sms_opt_out: false,
        purge_at: null,
        updated_at: "2026-10-03T00:00:00.000Z",
        __tag_ids: [UUID_B],
      },
      expected_updated_at: null,
    });
    const { client, rpcCalls } = makeFakeSupabase(
      () => ({ data: null, error: null }),
      () => ({ data: { id: UUID_A }, error: null }),
    );

    await kickReplayer({ supabase: asSupabase(client) });

    expect(await queueDepth()).toBe(0);
    expect(rpcCalls[0]?.args.p_client).toEqual({ full_name: "A" });
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

describe("replayer — порядок правок одной строки", () => {
  test("правка упала — следующие правки той же строки ждут, чужие строки уходят", async () => {
    await enqueueOp({
      table: "appointments",
      op: "update",
      row_id: UUID_A,
      payload: { time_end: "15:00" },
      expected_updated_at: null,
    });
    await enqueueOp({
      table: "appointments",
      op: "update",
      row_id: UUID_A,
      payload: { time_end: "14:30" },
      expected_updated_at: null,
    });
    await enqueueOp({
      table: "appointments",
      op: "update",
      row_id: UUID_B,
      payload: { comment: "другая запись" },
      expected_updated_at: null,
    });
    let firstA = true;
    const { client, calls } = makeFakeSupabase((rec) => {
      if (rec.op === "update" && rec.filters.id === UUID_A && firstA) {
        firstA = false;
        return { data: null, error: { status: 504, message: "Gateway Timeout" } };
      }
      return { data: [{ id: rec.filters.id }], error: null };
    });

    await kickReplayer({ supabase: asSupabase(client) });

    const sentA = calls.filter((c) => c.op === "update" && c.filters.id === UUID_A);
    // Свежая правка A не обогнала упавшую старую.
    expect(sentA.map((c) => (c.payload as { time_end?: string }).time_end)).toEqual([
      "15:00",
    ]);
    // Запись B от чужого сбоя не страдает.
    expect(calls.some((c) => c.op === "update" && c.filters.id === UUID_B)).toBe(true);
    // Обе правки A остались в очереди — в прежнем порядке.
    const left = (await dequeueAll()).filter((o) => o.row_id === UUID_A);
    expect(left.map((o) => (o.payload as { time_end?: string }).time_end)).toEqual([
      "15:00",
      "14:30",
    ]);
  });
});

describe("replayer — навсегда упавшая правка держит свою строку (аудит 03.10)", () => {
  test("правки за упавшей навсегда ждут её «Повторить», чужие строки уходят", async () => {
    await enqueueOp({
      table: "appointments",
      op: "insert",
      row_id: UUID_A,
      payload: { id: UUID_A, tenant_id: TENANT },
      expected_updated_at: null,
    });
    await enqueueOp({
      table: "appointments",
      op: "update",
      row_id: UUID_A,
      payload: { comment: "дописал адрес" },
      expected_updated_at: null,
    });
    await enqueueOp({
      table: "appointments",
      op: "update",
      row_id: UUID_B,
      payload: { comment: "другая" },
      expected_updated_at: null,
    });
    const [insert] = await dequeueAll();
    await markOpPermanentlyFailed(insert!.id, "quota_exceeded");
    const { client, calls } = makeFakeSupabase((rec) => ({
      data: [{ id: rec.filters.id }],
      error: null,
    }));

    await kickReplayer({ supabase: asSupabase(client) });

    expect(calls.some((c) => c.filters.id === UUID_A)).toBe(false);
    expect(calls.some((c) => c.op === "update" && c.filters.id === UUID_B)).toBe(true);
    expect((await dequeueAll()).map((o) => o.row_id)).toEqual([UUID_A, UUID_A]);
  });

  test("придержанные за упавшей не замораживают перечитку календаря", () => {
    const op = (id: number, row: string, attempts: number): QueuedOp => ({
      id,
      created_at: id,
      table: "appointments",
      op: "update",
      row_id: row,
      payload: { tenant_id: TENANT },
      expected_updated_at: null,
      attempts,
      last_error: null,
    });
    expect(tenantRefreshHeld([op(1, UUID_A, MAX_ATTEMPTS), op(2, UUID_A, 0)], "appointments", TENANT)).toBe(false);
    expect(tenantRefreshHeld([op(1, UUID_A, MAX_ATTEMPTS), op(2, UUID_B, 0)], "appointments", TENANT)).toBe(true);
  });
});

describe("replayer — вторая офлайн-правка строки без ложного конфликта (аудит 03.10)", () => {
  test("сторож переходит от применившейся правки к следующей", async () => {
    await cacheUpsert("clients", {
      id: UUID_A,
      tenant_id: TENANT,
      updated_at: "2026-01-01T00:00:00.000Z",
    } as unknown as CachedClient);
    for (const name of ["Первая", "Вторая"]) {
      await enqueueOp({
        table: "clients",
        op: "update",
        row_id: UUID_A,
        payload: { full_name: name },
        expected_updated_at: "2026-01-01T00:00:00.000Z",
      });
    }
    let stamp = "2026-01-01T00:00:00.000Z";
    let tick = 0;
    const { client, calls } = makeFakeSupabase((rec) => {
      if (rec.op === "update" && rec.filters.updated_at === stamp) {
        tick += 1;
        stamp = `2026-02-0${tick}T00:00:00.000Z`;
        return { data: [{ id: UUID_A, updated_at: stamp }], error: null };
      }
      if (rec.op === "update") return { data: [], error: null };
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
    expect(calls.filter((c) => c.op === "update").map((c) => c.filters.updated_at)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
    ]);
    const cached = await cacheGetOne<CachedClient>("clients", UUID_A);
    expect(cached?.updated_at).toBe("2026-02-02T00:00:00.000Z");
  });

  test("сторож доживает до следующего прохода, если вторая не ушла", async () => {
    await cacheUpsert("clients", {
      id: UUID_A,
      tenant_id: TENANT,
      updated_at: "2026-01-01T00:00:00.000Z",
    } as unknown as CachedClient);
    for (const name of ["Первая", "Вторая"]) {
      await enqueueOp({
        table: "clients",
        op: "update",
        row_id: UUID_A,
        payload: { full_name: name },
        expected_updated_at: "2026-01-01T00:00:00.000Z",
      });
    }
    let first = true;
    const { client } = makeFakeSupabase((rec) => {
      if (rec.op === "update" && first) {
        first = false;
        return { data: [{ id: UUID_A, updated_at: "2026-02-01T00:00:00.000Z" }], error: null };
      }
      return { data: null, error: { status: 503, message: "Service Unavailable" } };
    });

    await kickReplayer({ supabase: asSupabase(client) });

    const left = await dequeueAll();
    expect(left.map((o) => o.expected_updated_at)).toEqual(["2026-02-01T00:00:00.000Z"]);
  });
});

describe("replayer — статус и деньги записи силой не продавливаются (аудит 03.10)", () => {
  const serverRow = {
    id: UUID_A,
    tenant_id: TENANT,
    team_id: "team-1",
    kind: "work",
    date: "2026-10-05",
    time_start: "10:00",
    time_end: "11:00",
    status: "scheduled",
    payment_status: "partial",
    prepaid_amount: 30,
    paid_amount: 0,
    total_amount: 100,
    services: [],
    service_ids: [],
    payments: [],
    expenses: [],
    updated_at: "2026-10-03T12:00:00.000Z",
  };

  test("отмена, вставшая до чужой оплаты, уступает серверу и говорит словами", async () => {
    await enqueueOp({
      table: "appointments",
      op: "update",
      row_id: UUID_A,
      payload: { status: "cancelled", cancel_reason: "Клиент перенёс", tenant_id: TENANT },
      expected_updated_at: "2026-10-01T00:00:00.000Z",
    });
    const { client, calls } = makeFakeSupabase((rec) => {
      if (rec.op === "update") return { data: [], error: null }; // строку правили — конфликт
      if (rec.op === "select") return { data: serverRow, error: null };
      return { data: null, error: null };
    });
    const toasts: string[] = [];

    await kickReplayer({
      supabase: asSupabase(client),
      tenantId: TENANT,
      onConflict: (m) => {
        toasts.push(m);
      },
    });

    // Одна условная правка — силовой второй (= возврата всех денег) нет.
    expect(calls.filter((c) => c.op === "update")).toHaveLength(1);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toContain("не применена");
    expect(await queueDepth()).toBe(0);
    const cached = await cacheGetOne<{ status: string; updated_at: string }>("appointments", UUID_A);
    expect(cached?.status).toBe("scheduled");
  });

  test("правка времени при конфликте по-прежнему применяется (последний побеждает)", async () => {
    await enqueueOp({
      table: "appointments",
      op: "update",
      row_id: UUID_A,
      payload: { time_start: "12:00", time_end: "13:00", tenant_id: TENANT },
      expected_updated_at: "2026-10-01T00:00:00.000Z",
    });
    let call = 0;
    const { client, calls } = makeFakeSupabase((rec) => {
      if (rec.op === "update") {
        call += 1;
        if (call === 1) return { data: [], error: null };
        return { data: { ...serverRow, time_start: "12:00", time_end: "13:00" }, error: null };
      }
      return { data: null, error: null };
    });
    const toasts: string[] = [];

    await kickReplayer({
      supabase: asSupabase(client),
      tenantId: TENANT,
      onConflict: (m) => {
        toasts.push(m);
      },
    });

    expect(calls.filter((c) => c.op === "update")).toHaveLength(2);
    expect(toasts[0]).toContain("Применены ваши изменения");
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

// ─── Гейт по компании ─────────────────────────────────────────────────
// Очередь ПЕРЕЖИВАЕТ переход в другую компанию, поэтому в ней лежат операции,
// поставленные под другой. Вставку сервер отобьёт сам (`with check`), а вот
// удаление отбить нечем: под чужой компанией оно не найдёт строку, вернёт ноль
// строк БЕЗ ошибки — и операция уйдёт из очереди как выполненная. Человек
// удалил запись, очередь пуста, запись на месте. Эти тесты держат гейт.

describe("replayer — гейт по компании", () => {
  const ДРУГАЯ = "22222222-2222-2222-2222-222222222222";

  test("удаление ЧУЖОЙ компании не уходит на сервер и остаётся в очереди", async () => {
    await enqueueOp({
      table: "clients",
      op: "delete",
      row_id: UUID_A,
      payload: { id: UUID_A, tenant_id: ДРУГАЯ },
      expected_updated_at: null,
    });
    const { client, calls } = makeFakeSupabase(() => ({ data: null, error: null }));

    await kickReplayer({ supabase: asSupabase(client), tenantId: TENANT });

    expect(calls).toHaveLength(0);
    expect(await queueDepth()).toBe(1);
  });

  test("операция БЕЗ компании не выгружается, пока гейт включён", async () => {
    await enqueueOp({
      table: "clients",
      op: "delete",
      row_id: UUID_A,
      payload: { id: UUID_A },
      expected_updated_at: null,
    });
    const { client, calls } = makeFakeSupabase(() => ({ data: null, error: null }));

    await kickReplayer({ supabase: asSupabase(client), tenantId: TENANT });

    // Отправить её значило бы отдать серверу решать, в какую компанию писать.
    expect(calls).toHaveLength(0);
    expect(await queueDepth()).toBe(1);
  });

  test("смена компании ПОСРЕДИ слива обрывает его, остаток ждёт", async () => {
    for (const id of [UUID_A, UUID_B]) {
      await enqueueOp({
        table: "clients",
        op: "delete",
        row_id: id,
        payload: { id, tenant_id: TENANT },
        expected_updated_at: null,
      });
    }
    const { client, calls } = makeFakeSupabase(() => ({ data: null, error: null }));

    // Живое чтение. Компанию спрашивают на гейт слива и по ходу операции:
    // 1 — гейт, 2 — начало круга по первой, 3 — перед её отправкой, 4 — после
    // двусмысленного «ноль строк», перед проверкой видимости (аудит 03.10),
    // 5 — начало круга по второй. Первая обязана доехать целиком, ко второй
    // человек уже в другой компании.
    let читаний = 0;
    const currentTenantId = (): string | null => {
      читаний += 1;
      return читаний >= 5 ? ДРУГАЯ : TENANT;
    };

    await kickReplayer({ supabase: asSupabase(client), currentTenantId });

    expect(calls.filter((c) => c.op === "delete")).toHaveLength(1);
    expect(await queueDepth()).toBe(1);
  });

  test("компания сменилась между условной правкой и силовой — операция ждёт, попытка не в счёт (аудит 03.10)", async () => {
    await enqueueOp({
      table: "clients",
      op: "update",
      row_id: UUID_A,
      payload: { full_name: "Моя", tenant_id: TENANT },
      expected_updated_at: "2026-01-01T00:00:00.000Z",
    });
    let switched = false;
    const { client, calls } = makeFakeSupabase((rec) => {
      if (rec.op === "update") {
        // Условная правка нашла ноль строк, и в этот миг человек тапнул
        // команду другой компании.
        switched = true;
        return { data: [], error: null };
      }
      return { data: null, error: null };
    });
    const currentTenantId = (): string | null => (switched ? ДРУГАЯ : TENANT);

    await kickReplayer({ supabase: asSupabase(client), currentTenantId });

    // Ни силовой правки, ни проверки видимости под чужим заголовком.
    expect(calls.filter((c) => c.op === "update")).toHaveLength(1);
    expect(calls.filter((c) => c.op === "select")).toHaveLength(0);
    const [left] = await dequeueAll();
    expect(left?.attempts).toBe(0);
  });

  test("без гейта вовсе поведение прежнее — операция без компании уходит", async () => {
    await enqueueOp({
      table: "clients",
      op: "delete",
      row_id: UUID_A,
      payload: { id: UUID_A },
      expected_updated_at: null,
    });
    const { client, calls } = makeFakeSupabase(() => ({ data: null, error: null }));

    await kickReplayer({ supabase: asSupabase(client) });

    expect(calls.filter((c) => c.op === "delete")).toHaveLength(1);
    expect(await queueDepth()).toBe(0);
  });
});

// ─── Правки без компании в теле (до 24.09) ────────────────────────────
// Гейт 12.09 молча пропускал правку без компании на каждом круге: она не
// уходила и не падала, а пока в очереди висит правка записи, перечитка
// записей с сервера не идёт — календарь телефона замирал, и оплата, принятая
// сервером, на экране оставалась «не оплачено» (владелец 2026-09-24).

describe("replayer — правки без компании в теле", () => {
  test("компания берётся из строки кэша, правка уходит, в SET компании нет", async () => {
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
    const { client, calls } = makeFakeSupabase((rec) =>
      rec.op === "update" ? { data: [{ id: UUID_A }], error: null } : { data: null, error: null },
    );

    await kickReplayer({ supabase: asSupabase(client), tenantId: TENANT });

    expect(calls.filter((c) => c.op === "update")).toHaveLength(1);
    expect(await queueDepth()).toBe(0);
  });

  test("строку правили после — побеждает сервер: силой не пишем, кэш берёт строку сервера", async () => {
    await cacheUpsert("clients", {
      id: UUID_A,
      tenant_id: TENANT,
      full_name: "Old",
      updated_at: "2026-01-01T00:00:00.000Z",
    } as unknown as CachedClient);
    await enqueueOp({
      table: "clients",
      op: "update",
      row_id: UUID_A,
      payload: { full_name: "Stale" },
      expected_updated_at: "2026-01-01T00:00:00.000Z",
    });
    const { client, calls } = makeFakeSupabase((rec) => {
      if (rec.op === "update") return { data: [], error: null }; // конфликт
      if (rec.op === "select") {
        return {
          data: {
            id: UUID_A,
            tenant_id: TENANT,
            full_name: "Server",
            updated_at: "2026-09-24T11:06:21.000Z",
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    let conflicts = 0;

    await kickReplayer({
      supabase: asSupabase(client),
      tenantId: TENANT,
      onConflict: () => {
        conflicts += 1;
      },
    });

    // Одна условная правка, без силовой второй.
    expect(calls.filter((c) => c.op === "update")).toHaveLength(1);
    expect(conflicts).toBe(0);
    expect(await queueDepth()).toBe(0);
    const cached = await cacheGetOne<CachedClient>("clients", UUID_A);
    expect(cached?.updated_at).toBe("2026-09-24T11:06:21.000Z");
  });

  test("компанию узнать неоткуда — операция в «не удалось», очередь её больше не ждёт", async () => {
    await enqueueOp({
      table: "appointments",
      op: "update",
      row_id: UUID_B,
      payload: { status: "completed" },
      expected_updated_at: null,
    });
    const { client, calls } = makeFakeSupabase(() => ({ data: null, error: null }));

    await kickReplayer({ supabase: asSupabase(client), tenantId: TENANT });

    expect(calls).toHaveLength(0);
    const [op] = await dequeueAll();
    expect(op?.attempts).toBeGreaterThanOrEqual(3);
    expect(op?.last_error).toContain("без компании");
  });

  test("новая правка несёт компанию для гейта, но не шлёт её колонкой", async () => {
    await enqueueOp({
      table: "appointments",
      op: "update",
      row_id: UUID_C,
      payload: { status: "completed", tenant_id: TENANT },
      expected_updated_at: null,
    });
    const { client, calls } = makeFakeSupabase(() => ({ data: null, error: null }));

    await kickReplayer({ supabase: asSupabase(client), tenantId: TENANT });

    const update = calls.find((c) => c.op === "update");
    expect(update?.payload).toEqual({ status: "completed" });
    expect(await queueDepth()).toBe(0);
  });
});

// ─── Удаление отчитывается строками ───────────────────────────────────
// `delete()` без `select()` возвращает ошибку только когда сервер ОТВЕТИЛ
// ошибкой. «Политика не дала удалить» ошибкой не считается: под RLS строка
// просто не находится. Ноль затронутых строк приезжал как успех — операция
// уходила из очереди, а запись оставалась жить. С правами по календарям
// (`view` без `edit_all`) этот случай стал обычным, а не экзотикой.

describe("replayer — удаление отчитывается строками", () => {
  test("строка удалена — успех, лишней проверки не делаем", async () => {
    await enqueueOp({
      table: "clients",
      op: "delete",
      row_id: UUID_A,
      payload: { id: UUID_A, tenant_id: TENANT },
      expected_updated_at: null,
    });
    const { client, calls } = makeFakeSupabase((rec) =>
      rec.op === "delete"
        ? { data: [{ id: UUID_A }], error: null }
        : { data: null, error: null },
    );

    await kickReplayer({ supabase: asSupabase(client) });

    expect(calls.filter((c) => c.op === "select")).toHaveLength(0);
    expect(await queueDepth()).toBe(0);
  });

  test("ноль строк и строки не видно — идемпотентно, это успех", async () => {
    await enqueueOp({
      table: "clients",
      op: "delete",
      row_id: UUID_A,
      payload: { id: UUID_A, tenant_id: TENANT },
      expected_updated_at: null,
    });
    // Удалили с другого устройства: удалять нечего и видеть нечего.
    const { client } = makeFakeSupabase(() => ({ data: null, error: null }));

    await kickReplayer({ supabase: asSupabase(client) });

    // Тревоги быть не должно: два устройства у одного человека — норма.
    expect(await queueDepth()).toBe(0);
  });

  test("ноль строк, а строка ВИДНА — сервер отказал, операция остаётся", async () => {
    await enqueueOp({
      table: "clients",
      op: "delete",
      row_id: UUID_A,
      payload: { id: UUID_A, tenant_id: TENANT },
      expected_updated_at: null,
    });
    const { client } = makeFakeSupabase((rec) =>
      rec.op === "delete"
        ? { data: [], error: null }
        : { data: { id: UUID_A }, error: null },
    );

    await kickReplayer({ supabase: asSupabase(client) });

    const left = await dequeueAll();
    expect(left).toHaveLength(1);
    expect(left[0].attempts).toBe(1);
    expect(left[0].last_error ?? "").toContain("нет прав");
  });

  test("ноль строк, а проверка видимости упала — операцию не снимаем", async () => {
    await enqueueOp({
      table: "clients",
      op: "delete",
      row_id: UUID_A,
      payload: { id: UUID_A, tenant_id: TENANT },
      expected_updated_at: null,
    });
    // Обрыв сети на чтении — не «строки не видно»: гадать нельзя.
    const { client } = makeFakeSupabase((rec) =>
      rec.op === "delete"
        ? { data: [], error: null }
        : { data: null, error: { message: "network down" } },
    );

    await kickReplayer({ supabase: asSupabase(client) });

    const left = await dequeueAll();
    expect(left).toHaveLength(1);
    expect(left[0].last_error ?? "").toContain("network down");
  });
});

// ─── Правка, которую сервер не дал применить ──────────────────────────
// Ноль строк у ПРИНУДИТЕЛЬНОЙ правки так же двусмыслен, как у удаления:
// строку удалили на другом устройстве — или она видна, но сервер отказал в
// праве её менять (`view` без `edit_all`). Раньше оба случая уходили из
// очереди с тостом «Применены ваши изменения»: человеку сообщали об успехе,
// а его правка молча пропадала.

describe("replayer — правка, которую сервер не дал применить", () => {
  const enqueueStaleUpdate = () =>
    enqueueOp({
      table: "clients",
      op: "update",
      row_id: UUID_A,
      payload: { full_name: "Mine" },
      expected_updated_at: "2026-01-01T00:00:00.000Z",
    });
  // Первая правка (с `updated_at`) — ноль строк; принудительная
  // (`maybeSingle`) — пусто; чтение видимости — по сценарию теста.
  const refusedUpdate = (visibility: Result) =>
    makeFakeSupabase((rec) => {
      if (rec.op === "update") {
        return rec.usedMaybeSingle
          ? { data: null, error: null }
          : { data: [], error: null };
      }
      return visibility;
    });

  test("строки не видно — операция снята, «применено» не пишется", async () => {
    await enqueueStaleUpdate();
    const { client } = refusedUpdate({ data: null, error: null });

    let toast = "";
    await kickReplayer({
      supabase: asSupabase(client),
      onConflict: (m) => {
        toast = m;
      },
    });

    expect(toast).toBe("");
    expect(await queueDepth()).toBe(0);
  });

  test("строка ВИДНА — сервер отказал, операция остаётся с причиной", async () => {
    await enqueueStaleUpdate();
    const { client } = refusedUpdate({ data: { id: UUID_A }, error: null });

    let toast = "";
    await kickReplayer({
      supabase: asSupabase(client),
      onConflict: (m) => {
        toast = m;
      },
    });

    expect(toast).toBe("");
    const left = await dequeueAll();
    expect(left).toHaveLength(1);
    expect(left[0].attempts).toBe(1);
    expect(left[0].last_error ?? "").toContain("нет прав");
  });

  test("проверка видимости сама упала — операцию не снимаем", async () => {
    await enqueueStaleUpdate();
    const { client } = refusedUpdate({
      data: null,
      error: { message: "network down" },
    });

    let toast = "";
    await kickReplayer({
      supabase: asSupabase(client),
      onConflict: (m) => {
        toast = m;
      },
    });

    expect(toast).toBe("");
    const left = await dequeueAll();
    expect(left).toHaveLength(1);
    expect(left[0].last_error ?? "").toContain("network down");
  });
});

// ─── Гейт держит и уже начатую операцию ────────────────────────────────
// Между проверкой в начале круга и самой отправкой лежат ДВА ожидания: откат
// попытки (до тридцати секунд) и сторож тарифа. За тридцать секунд человек
// успевает сменить компанию, и операция уйдёт под чужим заголовком. Проверка
// в начале нужна, чтобы не НАЧИНАТЬ; эта — чтобы не ДОотправить начатое.

describe("replayer — гейт перепроверяется перед отправкой", () => {
  test("компания сменилась после проверки — операция не уходит", async () => {
    await enqueueOp({
      table: "clients",
      op: "delete",
      row_id: UUID_A,
      payload: { id: UUID_A, tenant_id: TENANT },
      expected_updated_at: null,
    });
    const { client, calls } = makeFakeSupabase(() => ({ data: null, error: null }));

    // Чтения: 1 — гейт слива, 2 — начало круга, 3 — перед самой отправкой.
    let читаний = 0;
    const currentTenantId = (): string | null => {
      читаний += 1;
      return читаний >= 3 ? "33333333-3333-3333-3333-333333333333" : TENANT;
    };

    await kickReplayer({ supabase: asSupabase(client), currentTenantId });

    expect(calls).toHaveLength(0);
    expect(await queueDepth()).toBe(1);
  });
});

// ─── Привязанным клиентом очередь не сливается ─────────────────────────
// Прогрев чужих компаний ходит клиентом с прибитым заголовком. Операция
// АКТИВНОЙ компании, ушедшая под чужим заголовком, у вставки будет отбита
// сервером — а удаление вернёт ноль строк, что честно читается как «удалять
// нечего», и работа тихо пропадёт.

describe("replayer — привязанный к компании клиент", () => {
  test("через него не сливается ничего, очередь цела", async () => {
    await enqueueOp({
      table: "clients",
      op: "delete",
      row_id: UUID_A,
      payload: { id: UUID_A, tenant_id: TENANT },
      expected_updated_at: null,
    });
    const { client, calls } = makeFakeSupabase(() => ({ data: null, error: null }));
    // Клиент объявляет себя привязанным — пусть даже к ТОЙ ЖЕ компании.
    (client as Record<string, unknown>)[BOUND_TENANT_FIELD] = TENANT;

    await kickReplayer({ supabase: asSupabase(client), tenantId: TENANT });

    expect(calls).toHaveLength(0);
    expect(await queueDepth()).toBe(1);
  });
});

// ─── Вид только для чтения подталкивает, сливает клиент хоста ──────────
// Шим постраничного календаря отдаётся обёртке `listAppointments` вместо
// клиента, и её фоновое перечитывание подталкивает выгрузку им же. У шима
// `from()` умеет только `select` — правка записи падала «update is not a
// function» и после трёх попыток пропадала (владелец 03.10: сменил клиента
// записи, через десять секунд вернулся прежний).

describe("replayer — вид только для чтения", () => {
  /** Шим под видом клиента: только `select`, как `pagingClient`. */
  const readOnlyView = () => ({
    [READ_ONLY_VIEW_FIELD]: true,
    from: () => ({ select: () => ({}) }),
  });

  const queueClientChange = () =>
    enqueueOp({
      table: "appointments",
      op: "update",
      row_id: UUID_A,
      payload: { client_id: UUID_B, tenant_id: TENANT },
      expected_updated_at: null,
    });

  test("без клиента хоста — ничего не сливает и не портит, очередь цела", async () => {
    await queueClientChange();
    let permFailed = false;

    await kickReplayer({
      supabase: asSupabase(readOnlyView()),
      tenantId: TENANT,
      onPermanentFailure: () => {
        permFailed = true;
      },
    });

    expect(permFailed).toBe(false);
    const remaining = await dequeueAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].attempts).toBe(0);
  });

  test("с клиентом хоста в умолчаниях — правка уходит им", async () => {
    await queueClientChange();
    const { client, calls } = makeFakeSupabase((rec) =>
      rec.op === "update" ? { data: [{ id: UUID_A }], error: null } : { data: null, error: null },
    );
    setReplayerDefaults({ writeClient: asSupabase(client) });

    await kickReplayer({ supabase: asSupabase(readOnlyView()), tenantId: TENANT });

    expect(await queueDepth()).toBe(0);
    expect(calls.some((c) => c.table === "appointments" && c.op === "update")).toBe(true);
  });
});
