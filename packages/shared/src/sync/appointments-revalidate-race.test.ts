// Гонка сверки календаря и свежей правки (аудит 03.10).
//
// Сверка качает снимок сервера секундами и потом целиком заменяет им кэш.
// Перенос, записанный в кэш, пока снимок ехал, затирался этим снимком: запись
// возвращалась на прежнее место до следующей сверки. Теперь замена
// отменяется, а следом идёт вторая сверка — уже после правки.
//
// Run: cd packages/shared && bun test src/sync/appointments-revalidate-race.test.ts

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MemorySqlAdapter } from "../storage/sql/memory";
import {
  setSql,
  setNetwork,
  NavigatorOnlineNetwork,
} from "../storage/sql/provider";
import type { NetworkAdapter } from "../storage/sql/types";
import { __resetCacheForTests, cacheRead } from "../db/cache/sql";
import { cacheServerAppointment, listAppointments } from "./appointmentsCached";
import { createBlankAppointment } from "../local/appointments";

const TENANT = "11111111-1111-1111-1111-111111111111";
const APPT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

class OnlineNetwork implements NetworkAdapter {
  isOnline(): boolean {
    return true;
  }
  subscribe(_cb: (online: boolean) => void): () => void {
    return () => {};
  }
}

type ListResult = { data: unknown[]; error: null };

/** Сервер, чьи ответы на список записей отдаются по команде теста. */
function slowServer() {
  const pending: Array<(value: ListResult) => void> = [];
  const client = {
    from() {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => ({
        then: (
          onFulfilled: (value: ListResult) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) =>
          new Promise<ListResult>((resolve) => pending.push(resolve)).then(
            onFulfilled,
            onRejected,
          ),
      });
      return chain;
    },
  };
  return {
    client: client as never,
    reads: () => pending.length,
    answer: (index: number, data: unknown[]) => pending[index]!({ data, error: null }),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

async function cachedStart(): Promise<string[]> {
  const rows = await cacheRead<Record<string, unknown>>("appointments", TENANT);
  return rows.map((row) => String(row.time_start));
}

beforeEach(() => {
  setSql(new MemorySqlAdapter(new Database(":memory:")));
  setNetwork(new OnlineNetwork());
  __resetCacheForTests();
});
afterEach(() => {
  __resetCacheForTests();
  setNetwork(new NavigatorOnlineNetwork());
});

describe("сверка календаря и правка, легшая во время запроса", () => {
  test("снимок, снятый до переноса, перенос не затирает, а сверка идёт ещё раз", async () => {
    const at10 = createBlankAppointment({
      id: APPT_ID,
      date: "2026-10-05",
      time_start: "10:00",
      time_end: "11:00",
    });
    await cacheServerAppointment(at10, TENANT);
    const server = slowServer();

    // Экран читает кэш, сверка уходит на сервер и ждёт ответа.
    await listAppointments(server.client, TENANT);
    await settle();
    expect(server.reads()).toBe(1);

    // Пока снимок едет, человек переносит запись на 12:00.
    await cacheServerAppointment({ ...at10, time_start: "12:00", time_end: "13:00" }, TENANT);

    // Сервер отвечает снимком, снятым ДО переноса (пустой — запись ещё не
    // дошла): замена отменена, перенос на сетке цел.
    server.answer(0, []);
    await settle();
    expect(await cachedStart()).toEqual(["12:00"]);

    // Следом сама пошла вторая сверка — уже после правки.
    expect(server.reads()).toBe(2);

    // Её снимок — правда сервера, он и ложится.
    server.answer(1, []);
    await settle();
    expect(await cachedStart()).toEqual([]);
    expect(server.reads()).toBe(2);
  });

  test("без правок за время запроса снимок ложится сразу, повторной сверки нет", async () => {
    await cacheServerAppointment(
      createBlankAppointment({
        id: APPT_ID,
        date: "2026-10-05",
        time_start: "10:00",
        time_end: "11:00",
      }),
      TENANT,
    );
    const server = slowServer();

    await listAppointments(server.client, TENANT);
    await settle();
    server.answer(0, []);
    await settle();

    expect(await cachedStart()).toEqual([]);
    expect(server.reads()).toBe(1);
  });
});
