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
import {
  __resetCacheForTests,
  cacheRead,
  cacheReplaceTenant,
  dequeueAll,
} from "../db/cache/sql";
import {
  createClient,
  updateClient,
  listClients,
  listArchivedClients,
  listTrashedClients,
  archiveClient,
  restoreClient,
} from "./clientsCached";
import {
  createAppointment,
  deleteAppointment,
  updateAppointment,
  listAppointments,
} from "./appointmentsCached";
import {
  createClientTag,
  deleteClientTag,
  updateClientTag,
} from "./tagsCached";
import { createBlankClient } from "../local/clients";
import { createBlankAppointment } from "../local/appointments";
import type { Client } from "../local/clients";
import type { Appointment } from "../local/appointments";
import { ColdOfflineCacheMissError } from "./cache-errors";

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

class OnlineNetwork implements NetworkAdapter {
  isOnline(): boolean {
    return true;
  }
  subscribe(_cb: (online: boolean) => void): () => void {
    return () => {};
  }
}

function semanticRejectSupabase() {
  const result = {
    data: null,
    error: {
      code: "42501",
      message: "row-level security policy rejected this write",
    },
  };
  return {
    rpc() {
      return Promise.resolve(result);
    },
    from() {
      const chain: Record<string, unknown> = {};
      chain.update = () => chain;
      chain.delete = () => chain;
      chain.insert = () => chain;
      chain.eq = () => chain;
      chain.select = () => chain;
      chain.single = () => Promise.resolve(result);
      chain.maybeSingle = () => Promise.resolve(result);
      chain.then = (
        onFulfilled: (value: typeof result) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(result).then(onFulfilled, onRejected);
      return chain;
    },
  };
}

function emptyClientSnapshotSupabase() {
  let readPages = 0;
  return {
    client: {
      from() {
        let write = false;
        const readResult = { data: [], error: null };
        const writeResult = {
          data: null,
          error: { status: 503, message: "service unavailable" },
        };
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.is = () => chain;
        chain.order = () => chain;
        chain.insert = () => {
          write = true;
          return chain;
        };
        chain.range = () => {
          readPages += 1;
          return Promise.resolve(readResult);
        };
        chain.then = (
          onFulfilled: (value: typeof readResult | typeof writeResult) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) =>
          Promise.resolve(write ? writeResult : readResult).then(
            onFulfilled,
            onRejected,
          );
        return chain;
      },
    },
    readPages: () => readPages,
  };
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
  test("reconnect revalidation preserves a client whose offline insert is pending", async () => {
    await createClient(
      stubSupabase,
      createBlankClient({ id: CLIENT_ID, full_name: "Оффлайн" }),
      TENANT,
    );
    setNetwork(new OnlineNetwork());
    const server = emptyClientSnapshotSupabase();

    const listed = await listClients(server.client as never, TENANT);
    expect(listed.map((row) => row.id)).toEqual([CLIENT_ID]);
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(server.readPages()).toBe(0);
    const cached = await cacheRead<Record<string, unknown>>("clients", TENANT);
    expect(cached.map((row) => row.id)).toEqual([CLIENT_ID]);
  });

  test("cold offline cache miss is unknown, not an empty client list", async () => {
    await expect(listClients(stubSupabase, TENANT)).rejects.toBeInstanceOf(
      ColdOfflineCacheMissError,
    );
  });

  test("an authoritative empty client snapshot remains usable offline", async () => {
    await cacheReplaceTenant("clients", TENANT, []);
    expect(await listClients(stubSupabase, TENANT)).toEqual([]);
  });

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
    expect(op!.payload.__tag_ids).toEqual(["tag-vip", "tag-regular"]);
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

  test("offline archive queues UPDATE deleted_at, hides the row, and restore rehydrates it", async () => {
    const client = createBlankClient({
      id: CLIENT_ID,
      full_name: "История сохранена",
    });
    await createClient(stubSupabase, client, TENANT);

    await archiveClient(stubSupabase, CLIENT_ID, TENANT);
    // СТРОКА ОСТАЁТСЯ В КЭШЕ С ПОМЕТКОЙ. Раньше здесь стоял `toEqual([])`:
    // кэш стирал архивного клиента, и, пока операция ждала сети, его не
    // видел НИКТО — ни рабочий список, ни экран архива (тот читал прямо с
    // сервера, где клиент ещё числился живым). Владелец 2026-08-08:
    // «заархивировал — куда он делся». Теперь он всегда где-то виден.
    const cached = (await cacheRead("clients", TENANT)) as Array<{
      id: string;
      deleted_at: string | null;
      purge_at: string | null;
    }>;
    expect(cached).toHaveLength(1);
    expect(cached[0]!.id).toBe(CLIENT_ID);
    expect(typeof cached[0]!.deleted_at).toBe("string");
    // Архив — без срока стирания: это не корзина.
    expect(cached[0]!.purge_at).toBeNull();
    // This test started from a local-only create, not a server snapshot. Once
    // its sole row is archived, [] is still unknown until first sync.
    await expect(listClients(stubSupabase, TENANT)).rejects.toBeInstanceOf(
      ColdOfflineCacheMissError,
    );

    const archivedOp = (await dequeueAll()).find(
      (op) => op.op === "update" && typeof op.payload.deleted_at === "string",
    );
    expect(archivedOp).toBeDefined();
    expect(archivedOp!.row_id).toBe(CLIENT_ID);
    expect(
      (await dequeueAll()).some(
        (op) => op.row_id === CLIENT_ID && op.op === "delete",
      ),
    ).toBe(false);

    await restoreClient(
      stubSupabase,
      { ...client, deleted_at: "2026-07-20T00:00:00.000Z" },
      TENANT,
    );
    const [restored] = await listClients(stubSupabase, TENANT);
    expect(restored!.id).toBe(CLIENT_ID);
    expect(restored!.deleted_at).toBeNull();
    expect(
      (await dequeueAll()).some(
        (op) => op.op === "update" && op.payload.deleted_at === null,
      ),
    ).toBe(true);
  });

  // ТА САМАЯ ДЫРА, из-за которой владелец не нашёл клиента: архивация без
  // сети убирала его из рабочего списка, а экран архива читал напрямую с
  // сервера — и не показывал ничего. Клиента не было НИГДЕ до синхронизации.
  test("архивация без сети сразу видна в архиве, а не пропадает до синка", async () => {
    await createClient(
      stubSupabase,
      createBlankClient({ id: CLIENT_ID, full_name: "Ушёл в архив" }),
      TENANT,
    );

    await archiveClient(stubSupabase, CLIENT_ID, TENANT);

    const archived = await listArchivedClients(stubSupabase, TENANT);
    expect(archived.map((c) => c.id)).toEqual([CLIENT_ID]);
    expect(archived[0]!.full_name).toBe("Ушёл в архив");
    // В корзине его нет: архив и корзина — разные полки.
    expect(await listTrashedClients(stubSupabase, TENANT)).toEqual([]);
  });

  test("удаление без сети кладёт клиента в корзину со сроком, а не в архив", async () => {
    await createClient(
      stubSupabase,
      createBlankClient({ id: CLIENT_ID, full_name: "Удалён" }),
      TENANT,
    );

    const purgeAt = "2026-09-07T10:00:00.000Z";
    await archiveClient(stubSupabase, CLIENT_ID, TENANT, purgeAt);

    const trashed = await listTrashedClients(stubSupabase, TENANT);
    expect(trashed.map((c) => c.id)).toEqual([CLIENT_ID]);
    expect(trashed[0]!.purge_at).toBe(purgeAt);
    // И он НЕ в архиве: срок стирания разводит полки.
    expect(await listArchivedClients(stubSupabase, TENANT)).toEqual([]);
    // Очередь несёт обе даты — сервер узнает и о сроке.
    const op = (await dequeueAll()).find(
      (o) => o.op === "update" && o.payload.purge_at === purgeAt,
    );
    expect(op).toBeDefined();
  });

  test("возврат из корзины снимает и срок стирания, а не только скрытость", async () => {
    const client = createBlankClient({ id: CLIENT_ID, full_name: "Вернули" });
    await createClient(stubSupabase, client, TENANT);
    await archiveClient(
      stubSupabase,
      CLIENT_ID,
      TENANT,
      "2026-09-07T10:00:00.000Z",
    );

    await restoreClient(
      stubSupabase,
      { ...client, deleted_at: "2026-08-08T10:00:00.000Z", purge_at: "2026-09-07T10:00:00.000Z" },
      TENANT,
    );

    const [back] = await listClients(stubSupabase, TENANT);
    expect(back!.id).toBe(CLIENT_ID);
    expect(back!.deleted_at).toBeNull();
    // Иначе клиент вернулся бы в работу с тикающим сроком — и однажды исчез
    // бы посреди рабочего списка.
    expect(back!.purge_at).toBeNull();
    expect(await listTrashedClients(stubSupabase, TENANT)).toEqual([]);
  });

  test("online semantic update rejection rolls back cache and is never queued", async () => {
    await createClient(
      stubSupabase,
      createBlankClient({ id: CLIENT_ID, full_name: "До изменения" }),
      TENANT,
    );
    const queuedBefore = (await dequeueAll()).length;
    setNetwork(new OnlineNetwork());

    await expect(
      updateClient(
        semanticRejectSupabase() as never,
        CLIENT_ID,
        { full_name: "Ложный optimistic" },
        TENANT,
      ),
    ).rejects.toThrow("row-level security");

    const [cached] = await cacheRead<Record<string, unknown>>("clients", TENANT);
    expect(cached?.full_name).toBe("До изменения");
    expect((await dequeueAll()).length).toBe(queuedBefore);
  });
});

describe("appointments cache-of-domain", () => {
  test("cold offline cache miss is unknown, not a free calendar", async () => {
    await expect(
      listAppointments(stubSupabase, TENANT),
    ).rejects.toBeInstanceOf(ColdOfflineCacheMissError);
  });

  test("an authoritative empty calendar snapshot remains usable offline", async () => {
    await cacheReplaceTenant("appointments", TENANT, []);
    expect(await listAppointments(stubSupabase, TENANT)).toEqual([]);
  });

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

  test("online semantic update rejection restores the canonical appointment", async () => {
    await createAppointment(
      stubSupabase,
      createBlankAppointment({
        id: APPT_ID,
        date: "2026-07-10",
        time_start: "09:00",
        time_end: "10:00",
        comment: "Исходная заметка",
      }),
      TENANT,
    );
    const queuedBefore = (await dequeueAll()).length;
    setNetwork(new OnlineNetwork());

    await expect(
      updateAppointment(
        semanticRejectSupabase() as never,
        APPT_ID,
        { comment: "Ложная заметка" },
        TENANT,
      ),
    ).rejects.toThrow("row-level security");

    const [cached] = await cacheRead<Record<string, unknown>>(
      "appointments",
      TENANT,
    );
    expect(cached?.comment).toBe("Исходная заметка");
    expect((await dequeueAll()).length).toBe(queuedBefore);
  });

  test("online semantic delete rejection restores the appointment", async () => {
    await createAppointment(
      stubSupabase,
      createBlankAppointment({
        id: APPT_ID,
        date: "2026-07-10",
        time_start: "09:00",
        time_end: "10:00",
      }),
      TENANT,
    );
    const queuedBefore = (await dequeueAll()).length;
    setNetwork(new OnlineNetwork());

    await expect(
      deleteAppointment(semanticRejectSupabase() as never, APPT_ID, TENANT),
    ).rejects.toThrow("row-level security");

    const cached = await cacheRead<Record<string, unknown>>(
      "appointments",
      TENANT,
    );
    expect(cached.some((row) => row.id === APPT_ID)).toBe(true);
    expect((await dequeueAll()).length).toBe(queuedBefore);
  });
});

describe("client tags offline and semantic failures", () => {
  test("offline create keeps one stable UUID in cache and replay payload", async () => {
    const created = await createClientTag(
      stubSupabase,
      { name: "VIP", color: "#3366ff" },
      TENANT,
    );
    const [cached] = await cacheRead<Record<string, unknown>>("tags", TENANT);
    const [op] = await dequeueAll();

    expect(cached?.id).toBe(created.id);
    expect(op?.row_id).toBe(created.id);
    expect(op?.payload.id).toBe(created.id);
  });

  test("online semantic create rejection removes the optimistic tag", async () => {
    setNetwork(new OnlineNetwork());
    await expect(
      createClientTag(
        semanticRejectSupabase() as never,
        { name: "Запрещено", color: "#3366ff" },
        TENANT,
      ),
    ).rejects.toThrow("row-level security");

    expect(await cacheRead("tags", TENANT)).toEqual([]);
    expect(await dequeueAll()).toEqual([]);
  });

  test("online semantic update and delete restore the cached tag", async () => {
    const created = await createClientTag(
      stubSupabase,
      { name: "Исходная", color: "#3366ff" },
      TENANT,
    );
    const queuedBefore = (await dequeueAll()).length;
    setNetwork(new OnlineNetwork());

    await expect(
      updateClientTag(
        semanticRejectSupabase() as never,
        created.id,
        { name: "Ложная" },
        TENANT,
      ),
    ).rejects.toThrow("row-level security");
    let [cached] = await cacheRead<Record<string, unknown>>("tags", TENANT);
    expect(cached?.name).toBe("Исходная");

    await expect(
      deleteClientTag(
        semanticRejectSupabase() as never,
        created.id,
        TENANT,
      ),
    ).rejects.toThrow("row-level security");
    [cached] = await cacheRead<Record<string, unknown>>("tags", TENANT);
    expect(cached?.id).toBe(created.id);
    expect((await dequeueAll()).length).toBe(queuedBefore);
  });
});
