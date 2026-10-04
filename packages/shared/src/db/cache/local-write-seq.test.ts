// Сторож авторитетной сверки (03.10): замена кэша снимком сервера не стирает
// локальную правку, начатую, пока снимок ехал.
//
// Run: cd packages/shared && bun test src/db/cache/local-write-seq.test.ts

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MemorySqlAdapter } from "../../storage/sql/memory";
import { setSql } from "../../storage/sql/provider";
import {
  __resetCacheForTests,
  cacheDelete,
  cacheLocalWriteSeq,
  cacheRead,
  cacheReplaceTenant,
  cacheUpsert,
  type CachedTag,
} from "./sql";

const TENANT = "11111111-1111-1111-1111-111111111111";

const tag = (id: string, name = id): CachedTag => ({
  id,
  tenant_id: TENANT,
  name,
  color: "#000",
  icon: null,
  position: 0,
  hidden: false,
});

const names = async (): Promise<string[]> =>
  (await cacheRead<CachedTag>("tags", TENANT)).map((t) => t.name).sort();

beforeEach(() => {
  setSql(new MemorySqlAdapter(new Database(":memory:")));
  __resetCacheForTests();
});
afterEach(() => {
  __resetCacheForTests();
});

describe("счётчик локальных записей", () => {
  test("растёт от правки и удаления, но не от замены сверкой", async () => {
    const start = cacheLocalWriteSeq("tags");
    await cacheUpsert("tags", tag("t1"));
    await cacheDelete("tags", "t1");
    expect(cacheLocalWriteSeq("tags")).toBe(start + 2);
    await cacheReplaceTenant("tags", TENANT, [tag("t2")]);
    expect(cacheLocalWriteSeq("tags")).toBe(start + 2);
  });

  test("у каждой таблицы свой", async () => {
    const before = cacheLocalWriteSeq("appointments");
    await cacheUpsert("tags", tag("t1"));
    expect(cacheLocalWriteSeq("appointments")).toBe(before);
  });

  test("растёт до того, как запись дошла до базы", () => {
    const before = cacheLocalWriteSeq("tags");
    const pending = cacheUpsert("tags", tag("t1"));
    expect(cacheLocalWriteSeq("tags")).toBe(before + 1);
    return pending;
  });
});

describe("замена кэша снимком сервера", () => {
  test("без правок за время запроса — заменяет", async () => {
    await cacheUpsert("tags", tag("old"));
    const seq = cacheLocalWriteSeq("tags");
    const replaced = await cacheReplaceTenant("tags", TENANT, [tag("server")], {
      unlessLocalWriteSince: seq,
    });
    expect(replaced).toBe(true);
    expect(await names()).toEqual(["server"]);
  });

  test("правка легла, пока снимок ехал, — замены нет, правка цела", async () => {
    await cacheUpsert("tags", tag("t1", "до переноса"));
    const seq = cacheLocalWriteSeq("tags"); // сверка запомнила до запроса
    await cacheUpsert("tags", tag("t1", "после переноса")); // человек правит
    const replaced = await cacheReplaceTenant("tags", TENANT, [tag("t1", "до переноса")], {
      unlessLocalWriteSince: seq,
    });
    expect(replaced).toBe(false);
    expect(await names()).toEqual(["после переноса"]);
  });

  test("удаление за время запроса тоже отменяет замену", async () => {
    await cacheUpsert("tags", tag("t1"));
    const seq = cacheLocalWriteSeq("tags");
    await cacheDelete("tags", "t1");
    const replaced = await cacheReplaceTenant("tags", TENANT, [tag("t1")], {
      unlessLocalWriteSince: seq,
    });
    expect(replaced).toBe(false);
    expect(await names()).toEqual([]);
  });

  test("без сторожа — как раньше, заменяет всегда", async () => {
    await cacheUpsert("tags", tag("t1", "локально"));
    const replaced = await cacheReplaceTenant("tags", TENANT, [tag("t1", "сервер")]);
    expect(replaced).toBe(true);
    expect(await names()).toEqual(["сервер"]);
  });
});
