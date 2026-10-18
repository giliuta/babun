// Гонка сверки клиентов и тегов со свежей правкой.
//
// Тот же дефект, что закрыт у записей (appointments-revalidate-race.test.ts):
// сверка качает снимок сервера секундами и целиком заменяет им кэш. Клиент,
// заведённый или поправленный, пока снимок ехал, пропадал или откатывался;
// у тегов удалённый воскресал, новый исчезал. Теперь замена отменяется, а
// следом идёт вторая сверка — уже после правки.
//
// Заодно: штамп `updated_at` клиента приезжает из тех же строк, что и данные,
// а не отдельным запросом (тот мог приехать новее данных).
//
// Run: cd packages/shared && bun test src/sync/clients-revalidate-race.test.ts

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
  cacheUpsert,
  enqueueOp,
  markOpPermanentlyFailed,
  type CachedClientData,
  type CachedTag,
} from "../db/cache/sql";
import { createBlankClient } from "../local/clients";
import { __resetReplayerForTests } from "./replayer";
import { listClients } from "./clientsCached";
import { listClientTags } from "./tagsCached";
import { listClientsWithStamps } from "../db/repositories/clients";

const TENANT = "11111111-1111-1111-1111-111111111111";
const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TAG_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TEAM = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

class OnlineNetwork implements NetworkAdapter {
  isOnline(): boolean {
    return true;
  }
  subscribe(_cb: (online: boolean) => void): () => void {
    return () => {};
  }
}

type ListResult = { data: unknown[]; error: null };

/** Сервер, чьи ответы по таблице `slowTable` отдаются по команде теста;
 *  остальные таблицы отвечают сразу пустым списком. Каждый запрос пишется. */
function slowServer(slowTable: string) {
  const pending: ((value: ListResult) => void)[] = [];
  const selects: { table: string; columns: string }[] = [];
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      chain.select = (columns: string) => {
        selects.push({ table, columns });
        return chain;
      };
      chain.eq = passthrough;
      chain.is = passthrough;
      chain.order = passthrough;
      chain.range = () => ({
        then: (
          onFulfilled: (value: ListResult) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) =>
          (table === slowTable
            ? new Promise<ListResult>((resolve) => pending.push(resolve))
            : Promise.resolve<ListResult>({ data: [], error: null })
          ).then(onFulfilled, onRejected),
      });
      return chain;
    },
  };
  return {
    client: client as never,
    reads: () => pending.length,
    selects,
    answer: (index: number, data: unknown[]) => pending[index]!({ data, error: null }),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

function clientRow(id: string, fullName: string, updatedAt: string) {
  return {
    id,
    tenant_id: TENANT,
    full_name: fullName,
    phone: "",
    deleted_at: null,
    updated_at: updatedAt,
  };
}

/** Cache row as the wrappers store it: domain client plus bookkeeping keys. */
function cachedClient(id: string, fullName: string, updatedAt: string): CachedClientData {
  return {
    ...createBlankClient({ id, full_name: fullName }),
    tenant_id: TENANT,
    updated_at: updatedAt,
  };
}

async function cachedNames(): Promise<string[]> {
  const rows = await cacheRead<CachedClientData>("clients", TENANT);
  return rows.map((row) => String(row.full_name)).sort();
}

async function cachedTagNames(): Promise<string[]> {
  const rows = await cacheRead<CachedTag>("tags", TENANT);
  return rows.map((row) => String(row.name)).sort();
}

beforeEach(() => {
  setSql(new MemorySqlAdapter(new Database(":memory:")));
  setNetwork(new OnlineNetwork());
  __resetCacheForTests();
  __resetReplayerForTests();
});
afterEach(() => {
  __resetCacheForTests();
  setNetwork(new NavigatorOnlineNetwork());
});

describe("сверка клиентов и правка, легшая во время запроса", () => {
  test("клиент, заведённый пока ехал снимок, не пропадает, а сверка идёт ещё раз", async () => {
    await cacheUpsert("clients", cachedClient(CLIENT_A, "Анна", "2026-10-01T00:00:00Z"));
    const server = slowServer("clients");

    await listClients(server.client, TENANT);
    await settle();
    expect(server.reads()).toBe(1);

    // Пока снимок едет, владелец заводит Бориса.
    await cacheUpsert("clients", cachedClient(CLIENT_B, "Борис", "2026-10-04T10:00:00Z"));

    // Снимок снят ДО Бориса: замена отменена, Борис в кэше.
    server.answer(0, [clientRow(CLIENT_A, "Анна", "2026-10-01T00:00:00Z")]);
    await settle();
    expect(await cachedNames()).toEqual(["Анна", "Борис"]);

    // Следом сама пошла вторая сверка, и её снимок — правда сервера.
    expect(server.reads()).toBe(2);
    server.answer(1, [
      clientRow(CLIENT_A, "Анна", "2026-10-01T00:00:00Z"),
      clientRow(CLIENT_B, "Борис", "2026-10-04T10:00:01Z"),
    ]);
    await settle();
    expect(await cachedNames()).toEqual(["Анна", "Борис"]);
    expect(server.reads()).toBe(2);
  });

  test("без правок за время запроса снимок ложится сразу, повторной сверки нет", async () => {
    await cacheUpsert("clients", cachedClient(CLIENT_A, "Анна", "2026-10-01T00:00:00Z"));
    const server = slowServer("clients");

    await listClients(server.client, TENANT);
    await settle();
    server.answer(0, [clientRow(CLIENT_A, "Анна Петрова", "2026-10-02T00:00:00Z")]);
    await settle();

    expect(await cachedNames()).toEqual(["Анна Петрова"]);
    expect(server.reads()).toBe(1);
  });

  test("два чтения списка разом — одна сверка, а не две наперегонки", async () => {
    await cacheUpsert("clients", cachedClient(CLIENT_A, "Анна", "2026-10-01T00:00:00Z"));
    const server = slowServer("clients");

    await listClients(server.client, TENANT);
    await listClients(server.client, TENANT);
    await settle();

    expect(server.reads()).toBe(1);
    // Сверку доводим до конца: висящая держала бы компанию и для чужих файлов.
    server.answer(0, [clientRow(CLIENT_A, "Анна", "2026-10-01T00:00:00Z")]);
    await settle();
  });
});

describe("штамп клиента — из тех же строк, что и данные", () => {
  test("updated_at берётся из строки списка, отдельного запроса штампов нет", async () => {
    const server = slowServer("clients");
    const pendingList = listClientsWithStamps(server.client, TENANT, { includeDeleted: true });
    await settle();
    server.answer(0, [clientRow(CLIENT_A, "Анна", "2026-10-04T09:00:00Z")]);
    const { clients, updatedAtById } = await pendingList;

    expect(clients.map((c) => c.full_name)).toEqual(["Анна"]);
    expect(updatedAtById.get(CLIENT_A)).toBe("2026-10-04T09:00:00Z");
    expect(
      server.selects.filter((s) => s.table === "clients").map((s) => s.columns),
    ).toEqual(["*"]);
  });
});

describe("сверка тегов и правка, легшая во время запроса", () => {
  test("тег, заведённый пока ехал снимок, не пропадает, а сверка идёт ещё раз", async () => {
    await cacheUpsert("tags", {
      id: TAG_A,
      tenant_id: TENANT,
      name: "VIP",
      color: "#2c5be0",
      icon: null,
      position: 0,
      hidden: false,
      team_id: TEAM,
    });
    const server = slowServer("client_tags");

    await listClientTags(server.client, TENANT);
    await settle();
    expect(server.reads()).toBe(1);

    await cacheUpsert("tags", {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      tenant_id: TENANT,
      name: "Новый",
      color: "#e02c5b",
      icon: null,
      position: 1,
      hidden: false,
      team_id: TEAM,
    });

    server.answer(0, [{ id: TAG_A, tenant_id: TENANT, name: "VIP", color: "#2c5be0" }]);
    await settle();
    expect(await cachedTagNames()).toEqual(["VIP", "Новый"]);
    expect(server.reads()).toBe(2);

    // Вторая сверка — правда сервера.
    server.answer(1, [
      { id: TAG_A, tenant_id: TENANT, name: "VIP", color: "#2c5be0" },
      { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", tenant_id: TENANT, name: "Новый", color: "#e02c5b" },
    ]);
    await settle();
    expect(await cachedTagNames()).toEqual(["VIP", "Новый"]);
    expect(server.reads()).toBe(2);
  });
});

// КЛИЕНТ, ЧЬЯ ВСТАВКА УПАЛА НАВСЕГДА, С ЭКРАНА НЕ ПРОПАДАЕТ:
// перечитку он не держит, и снимок сервера стирал его из кэша — запись к нему
// оставалась на сетке без клиента. Пока вставка в очереди, клиент на месте.
describe("перечитка клиентов и неотправленная вставка", () => {
  test("клиент с навсегда упавшей вставкой остаётся в кэше, остальное — по серверу", async () => {
    await cacheUpsert("clients", cachedClient(CLIENT_A, "Анна", "2026-10-01T00:00:00Z"));
    await cacheUpsert("clients", cachedClient(CLIENT_B, "Борис офлайн", "2026-10-04T10:00:00Z"));
    await enqueueOp({
      table: "clients",
      op: "insert",
      row_id: CLIENT_B,
      payload: { id: CLIENT_B, tenant_id: TENANT, full_name: "Борис офлайн" },
      expected_updated_at: null,
    });
    const [queued] = await (await import("../db/cache/sql")).dequeueAll();
    await markOpPermanentlyFailed(queued!.id, "номер уже заведён");
    const server = slowServer("clients");

    await listClients(server.client, TENANT);
    await settle();
    server.answer(0, [clientRow(CLIENT_A, "Анна Петрова", "2026-10-02T00:00:00Z")]);
    await settle();

    expect(await cachedNames()).toEqual(["Анна Петрова", "Борис офлайн"]);
  });
});
