// STORY-062 slice 5 — bun unit test for the cache-of-DOMAIN projection.
//
// Run: cd packages/shared && bun test src/sync/cachedWrappers.test.ts
//
// Locks down the slice-5 invariant: the offline wrappers store the FULL
// DOMAIN object in the cache `data` column (so an online/offline read is
// byte-identical to a live repo read — tag_ids + nested fields intact),
// while the QUEUE PAYLOAD stays the RAW DB-column projection the replayer
// relays to PostgREST (no tag_ids, no domain-only fields). The two
// projections must never bleed into each other.
//
// Driven offline (a stub NetworkAdapter forced to isOnline()=false) so the
// wrappers take the enqueue-only path and never touch the (stub) Supabase.

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MemorySqlAdapter } from "../storage/sql/memory";
import {
  setSql,
  setNetwork,
  NavigatorOnlineNetwork,
} from "../storage/sql/provider";
import type { NetworkAdapter } from "../storage/sql/types";
import { __resetCacheForTests, cacheRead, dequeueAll } from "../db/cache/sql";
import {
  createClient,
  updateClient,
  listClients,
} from "./clientsCached";
import {
  createAppointment,
  updateAppointment,
  listAppointments,
} from "./appointmentsCached";
import { createBlankClient } from "../local/clients";
import { createBlankAppointment } from "../local/appointments";
import type { Client } from "../local/clients";
import type { Appointment } from "../local/appointments";

const TENANT = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APPT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Force the wrappers offline so create/update take the enqueue-only path
 *  (never touching the stub Supabase). */
class OfflineNetwork implements NetworkAdapter {
  isOnline(): boolean {
    return false;
  }
  subscribe(_cb: (online: boolean) => void): () => void {
    return () => {};
  }
}

// The offline path never calls Supabase; a bare stub satisfies the type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stubSupabase = {} as any;

beforeEach(() => {
  setSql(new MemorySqlAdapter(new Database(":memory:")));
  setNetwork(new OfflineNetwork());
  __resetCacheForTests();
});
afterEach(() => {
  __resetCacheForTests();
  // Restore the default (navigator) network detector so this suite can't
  // leave the process pinned offline for anything that runs after it.
  setNetwork(new NavigatorOnlineNetwork());
});

describe("clients cache-of-domain", () => {
  test("offline create caches the FULL domain (tag_ids + nested) but queues a RAW payload", async () => {
    const input: Client = createBlankClient({
      id: CLIENT_ID,
      full_name: "Иван",
      phone: "+35799000000",
      tag_ids: ["tag-vip", "tag-regular"],
      phones: [{ id: "p1", number: "+35799111111", label: "моб", name: "Иван" }],
      locations: [
        {
          id: "loc1",
          label: "Дом",
          address: "Лимассол",
          isPrimary: true,
          equipment: [
            {
              id: "u1",
              room: "спальня",
              ac_type: "split",
              has_indoor: true,
              has_outdoor: true,
            },
          ],
        },
      ],
      notes: [{ id: "n1", text: "звонить после 18", created_at: "2026-01-01" }],
    });

    await createClient(stubSupabase, input, TENANT);

    // 1. Cache holds the FULL domain object — reading it back via the SWR
    //    list returns tag_ids + nested fields verbatim.
    const listed = await listClients(stubSupabase, TENANT);
    expect(listed).toHaveLength(1);
    const c = listed[0]!;
    expect(c.id).toBe(CLIENT_ID);
    expect(c.tag_ids).toEqual(["tag-vip", "tag-regular"]);
    expect(c.phones).toHaveLength(1);
    expect(c.phones[0]!.number).toBe("+35799111111");
    expect(c.locations[0]!.equipment).toHaveLength(1);
    expect(c.notes[0]!.text).toBe("звонить после 18");
    // The domain read must NOT leak the cache bookkeeping keys.
    expect((c as Record<string, unknown>).tenant_id).toBeUndefined();
    expect((c as Record<string, unknown>).updated_at).toBeUndefined();

    // 2. Raw cache row (what physically lands in `data`) carries the
    //    denorm keys the SQL layer needs.
    const raw = await cacheRead<Record<string, unknown>>("clients", TENANT);
    expect(raw[0]!.tenant_id).toBe(TENANT);
    expect(typeof raw[0]!.updated_at).toBe("string");

    // 3. The QUEUE PAYLOAD is the RAW server projection — NO tag_ids
    //    (junction table, written online), and it carries the raw columns.
    const [op] = await dequeueAll();
    expect(op!.op).toBe("insert");
    expect(op!.row_id).toBe(CLIENT_ID);
    expect(op!.payload.tag_ids).toBeUndefined();
    expect(op!.payload.tenant_id).toBe(TENANT);
    expect(op!.payload.full_name).toBe("Иван");
    // Nested jsonb columns ARE part of the server row (phones/locations/…
    // live on the clients table); tag membership does NOT.
    expect(Array.isArray(op!.payload.phones)).toBe(true);
  });

  test("offline update merges into the cached domain; queue payload stays raw", async () => {
    // Seed a client in the cache first (offline create).
    await createClient(
      stubSupabase,
      createBlankClient({
        id: CLIENT_ID,
        full_name: "Иван",
        tag_ids: ["tag-vip"],
      }),
      TENANT,
    );

    // Patch a scalar (not tag_ids — those are stripped offline).
    await updateClient(stubSupabase, CLIENT_ID, { full_name: "Пётр" }, TENANT);

    // Cache reflects the patch AND preserves the pre-existing tag_ids.
    const listed = await listClients(stubSupabase, TENANT);
    const c = listed[0]!;
    expect(c.full_name).toBe("Пётр");
    expect(c.tag_ids).toEqual(["tag-vip"]); // untouched by the scalar patch

    // The update op payload is the raw patch projection — no tag_ids.
    const ops = await dequeueAll();
    const updateOp = ops.find((o) => o.op === "update")!;
    expect(updateOp).toBeDefined();
    expect(updateOp.payload.full_name).toBe("Пётр");
    expect(updateOp.payload.tag_ids).toBeUndefined();
  });

  test("offline tag_ids patch is stripped from BOTH cache merge and queue", async () => {
    await createClient(
      stubSupabase,
      createBlankClient({ id: CLIENT_ID, tag_ids: ["tag-vip"] }),
      TENANT,
    );

    // Offline tag edits are unsupported (junction not cached) → stripped.
    await updateClient(
      stubSupabase,
      CLIENT_ID,
      { tag_ids: ["tag-new"], comment: "left a note" },
      TENANT,
    );

    const c = (await listClients(stubSupabase, TENANT))[0]!;
    // tag_ids stayed at the original value (patch dropped); comment applied.
    expect(c.tag_ids).toEqual(["tag-vip"]);
    expect(c.comment).toBe("left a note");

    const updateOp = (await dequeueAll()).find((o) => o.op === "update")!;
    expect(updateOp.payload.tag_ids).toBeUndefined();
    expect(updateOp.payload.comment).toBe("left a note");
  });
});

describe("appointments cache-of-domain", () => {
  test("offline create caches the full domain (nested fields) and queues a raw payload", async () => {
    const input: Appointment = createBlankAppointment({
      id: APPT_ID,
      date: "2026-07-10",
      time_start: "09:00",
      time_end: "10:00",
      services: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: "s1", name: "Чистка", price: 50, duration: 60 } as any,
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expenses: [{ id: "e1", label: "фреон", amount: 10 } as any],
      service_ids: ["svc-1", "svc-2"],
    });

    await createAppointment(stubSupabase, input, TENANT);

    const listed = await listAppointments(stubSupabase, TENANT);
    expect(listed).toHaveLength(1);
    const a = listed[0]!;
    expect(a.id).toBe(APPT_ID);
    expect(a.date).toBe("2026-07-10");
    expect(a.services).toHaveLength(1);
    expect(a.expenses).toHaveLength(1);
    expect(a.service_ids).toEqual(["svc-1", "svc-2"]);
    // No leaked bookkeeping key.
    expect((a as Record<string, unknown>).tenant_id).toBeUndefined();

    // Raw cache row carries the denorm keys (tenant_id / date / updated_at).
    const raw = await cacheRead<Record<string, unknown>>("appointments", TENANT);
    expect(raw[0]!.tenant_id).toBe(TENANT);
    expect(raw[0]!.date).toBe("2026-07-10");
    expect(typeof raw[0]!.updated_at).toBe("string");

    // Queue payload is the raw server row.
    const [op] = await dequeueAll();
    expect(op!.op).toBe("insert");
    expect(op!.row_id).toBe(APPT_ID);
    expect(op!.payload.tenant_id).toBe(TENANT);
    expect(op!.payload.date).toBe("2026-07-10");
    expect(Array.isArray(op!.payload.services)).toBe(true);
  });

  test("offline update merges into the cached domain; queue carries the raw patch", async () => {
    await createAppointment(
      stubSupabase,
      createBlankAppointment({
        id: APPT_ID,
        date: "2026-07-10",
        time_start: "09:00",
        time_end: "10:00",
        service_ids: ["svc-1"],
      }),
      TENANT,
    );

    await updateAppointment(
      stubSupabase,
      APPT_ID,
      { status: "completed", comment: "готово" },
      TENANT,
    );

    const a = (await listAppointments(stubSupabase, TENANT))[0]!;
    expect(a.status).toBe("completed");
    expect(a.comment).toBe("готово");
    // Pre-existing nested field survived the merge.
    expect(a.service_ids).toEqual(["svc-1"]);

    const updateOp = (await dequeueAll()).find((o) => o.op === "update")!;
    expect(updateOp.payload.status).toBe("completed");
    expect(updateOp.payload.comment).toBe("готово");
  });
});
