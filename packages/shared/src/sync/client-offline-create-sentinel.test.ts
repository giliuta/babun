// Клиент, заведённый и исправленный без сети, уходит без ложного «конфликта».
//
// Новый клиент встаёт на сервер функцией `create_client_with_tags`, и версию
// строки (`updated_at`) ставит сервер своим `now()`. Правка, поставленная в
// очередь следом, несёт сторожем время телефона из оптимистичной строки — на
// сервере такой версии нет: ноль строк, силовая запись и тост «Запись была
// обновлена на другом устройстве», хотя клиента никто не трогал. Поэтому
// после вставки версия сервера передаётся ждущим правкам строки и кэшу.
//
// Поддельный сервер ниже ставит свою версию на вставке и на каждом UPDATE, а
// условное обновление совпадает только с текущей версией.
//
// Run: cd packages/shared && bun test src/sync/client-offline-create-sentinel.test.ts

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { MemorySqlAdapter } from "../storage/sql/memory";
import { setNetwork, setSql, NavigatorOnlineNetwork } from "../storage/sql/provider";
import {
  __resetCacheForTests,
  cacheGetOne,
  dequeueAll,
  type CachedClientData,
} from "../db/cache/sql";
import { createClient, updateClient } from "./clientsCached";
import { __resetReplayerForTests, kickReplayer } from "./replayer";
import { createBlankClient } from "../local/clients";

const TENANT = "11111111-1111-1111-1111-111111111111";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Call = { op: string; filters: Record<string, unknown> };

function serverStampingRpc() {
  let version: string | null = null;
  let bump = 0;
  const calls: Call[] = [];
  const stamp = () => `2026-10-16T09:00:0${++bump}.123456+00:00`;
  const client = {
    rpc: (name: string) => {
      calls.push({ op: `rpc:${name}`, filters: {} });
      if (name === "create_client_with_tags") version = stamp();
      return Promise.resolve({ data: {}, error: null });
    },
    from() {
      const call: Call = { op: "select", filters: {} };
      calls.push(call);
      const row = () => ({ id: ID, tenant_id: TENANT, full_name: "Иван", updated_at: version, deleted_at: null });
      const resolve = (single: boolean) => {
        if (call.op === "update") {
          const guard = call.filters.updated_at;
          if (guard !== undefined && guard !== version) return { data: single ? null : [], error: null };
          version = stamp();
          return { data: single ? row() : [row()], error: null };
        }
        return { data: row(), error: null };
      };
      const chain: Record<string, unknown> = {};
      chain.update = () => {
        call.op = "update";
        return chain;
      };
      chain.select = () => chain;
      chain.eq = (col: string, val: unknown) => {
        call.filters[col] = val;
        return chain;
      };
      chain.maybeSingle = () => Promise.resolve(resolve(true));
      chain.single = () => Promise.resolve(resolve(true));
      chain.then = (
        onFulfilled: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(resolve(false)).then(onFulfilled, onRejected);
      return chain;
    },
  };
  return { client: client as never, calls, version: () => version };
}

beforeEach(() => {
  setSql(new MemorySqlAdapter(new Database(":memory:")));
  setNetwork({ isOnline: () => false, subscribe: () => () => {} });
  __resetCacheForTests();
  __resetReplayerForTests();
});
afterEach(() => {
  __resetCacheForTests();
  __resetReplayerForTests();
  setNetwork(new NavigatorOnlineNetwork());
});

test("создание и правка без сети: правка ложится условно, без «конфликта»", async () => {
  await createClient({} as never, createBlankClient({ id: ID, full_name: "Иван" }), TENANT);
  await updateClient({} as never, ID, { comment: "дверь с торца" }, TENANT);
  expect(await dequeueAll()).toHaveLength(2);

  const server = serverStampingRpc();
  const conflicts: string[] = [];
  await kickReplayer({
    supabase: server.client,
    tenantId: TENANT,
    onConflict: (message) => conflicts.push(message),
  });

  expect(conflicts).toEqual([]);
  expect(await dequeueAll()).toEqual([]);
  // Одна правка, условная, совпала с первого раза: силовой записи нет.
  const updates = server.calls.filter((call) => call.op === "update");
  expect(updates).toHaveLength(1);
  expect(updates[0]!.filters.updated_at).toBeDefined();
  const cached = await cacheGetOne<CachedClientData>("clients", ID, TENANT);
  expect(cached!.updated_at).toBe(server.version()!);
});
