// ЗАПИСЬ В КОМПАНИЮ, КОТОРАЯ НЕ ОТКРЫТА В КАЛЕНДАРЕ, — ТОЛЬКО ОНЛАЙН.
//
// Вкладка «Клиенты» стала общей страницей (STORY-082): своя компания видна,
// даже когда в календаре открыта чужая. Очередь офлайна при этом остаётся
// одна и выгружается под АКТИВНОЙ компанией — отложенная операция уехала бы
// под чужим заголовком: вставку сервер отобьёт, а удаление вернёт ноль строк
// и прочитается как «удалять нечего», то есть работа пропадёт молча.
//
// Поэтому у обёрток есть `onlineOnly` — текст отказа. Этот тест держит его
// ПОВЕДЕНИЕМ, а не текстом: отказ приходит ДО оптимистичной записи, очередь
// остаётся пустой, кэш не трогается, а сетевой сбой посреди записи не
// превращается в отложенную операцию.
//
// Run: cd packages/shared && bun test src/sync/onlineOnlyWrites.test.ts

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MemorySqlAdapter } from "../storage/sql/memory";
import { setNetwork, setSql, NavigatorOnlineNetwork } from "../storage/sql/provider";
import type { NetworkAdapter } from "../storage/sql/types";
import { __resetCacheForTests, cacheRead, dequeueAll } from "../db/cache/sql";
import {
  archiveClient,
  createClient,
  deleteClient,
  restoreClient,
  updateClient,
} from "./clientsCached";
import { createClientTag, deleteClientTag, updateClientTag } from "./tagsCached";
import { createBlankClient } from "../local/clients";
import type { Client } from "../local/clients";
import { isOnlineOnlyWriteError } from "./cache-errors";

const TENANT = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REFUSAL = "Нет интернета. Клиенты «AirFix» сохраняются только онлайн.";
const ONLINE_ONLY = { onlineOnly: REFUSAL };

class FixedNetwork implements NetworkAdapter {
  constructor(private readonly online: boolean) {}
  isOnline(): boolean {
    return this.online;
  }
  subscribe(): () => void {
    return () => {};
  }
}

/** Клиент Supabase, который всегда падает СЕТЕВОЙ ошибкой: без `onlineOnly`
 *  такая ошибка кладёт операцию в очередь. */
function networkDownSupabase() {
  const result = {
    data: null,
    error: { status: 503, message: "network request failed" },
  };
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.order = () => chain;
  chain.range = () => Promise.resolve(result);
  chain.insert = () => chain;
  chain.update = () => chain;
  chain.delete = () => chain;
  chain.single = () => Promise.resolve(result);
  chain.maybeSingle = () => Promise.resolve(result);
  chain.then = (
    onFulfilled: (value: typeof result) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return {
    rpc: () => Promise.resolve(result),
    from: () => chain,
  } as never;
}

const client = (over: Partial<Client> = {}): Client =>
  createBlankClient({ id: CLIENT_ID, full_name: "Проба", phone: "+35799000000", ...over });

beforeEach(() => {
  setSql(new MemorySqlAdapter(new Database(":memory:")));
  __resetCacheForTests();
});

afterEach(() => {
  setNetwork(new NavigatorOnlineNetwork());
});

describe("офлайн: запись в неактивную компанию отбивается до кэша и очереди", () => {
  beforeEach(() => setNetwork(new FixedNetwork(false)));

  const cases: Array<[string, () => Promise<unknown>]> = [
    ["создание клиента", () => createClient(networkDownSupabase(), client(), TENANT, ONLINE_ONLY)],
    ["правка клиента", () => updateClient(networkDownSupabase(), CLIENT_ID, { comment: "х" }, TENANT, ONLINE_ONLY)],
    ["архив клиента", () => archiveClient(networkDownSupabase(), CLIENT_ID, TENANT, null, ONLINE_ONLY)],
    ["возврат клиента", () => restoreClient(networkDownSupabase(), client(), TENANT, ONLINE_ONLY)],
    ["стирание клиента", () => deleteClient(networkDownSupabase(), CLIENT_ID, TENANT, ONLINE_ONLY)],
    ["создание тега", () => createClientTag(networkDownSupabase(), { name: "Тег", color: "#fff" }, TENANT, ONLINE_ONLY)],
    ["правка тега", () => updateClientTag(networkDownSupabase(), "tag-1", { name: "Тег" }, TENANT, ONLINE_ONLY)],
    ["удаление тега", () => deleteClientTag(networkDownSupabase(), "tag-1", TENANT, ONLINE_ONLY)],
  ];

  for (const [name, run] of cases) {
    test(`${name}: отказ словами, очередь и кэш чисты`, async () => {
      let refused: unknown = null;
      try {
        await run();
      } catch (error) {
        refused = error;
      }
      expect(isOnlineOnlyWriteError(refused)).toBe(true);
      expect((refused as Error).message).toBe(REFUSAL);
      expect(await dequeueAll()).toHaveLength(0);
      expect(await cacheRead("clients", TENANT)).toHaveLength(0);
      expect(await cacheRead("tags", TENANT)).toHaveLength(0);
    });
  }

  test("без `onlineOnly` офлайн работает как раньше — операция ложится в очередь", async () => {
    await createClient(networkDownSupabase(), client(), TENANT);
    const queued = await dequeueAll();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.table).toBe("clients");
    expect(await cacheRead("clients", TENANT)).toHaveLength(1);
  });
});

describe("сеть отвалилась посреди записи в неактивную компанию", () => {
  beforeEach(() => setNetwork(new FixedNetwork(true)));

  test("операция НЕ откладывается: отказ и пустая очередь", async () => {
    let failed: unknown = null;
    try {
      await createClient(networkDownSupabase(), client(), TENANT, ONLINE_ONLY);
    } catch (error) {
      failed = error;
    }
    expect(failed).toBeTruthy();
    expect(await dequeueAll()).toHaveLength(0);
    // Оптимистичная строка откачена: в кэше не остаётся клиента, которого на
    // сервере нет и уже не появится.
    expect(await cacheRead("clients", TENANT)).toHaveLength(0);
  });

  test("без `onlineOnly` тот же сбой откладывает операцию", async () => {
    await createClient(networkDownSupabase(), client(), TENANT);
    expect(await dequeueAll()).toHaveLength(1);
  });
});
