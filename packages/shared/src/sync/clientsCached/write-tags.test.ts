// Правка тегов при обрыве сети: ложного «сохранено» быть не должно.
//
// Run: cd packages/shared && bun test src/sync/clientsCached/write-tags.test.ts

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MemorySqlAdapter } from "../../storage/sql/memory";
import { NavigatorOnlineNetwork, setNetwork, setSql } from "../../storage/sql/provider";
import type { NetworkAdapter } from "../../storage/sql/types";
import {
  __resetCacheForTests,
  cacheRead,
  dequeueAll,
  removeOp,
  type CachedClientData,
} from "../../db/cache/sql";
import { createBlankClient } from "../../local/clients";
import { createClient, updateClient } from "../clientsCached";

const TENANT = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

class Net implements NetworkAdapter {
  constructor(private online: boolean) {}
  isOnline(): boolean {
    return this.online;
  }
  subscribe(): () => void {
    return () => {};
  }
}

/** Сервер, который отвечает 503 на любую запись. */
function unavailableSupabase() {
  const result = { data: null, error: { status: 503, message: "service unavailable" } };
  return {
    rpc: () => Promise.resolve(result),
    from() {
      const chain: Record<string, unknown> = {};
      for (const name of ["update", "delete", "insert", "eq", "select", "is"]) chain[name] = () => chain;
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

beforeEach(() => {
  setSql(new MemorySqlAdapter(new Database(":memory:")));
  setNetwork(new Net(false));
  __resetCacheForTests();
});
afterEach(() => {
  __resetCacheForTests();
  setNetwork(new NavigatorOnlineNetwork());
});

describe("теги при обрыве сети", () => {
  test("правка тега не выдаёт себя за сохранённую: отказ, кэш прежний, очередь пуста", async () => {
    await createClient({} as any, createBlankClient({ id: CLIENT_ID, tag_ids: ["old"] }), TENANT);
    for (const op of await dequeueAll()) await removeOp(op.id);
    setNetwork(new Net(true));

    await expect(
      updateClient(unavailableSupabase() as never, CLIENT_ID, { tag_ids: ["new"] }, TENANT),
    ).rejects.toThrow("service unavailable");

    const [cached] = await cacheRead<CachedClientData>("clients", TENANT);
    expect(cached?.tag_ids).toEqual(["old"]);
    expect(await dequeueAll()).toEqual([]);
  });

  test("обычная правка при обрыве по-прежнему встаёт в очередь", async () => {
    await createClient({} as any, createBlankClient({ id: CLIENT_ID }), TENANT);
    for (const op of await dequeueAll()) await removeOp(op.id);
    setNetwork(new Net(true));

    await updateClient(unavailableSupabase() as never, CLIENT_ID, { comment: "заметка" }, TENANT);

    expect((await dequeueAll()).map((op) => op.payload.comment)).toEqual(["заметка"]);
  });
});
