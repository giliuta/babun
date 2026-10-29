// СВЕРКА ЗАПИСЕЙ ДЕЛЬТОЙ И ОТПЕЧАТКОМ (035, П2) — ЗА ВЫКЛЮЧАТЕЛЕМ.
//
// Полная сверка тянула все записи аккаунта на каждый старт и сигнал. С
// выключателем — отпечаток месяцев + строки новее метки, и целиком
// перечитывается только разошедшийся месяц. Здесь — сервер в памяти, который
// понимает те же фильтры, что PostgREST, и считает отпечаток тем же расчётом,
// что боевая функция (`appointment-digest.test.ts` сверяет его с SQL).
//
// Run: cd packages/shared && bun test src/sync/appointments-incremental.test.ts

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MemorySqlAdapter } from "../storage/sql/memory";
import { setSql, setNetwork, NavigatorOnlineNetwork } from "../storage/sql/provider";
import type { NetworkAdapter } from "../storage/sql/types";
import { MemoryKVStorage } from "../storage/memory";
import { setStorage } from "../storage/provider";
import { __resetCacheForTests, cacheRead, type CachedAppointmentData } from "../db/cache/sql";
import { listAppointments } from "./appointmentsCached";
import {
  APPOINTMENT_DELTA_FLAG,
  firstLoadWindow,
  readAppointmentCursor,
} from "./appointmentsCached/incremental";
import { monthDigests } from "./appointment-digest";
import { forgetSettledRevalidations } from "./revalidator";

const TENANT = "11111111-1111-1111-1111-111111111111";

class OnlineNetwork implements NetworkAdapter {
  isOnline(): boolean {
    return true;
  }
  subscribe(): () => void {
    return () => {};
  }
}

type ServerRow = { id: string; tenant_id: string; date: string; updated_at: string; time_start: string; kind: string };

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
let clock = Date.parse("2026-10-28T10:00:00Z");
const tick = () => new Date((clock += 1000)).toISOString().replace("Z", "+00:00");

/** Сервер в памяти: select → eq/gt/gte/lte → order → range и rpc отпечатка.
 *  Считает, что у него спросили: полный список, дельту, месяц, отпечаток. */
function memoryServer(seed: ServerRow[], opts: { noDigest?: boolean } = {}) {
  const rows = new Map(seed.map((r) => [r.id, r]));
  const log: string[] = [];
  const client = {
    from() {
      const filters: ((r: ServerRow) => boolean)[] = [];
      let kind = "full";
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (col: keyof ServerRow, v: string) => (filters.push((r) => r[col] === v), chain);
      chain.gt = (col: keyof ServerRow, v: string) => {
        kind = "delta";
        filters.push((r) => Date.parse(r[col]) > Date.parse(v));
        return chain;
      };
      chain.gte = (col: keyof ServerRow, v: string) => ((kind = "range"), filters.push((r) => r[col] >= v), chain);
      chain.lte = (col: keyof ServerRow, v: string) => (filters.push((r) => r[col] <= v), chain);
      chain.order = () => chain;
      chain.range = () => chain;
      chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
        log.push(kind);
        const data = [...rows.values()].filter((r) => filters.every((f) => f(r)));
        return Promise.resolve({ data, error: null }).then(ok, bad);
      };
      return chain;
    },
    rpc(name: string) {
      log.push(name);
      if (opts.noDigest) {
        return Promise.resolve({ data: null, error: { message: "not found", code: "PGRST202" } });
      }
      const data = [...monthDigests([...rows.values()])].map(([month, d]) => ({ month, ...d }));
      return Promise.resolve({ data, error: null });
    },
  };
  return {
    client: client as never,
    log,
    clearLog: () => log.splice(0),
    upsert: (row: ServerRow) => rows.set(row.id, row),
    remove: (rowId: string) => rows.delete(rowId),
  };
}

const row = (n: number, date: string): ServerRow => ({
  id: id(n),
  tenant_id: TENANT,
  date,
  updated_at: tick(),
  time_start: "10:00",
  kind: "work",
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
const cachedIds = async () =>
  (await cacheRead<CachedAppointmentData>("appointments", TENANT)).map((r) => r.id).sort();

/** Устройство, однажды сверенное полностью: снимок, метка — с сервера. */
async function syncedDevice(server: ReturnType<typeof memoryServer>) {
  await listAppointments(server.client, TENANT);
  await settle();
  forgetSettledRevalidations();
}

let storage: MemoryKVStorage;
beforeEach(() => {
  setSql(new MemorySqlAdapter(new Database(":memory:")));
  setNetwork(new OnlineNetwork());
  storage = new MemoryKVStorage();
  setStorage(storage);
  __resetCacheForTests();
  forgetSettledRevalidations();
});
afterEach(() => {
  __resetCacheForTests();
  setNetwork(new NavigatorOnlineNetwork());
});

const flagOn = () => storage.set(APPOINTMENT_DELTA_FLAG, true);

describe("сверка дельтой и отпечатком", () => {
  test("выключатель выключен — как раньше, полное чтение", async () => {
    const server = memoryServer([row(1, "2026-10-05")]);
    await listAppointments(server.client, TENANT);
    await settle();
    forgetSettledRevalidations();
    server.clearLog();
    await listAppointments(server.client, TENANT);
    await settle();
    expect(server.log).toEqual(["full"]);
  });

  test("правка на другом телефоне приходит дельтой, без полного чтения", async () => {
    const server = memoryServer([row(1, "2026-09-05"), row(2, "2026-10-05")]);
    await syncedDevice(server);
    flagOn();
    server.upsert({ ...row(2, "2026-10-06"), time_start: "12:00" });
    server.clearLog();

    await listAppointments(server.client, TENANT);
    await settle();

    expect(server.log).toEqual(["appointment_month_digest", "delta"]);
    const cached = await cacheRead<CachedAppointmentData>("appointments", TENANT);
    expect(cached.find((r) => r.id === id(2))?.time_start).toBe("12:00");
  });

  test("удаление на другом телефоне: месяц перечитан, записи на сетке нет", async () => {
    const server = memoryServer([row(1, "2026-09-05"), row(2, "2026-10-05"), row(3, "2026-10-07")]);
    await syncedDevice(server);
    flagOn();
    server.remove(id(3));
    server.clearLog();

    await listAppointments(server.client, TENANT);
    await settle();

    expect(server.log).toEqual(["appointment_month_digest", "delta", "range"]);
    expect(await cachedIds()).toEqual([id(1), id(2)]);
  });

  test("ничего не менялось — отпечаток и пустая дельта, ни одного месяца", async () => {
    const server = memoryServer([row(1, "2026-10-05")]);
    await syncedDevice(server);
    flagOn();
    server.clearLog();

    await listAppointments(server.client, TENANT);
    await settle();

    expect(server.log).toEqual(["appointment_month_digest", "delta"]);
    expect(await cachedIds()).toEqual([id(1)]);
  });

  test("функции на сервере нет — полная сверка", async () => {
    const server = memoryServer([row(1, "2026-10-05")], { noDigest: true });
    await syncedDevice(server);
    flagOn();
    server.clearLog();

    await listAppointments(server.client, TENANT);
    await settle();

    expect(server.log).toEqual(["appointment_month_digest", "full"]);
  });

  test("метка — по строкам сервера, а не по часам телефона", async () => {
    const server = memoryServer([row(1, "2026-10-05"), row(2, "2026-10-06")]);
    await listAppointments(server.client, TENANT);
    await settle();
    expect(await readAppointmentCursor(TENANT)).toBe(new Date(clock).toISOString().replace("Z", "+00:00"));
  });

  test("первая загрузка: окно сразу на экран, полная история — фоном в кэш", async () => {
    flagOn();
    const { from, to } = firstLoadWindow();
    const inside = from.slice(0, 7) + "-15";
    const server = memoryServer([row(1, inside), row(2, "2020-01-01"), row(3, "2035-01-01")]);

    const first = await listAppointments(server.client, TENANT);
    expect(first.map((a) => a.id)).toEqual([id(1)]);
    expect(server.log[0]).toBe("range");
    expect(inside <= to).toBe(true);

    await settle();
    expect(await cachedIds()).toEqual([id(1), id(2), id(3)]);
  });
});

describe("эхо сверки не идёт в сеть второй раз", () => {
  test("перечитка экрана сразу после изменившей кэш сверки — без запроса", async () => {
    const server = memoryServer([row(1, "2026-10-05")]);
    await syncedDevice(server);
    server.upsert({ ...row(1, "2026-10-05"), time_start: "15:00" });
    server.clearLog();

    await listAppointments(server.client, TENANT); // сверка меняет кэш → событие
    await settle();
    await listAppointments(server.client, TENANT); // перечитка экрана по событию
    await settle();
    expect(server.log).toEqual(["full"]);

    // Пропуск разовый: следующий повод идёт в сеть.
    await listAppointments(server.client, TENANT);
    await settle();
    expect(server.log).toEqual(["full", "full"]);
  });

  test("сигнал чужой правки снимает пропуск", async () => {
    const server = memoryServer([row(1, "2026-10-05")]);
    await syncedDevice(server);
    server.upsert({ ...row(1, "2026-10-05"), time_start: "15:00" });
    server.clearLog();

    await listAppointments(server.client, TENANT);
    await settle();
    forgetSettledRevalidations("appointments");
    await listAppointments(server.client, TENANT);
    await settle();
    expect(server.log).toEqual(["full", "full"]);
  });
});
