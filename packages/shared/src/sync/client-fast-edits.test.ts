// ДВЕ БЫСТРЫЕ ПРАВКИ ОДНОЙ КАРТОЧКИ — НЕ «ИЗМЕНИЛИ НА ДРУГОМ УСТРОЙСТВЕ» (С10).
//
// Защита версий сверяет `updated_at` сервера с кэшем перед записью массива.
// Две правки подряд брали одну и ту же версию из кэша: первая сохранялась и
// двигала версию, вторая отказывала как «чужая правка». Теперь правки одного
// клиента идут по очереди, и вторая берёт версию, которую оставила первая.
//
// Run: cd packages/shared && bun test src/sync/client-fast-edits.test.ts

import { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { MemorySqlAdapter } from "../storage/sql/memory";
import { setNetwork, setSql } from "../storage/sql/provider";
import { __resetCacheForTests, cacheGetOne, cacheUpsert } from "../db/cache/sql";
import type { CachedClientData } from "../db/cache/sql";
import { updateClient } from "./clientsCached";
import { serializeClientWrite } from "./clientsCached/write";
import { __resetReplayerForTests } from "./replayer";
import { createBlankClient } from "../local/clients";

const TENANT = "11111111-1111-1111-1111-111111111111";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Сервер, у которого каждая правка двигает версию строки. */
function versioningServer() {
  let version = 1;
  const at = () => `2026-10-0${version}T00:00:00.000Z`;
  const row = () => ({
    ...createBlankClient({ id: ID, full_name: "Иван" }),
    tenant_id: TENANT,
    updated_at: at(),
  });
  const query = () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = () => chain;
    // Чтение строки идёт по сети не мгновенно: перечитка первой правки ещё
    // в пути, когда вторая сверяет версию.
    const slow = () =>
      new Promise((resolve) => setTimeout(() => resolve({ data: row(), error: null }), 10));
    chain.maybeSingle = slow;
    chain.single = slow;
    chain.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return chain;
  };
  const client = {
    from: () => query(),
    rpc: async () => {
      version += 1;
      return { data: { ...row(), tag_ids: [] }, error: null };
    },
  };
  return { client: client as never, version: () => version };
}

beforeEach(async () => {
  setNetwork({ isOnline: () => true, subscribe: () => () => {} });
  setSql(new MemorySqlAdapter(new Database(":memory:")));
  __resetCacheForTests();
  __resetReplayerForTests();
  await cacheUpsert("clients", {
    ...createBlankClient({ id: ID, full_name: "Иван" }),
    tenant_id: TENANT,
    updated_at: "2026-10-01T00:00:00.000Z",
  });
});

test("номер, потом объект — обе правки сохраняются, отказа нет", async () => {
  const server = versioningServer();
  const first = updateClient(server.client, ID, { phones: [{ id: "p1", number: "+35799000000" } as never] }, TENANT);
  // Вторая — посреди первой: её версия уже на сервере, а в кэше ещё прежняя.
  await new Promise((resolve) => setTimeout(resolve, 15));
  const second = updateClient(server.client, ID, { locations: [{ id: "loc-1" } as never] }, TENANT);
  await expect(first).resolves.toBeDefined();
  await expect(second).resolves.toBeDefined();
  expect(server.version()).toBe(3);
  const cached = await cacheGetOne<CachedClientData>("clients", ID);
  expect(cached?.updated_at).toBe("2026-10-03T00:00:00.000Z");
});

test("очередь — на одного клиента; сбой предыдущей её не останавливает", async () => {
  const order: string[] = [];
  const slow = serializeClientWrite(ID, async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push("A1");
    throw new Error("сбой");
  });
  const other = serializeClientWrite(OTHER, async () => {
    order.push("B");
  });
  const next = serializeClientWrite(ID, async () => {
    order.push("A2");
  });
  await expect(slow).rejects.toThrow("сбой");
  await other;
  await next;
  expect(order).toEqual(["B", "A1", "A2"]);
});
