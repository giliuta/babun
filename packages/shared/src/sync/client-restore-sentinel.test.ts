// Офлайн-возврат клиента из архива не рождает ложного «конфликта».
//
// Возврат клал в кэш версию строки = время телефона и уходил в очередь без
// сторожа (`expected_updated_at: null`). Сервер на UPDATE ставит своё `now()`
// (триггер `clients_set_updated_at`), а в кэше оставалось время телефона —
// следующая офлайн-правка того же клиента несла версию, которой на сервере
// нет, ловила ноль строк, силовую запись и тост «Запись была обновлена на
// другом устройстве», хотя клиента никто не трогал.
//
// Поддельный сервер ниже ведёт себя как триггер: каждое обновление ставит
// строке новую версию, а условное обновление совпадает только с текущей.
//
// Run: cd packages/shared && bun test src/sync/client-restore-sentinel.test.ts

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
  cacheGetOne,
  cacheUpsert,
  dequeueAll,
  type CachedClientData,
} from "../db/cache/sql";
import { restoreClient, updateClient } from "./clientsCached";
import { __resetReplayerForTests, kickReplayer } from "./replayer";
import { createBlankClient } from "../local/clients";

const TENANT = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SERVER_V1 = "2026-10-01T09:00:00.000000+00:00";

class OfflineNetwork implements NetworkAdapter {
  isOnline(): boolean {
    return false;
  }
  subscribe(_cb: (online: boolean) => void): () => void {
    return () => {};
  }
}

type Call = { op: string; filters: Record<string, unknown> };

/** Сервер с триггером `updated_at`: версия меняется на каждом UPDATE. */
function serverWithUpdatedAtTrigger(initial: string) {
  let version = initial;
  let bump = 0;
  const calls: Call[] = [];
  const nextVersion = () => `2026-10-01T10:00:0${++bump}.000000+00:00`;
  const client = {
    from() {
      const call: Call = { op: "select", filters: {} };
      calls.push(call);
      const resolve = () => {
        if (call.op === "update") {
          const guard = call.filters.updated_at;
          if (guard !== undefined && guard !== version) return { data: [], error: null };
          version = nextVersion();
          return { data: [{ id: CLIENT_ID, updated_at: version }], error: null };
        }
        return {
          data: { id: CLIENT_ID, tenant_id: TENANT, updated_at: version, deleted_at: null },
          error: null,
        };
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
      chain.maybeSingle = () => Promise.resolve(resolve());
      chain.single = () => Promise.resolve(resolve());
      chain.then = (
        onFulfilled: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(resolve()).then(onFulfilled, onRejected);
      return chain;
    },
  };
  return { client: client as never, calls, version: () => version };
}

async function seedArchivedClient(): Promise<void> {
  // Снимок сервера: клиент в архиве, версия строки — серверная.
  const row: CachedClientData = {
    ...createBlankClient({ id: CLIENT_ID, full_name: "Вернули" }),
    deleted_at: "2026-09-30T10:00:00.000Z",
    tenant_id: TENANT,
    updated_at: SERVER_V1,
  };
  await cacheUpsert("clients", row);
}

beforeEach(() => {
  setSql(new MemorySqlAdapter(new Database(":memory:")));
  setNetwork(new OfflineNetwork());
  __resetCacheForTests();
  __resetReplayerForTests();
});
afterEach(() => {
  __resetCacheForTests();
  __resetReplayerForTests();
  setNetwork(new NavigatorOnlineNetwork());
});

describe("офлайн-возврат клиента и версия строки", () => {
  test("возврат держит серверную версию и несёт её сторожем", async () => {
    await seedArchivedClient();

    await restoreClient(
      {} as never,
      createBlankClient({ id: CLIENT_ID, full_name: "Вернули" }),
      TENANT,
    );

    const [op] = await dequeueAll();
    expect(op!.expected_updated_at).toBe(SERVER_V1);
    const cached = await cacheGetOne<CachedClientData>("clients", CLIENT_ID, TENANT);
    expect(cached!.deleted_at).toBeNull();
    expect(cached!.updated_at).toBe(SERVER_V1);
  });

  test("возврат и правка без сети уходят без ложного «конфликта»", async () => {
    await seedArchivedClient();
    await restoreClient(
      {} as never,
      createBlankClient({ id: CLIENT_ID, full_name: "Вернули" }),
      TENANT,
    );
    await updateClient({} as never, CLIENT_ID, { full_name: "Вернули и переименовали" }, TENANT);
    expect(await dequeueAll()).toHaveLength(2);

    const server = serverWithUpdatedAtTrigger(SERVER_V1);
    const conflicts: string[] = [];
    await kickReplayer({
      supabase: server.client,
      tenantId: TENANT,
      onConflict: (message) => conflicts.push(message),
    });

    expect(conflicts).toEqual([]);
    expect(await dequeueAll()).toEqual([]);
    // Оба обновления — условные и совпали с первого раза: силовой записи нет.
    const updates = server.calls.filter((call) => call.op === "update");
    expect(updates).toHaveLength(2);
    for (const update of updates) expect(update.filters.updated_at).toBeDefined();
    // Кэш знает версию сервера, а не время телефона.
    const cached = await cacheGetOne<CachedClientData>("clients", CLIENT_ID, TENANT);
    expect(cached!.updated_at).toBe(server.version());
  });
});
