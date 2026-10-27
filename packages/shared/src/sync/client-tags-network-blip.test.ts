// ПРАВКА ТЕГОВ ПРИ ОБРЫВЕ СВЯЗИ — ЧЕСТНЫЙ ОТКАЗ, А НЕ ЛОЖНОЕ «СОХРАНЕНО».
//
// Теги клиента живут в связующей таблице, и очередь офлайна их не несёт:
// маппер строки (`clientToUpdate`) про `tag_ids` не знает. Если сеть упала
// посреди записи, а обёртка положила правку в очередь и вернула успех, —
// в кэше и на плитке стояли новые теги, в очереди их не было, и после
// перечитки с сервера выбор пропадал молча. Поэтому: кэш возвращается к
// прежнему, очередь пуста, вызов падает тем же текстом, что и без сети.
//
// Run: cd packages/shared && bun test src/sync/client-tags-network-blip.test.ts

import { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { MemorySqlAdapter } from "../storage/sql/memory";
import { setNetwork, setSql } from "../storage/sql/provider";
import {
  __resetCacheForTests,
  cacheGetOne,
  cacheUpsert,
  dequeueAll,
  type CachedClientData,
} from "../db/cache/sql";
import { updateClient } from "./clientsCached";
import { __resetReplayerForTests } from "./replayer";
import { createBlankClient } from "../local/clients";

const TENANT = "11111111-1111-1111-1111-111111111111";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OLD_TAG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NEW_TAG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function networkDownSupabase() {
  const fail = () => {
    throw new TypeError("Network request failed");
  };
  return { rpc: fail, from: fail } as never;
}

beforeEach(async () => {
  setNetwork({ isOnline: () => true, subscribe: () => () => {} });
  setSql(new MemorySqlAdapter(new Database(":memory:")));
  __resetCacheForTests();
  __resetReplayerForTests();
  await cacheUpsert("clients", {
    ...createBlankClient({ id: ID, full_name: "Иван", tag_ids: [OLD_TAG] }),
    tenant_id: TENANT,
    updated_at: "2026-10-01T00:00:00.000Z",
  });
});

test("tag edit + network blip: throws, cache rolled back, nothing queued", async () => {
  let error: unknown = null;
  try {
    await updateClient(networkDownSupabase(), ID, { tag_ids: [NEW_TAG] }, TENANT);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("Изменения тегов недоступны без сети — попробуйте позже");
  expect(await dequeueAll()).toEqual([]);
  const cached = await cacheGetOne<CachedClientData>("clients", ID);
  expect(cached?.tag_ids).toEqual([OLD_TAG]);
});

test("tag edit with other fields + network blip: the whole edit is refused", async () => {
  await expect(
    updateClient(networkDownSupabase(), ID, { tag_ids: [NEW_TAG], comment: "дверь с торца" }, TENANT),
  ).rejects.toThrow("Изменения тегов недоступны без сети — попробуйте позже");
  expect(await dequeueAll()).toEqual([]);
  const cached = await cacheGetOne<CachedClientData>("clients", ID);
  expect(cached?.tag_ids).toEqual([OLD_TAG]);
  expect(cached?.comment).toBe("");
});

test("non-tag edit + network blip still queues (offline-first stays)", async () => {
  const res = await updateClient(networkDownSupabase(), ID, { comment: "дверь с торца" }, TENANT);
  expect(res.comment).toBe("дверь с торца");
  const q = await dequeueAll();
  expect(q.length).toBe(1);
  expect(q[0]!.op).toBe("update");
});
