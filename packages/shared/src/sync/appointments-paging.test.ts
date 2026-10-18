// Записи за потолком PostgREST не пропадают с устройства.
//
// PostgREST молча режет ответ до `max_rows` (у Supabase по умолчанию 1000).
// Список записей кормит авторитетную замену кэша (`cacheReplaceTenant`),
// которая УДАЛЯЕТ из SQLite всё, чего нет в снимке. Одним запросом без
// страниц компания с 2500 записями получала снимок из 1000 — и 1500 записей
// исчезали из календаря устройства без единой ошибки.
//
// Поддельный PostgREST ниже честно держит потолок: на любой запрос отдаёт не
// больше MAX_ROWS строк, в том числе на запрос без `.range()`.
//
// Run: cd packages/shared && bun test src/sync/appointments-paging.test.ts

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
  type CachedAppointmentData,
} from "../db/cache/sql";
import { listAppointments as repoListAppointments } from "../db/repositories/appointments";
import { listAppointments } from "./appointmentsCached";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";
const MAX_ROWS = 1000;
const TOTAL = 2500;

class OnlineNetwork implements NetworkAdapter {
  isOnline(): boolean {
    return true;
  }
  subscribe(_cb: (online: boolean) => void): () => void {
    return () => {};
  }
}

type ServerRow = {
  id: string;
  tenant_id: string;
  date: string;
  time_start: string;
  time_end: string;
  updated_at: string;
};

const uuid = (n: number): string =>
  `aaaaaaaa-aaaa-4aaa-8aaa-${n.toString(16).padStart(12, "0")}`;

function serverRow(n: number, tenantId = TENANT): ServerRow {
  return {
    id: uuid(n),
    tenant_id: tenantId,
    date: "2026-10-05",
    time_start: "10:00",
    time_end: "11:00",
    updated_at: "2026-10-01T00:00:00.000Z",
  };
}

type Request = {
  table: string;
  filters: [string, unknown][];
  order: string[];
  range: [number, number] | null;
};

/** PostgREST с потолком `max_rows`. Строки в базе лежат НЕ по порядку id —
 *  как в настоящей куче: без `.order()` страницы не обязаны сходиться. */
function cappedPostgrest(rows: ServerRow[]) {
  const requests: Request[] = [];
  const client = {
    from(table: string) {
      const req: Request = { table, filters: [], order: [], range: null };
      requests.push(req);
      const run = () => {
        let out = rows.filter((row) =>
          req.filters.every(([col, val]) => row[col as keyof ServerRow] === val),
        );
        for (const col of [...req.order].reverse()) {
          out = [...out].sort((a, b) =>
            String(a[col as keyof ServerRow]).localeCompare(String(b[col as keyof ServerRow])),
          );
        }
        const [from, to] = req.range ?? [0, Number.MAX_SAFE_INTEGER];
        const end = Math.min(to + 1, from + MAX_ROWS);
        return { data: out.slice(from, end), error: null };
      };
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          req.filters.push([col, val]);
          return builder;
        },
        order: (col: string) => {
          req.order.push(col);
          return builder;
        },
        range: (from: number, to: number) => {
          req.range = [from, to];
          return builder;
        },
        then: (
          onFulfilled: (value: ReturnType<typeof run>) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise.resolve(run()).then(onFulfilled, onRejected),
      };
      return builder;
    },
  };
  return { client: client as never, requests };
}

/** 2500 записей компании (вперемешку) и одна чужая. */
function serverRows(): ServerRow[] {
  const rows = Array.from({ length: TOTAL }, (_, i) => serverRow(i + 1));
  // Детерминированное перемешивание: куча Postgres не хранит порядок id.
  for (let i = rows.length - 1; i > 0; i--) {
    const j = (i * 7919) % (i + 1);
    [rows[i], rows[j]] = [rows[j]!, rows[i]!];
  }
  rows.push(serverRow(TOTAL + 1, OTHER_TENANT));
  return rows;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

async function cachedIds(): Promise<string[]> {
  const rows = await cacheRead<CachedAppointmentData>("appointments", TENANT);
  return rows.map((row) => row.id).sort();
}

const allIds = Array.from({ length: TOTAL }, (_, i) => uuid(i + 1)).sort();

beforeEach(() => {
  setSql(new MemorySqlAdapter(new Database(":memory:")));
  setNetwork(new OnlineNetwork());
  __resetCacheForTests();
});
afterEach(() => {
  __resetCacheForTests();
  setNetwork(new NavigatorOnlineNetwork());
});

describe("записи за потолком PostgREST", () => {
  test("репозиторий читает все страницы по id, без пропусков и повторов", async () => {
    const server = cappedPostgrest(serverRows());

    const list = await repoListAppointments(server.client, TENANT);

    expect(list).toHaveLength(TOTAL);
    expect(list.map((a) => a.id).sort()).toEqual(allIds);
    expect(server.requests.map((r) => r.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    for (const req of server.requests) {
      expect(req.order).toEqual(["id"]);
      expect(req.filters).toEqual([["tenant_id", TENANT]]);
    }
  });

  test("ровно страница строк — ещё один запрос, пустой, и конец", async () => {
    const rows = Array.from({ length: MAX_ROWS }, (_, i) => serverRow(i + 1));
    const server = cappedPostgrest(rows);

    const list = await repoListAppointments(server.client, TENANT);

    expect(list).toHaveLength(MAX_ROWS);
    expect(server.requests).toHaveLength(2);
  });

  test("холодный кэш: в SQLite ложатся все 2500, а не первые 1000", async () => {
    const server = cappedPostgrest(serverRows());

    const list = await listAppointments(server.client, TENANT);
    await settle();

    expect(list).toHaveLength(TOTAL);
    expect(await cachedIds()).toEqual(allIds);
  });

  test("сверка тёплого кэша заменяет снимок и ни одной записи не стирает", async () => {
    const rows = serverRows();
    const server = cappedPostgrest(rows);
    await listAppointments(server.client, TENANT);
    await settle();
    expect(await cachedIds()).toHaveLength(TOTAL);

    // На сервере перенесли запись, лежащую за первой тысячей: снимок
    // отличается, и сверка обязана сделать полную замену кэша.
    const moved = rows.find((row) => row.id === uuid(TOTAL))!;
    moved.time_start = "15:00";
    moved.updated_at = "2026-10-02T00:00:00.000Z";

    // Тёплое чтение отдаёт кэш и отпускает фоновую сверку.
    const warm = await listAppointments(server.client, TENANT);
    expect(warm).toHaveLength(TOTAL);
    await settle();

    expect(await cachedIds()).toEqual(allIds);
    const cached = await cacheRead<CachedAppointmentData>("appointments", TENANT);
    expect(cached.find((row) => row.id === uuid(TOTAL))?.time_start).toBe("15:00");
  });
});
