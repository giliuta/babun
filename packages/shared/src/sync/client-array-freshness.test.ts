// МАССИВ КЛИЕНТА НЕ ПИШЕТСЯ ПОВЕРХ БОЛЕЕ СВЕЖЕЙ СТРОКИ.
//
// Объекты, телефоны, заметки клиента — одна jsonb-колонка на массив, правка
// пишет его целиком. Телефон А собрал массив из старой версии, а телефон Б
// тем временем добавил объект: запись А стёрла бы его. Перед записью массива
// обёртка сверяет `updated_at` сервера с кэшем; ушёл — не пишет, кэш берёт
// строку сервера, человек видит свежую.
//
// Run: cd packages/shared && bun test src/sync/client-array-freshness.test.ts

import { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { MemorySqlAdapter } from "../storage/sql/memory";
import { setNetwork, setSql } from "../storage/sql/provider";
import { __resetCacheForTests, cacheGetOne, cacheUpsert, dequeueAll } from "../db/cache/sql";
import type { CachedClientData } from "../db/cache/sql";
import { updateClient } from "./clientsCached";
import { ClientNewerOnServerError } from "./clientsCached/write";
import { __resetReplayerForTests } from "./replayer";
import { createBlankClient } from "../local/clients";

const TENANT = "11111111-1111-1111-1111-111111111111";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CACHED_AT = "2026-10-01T00:00:00.000Z";
const SERVER_AT = "2026-10-02T00:00:00.000Z";

/** Сервер с одной строкой клиента: чтение штампа и строки, правка — RPC. */
function fakeServer(serverUpdatedAt: string) {
  const rpcCalls: string[] = [];
  const row = {
    ...createBlankClient({ id: ID, full_name: "Иван" }),
    tenant_id: TENANT,
    locations: [{ id: "loc-1" }, { id: "loc-2" }],
    updated_at: serverUpdatedAt,
  };
  const query = () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = () => chain;
    chain.maybeSingle = () => Promise.resolve({ data: row, error: null });
    chain.single = () => Promise.resolve({ data: row, error: null });
    chain.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return chain;
  };
  const client = {
    from: () => query(),
    rpc: (name: string) => {
      rpcCalls.push(name);
      return Promise.resolve({ data: { ...row, tag_ids: [] }, error: null });
    },
  };
  return { client: client as never, rpcCalls };
}

beforeEach(async () => {
  setNetwork({ isOnline: () => true, subscribe: () => () => {} });
  setSql(new MemorySqlAdapter(new Database(":memory:")));
  __resetCacheForTests();
  __resetReplayerForTests();
  await cacheUpsert("clients", {
    ...createBlankClient({ id: ID, full_name: "Иван" }),
    tenant_id: TENANT,
    updated_at: CACHED_AT,
  });
});

test("строку изменили на сервере — массив не пишется, кэш берёт строку сервера", async () => {
  const { client, rpcCalls } = fakeServer(SERVER_AT);
  let error: unknown = null;
  try {
    await updateClient(client, ID, { locations: [{ id: "loc-1" } as never] }, TENANT);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(ClientNewerOnServerError);
  expect((error as Error).message).toBe(
    "Карточку клиента изменили на другом устройстве — показываю свежую версию",
  );
  expect(rpcCalls).toEqual([]);
  expect(await dequeueAll()).toEqual([]);
  const cached = await cacheGetOne<CachedClientData>("clients", ID);
  expect(cached?.updated_at).toBe(SERVER_AT);
});

test("версия совпадает — массив уходит как раньше", async () => {
  const { client, rpcCalls } = fakeServer(CACHED_AT);
  await updateClient(client, ID, { locations: [{ id: "loc-1" } as never] }, TENANT);
  expect(rpcCalls).toEqual(["update_client_with_tags"]);
});

test("правка простого поля версию не сверяет — пишет только своё поле", async () => {
  const { client, rpcCalls } = fakeServer(SERVER_AT);
  await updateClient(client, ID, { full_name: "Пётр" }, TENANT);
  expect(rpcCalls).toEqual(["update_client_with_tags"]);
});
