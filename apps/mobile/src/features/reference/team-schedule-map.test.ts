import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { QueryClient } from "@tanstack/query-core";
import type { ScheduleMap, TeamSchedule } from "@babun/shared/local/schedule";
import {
  pickTeamSchedule,
  rollbackTeamSchedule,
  withTeamSchedule,
  writeTeamScheduleOptimistic,
} from "./team-schedule-map";

// КАРТА РАСПИСАНИЙ ОДНА НА КОМПАНИЮ, А ПРАВКИ ИДУТ ПО КОМАНДЕ.
// Колесо времени шлёт апсерт на каждый тик, и мутации налезают друг на друга.
// Здесь проверено ровно то, на чём тихо теряется правка: запись и откат
// трогают только свою команду и не затирают более позднюю правку.

const sched = (start: string, end: string): TeamSchedule => ({
  start,
  end,
  breaks: [],
});

const A = "team-a";
const B = "team-b";

describe("выбор графика команды из карты компании", () => {
  const map: ScheduleMap = { [A]: sched("08:00", "18:00") };

  test("есть строка — её график", () => {
    assert.deepEqual(pickTeamSchedule(map, A), sched("08:00", "18:00"));
  });

  test("строки нет — null, а не график по умолчанию", () => {
    assert.equal(pickTeamSchedule(map, B), null);
  });

  test("карты или команды ещё нет — null", () => {
    assert.equal(pickTeamSchedule(undefined, A), null);
    assert.equal(pickTeamSchedule(map, undefined), null);
  });
});

describe("оптимистичная правка карты", () => {
  test("две быстрые правки разных команд — обе в карте", () => {
    let cache: ScheduleMap | undefined = { [A]: sched("08:00", "18:00") };
    cache = withTeamSchedule(cache, A, sched("09:00", "18:00"));
    cache = withTeamSchedule(cache, B, sched("10:00", "20:00"));
    assert.deepEqual(cache, {
      [A]: sched("09:00", "18:00"),
      [B]: sched("10:00", "20:00"),
    });
  });

  test("вторая правка той же команды строится поверх первой", () => {
    let cache: ScheduleMap | undefined = { [A]: sched("08:00", "18:00") };
    cache = withTeamSchedule(cache, A, sched("09:00", "18:00"));
    const base = pickTeamSchedule(cache, A) as TeamSchedule;
    cache = withTeamSchedule(cache, A, { ...base, end: "19:00" });
    assert.deepEqual(pickTeamSchedule(cache, A), sched("09:00", "19:00"));
  });

  test("карты ещё нет — карта из одной команды не рождается", () => {
    // Такая карта выглядела бы полной: соседние команды читались бы «без
    // графика», и их правка заменила бы настоящий график общими часами.
    assert.equal(withTeamSchedule(undefined, A, sched("09:00", "18:00")), undefined);
  });

  test("исходная карта не мутируется", () => {
    const before: ScheduleMap = { [A]: sched("08:00", "18:00") };
    withTeamSchedule(before, B, sched("10:00", "20:00"));
    assert.deepEqual(before, { [A]: sched("08:00", "18:00") });
  });
});

describe("откат неудавшейся правки", () => {
  test("правка A упала после правки B — A вернулась, B осталась", () => {
    const prevA = sched("08:00", "18:00");
    const writtenA = sched("09:00", "18:00");
    let cache: ScheduleMap | undefined = { [A]: prevA };
    cache = withTeamSchedule(cache, A, writtenA);
    cache = withTeamSchedule(cache, B, sched("10:00", "20:00"));
    cache = rollbackTeamSchedule(cache, A, writtenA, prevA);
    assert.deepEqual(cache, {
      [A]: prevA,
      [B]: sched("10:00", "20:00"),
    });
  });

  test("ранняя правка упала, когда поздняя той же команды уже легла — поздняя цела", () => {
    const prev = sched("08:00", "18:00");
    const first = sched("09:00", "18:00");
    const second = sched("09:00", "19:00");
    let cache: ScheduleMap | undefined = { [A]: prev };
    cache = withTeamSchedule(cache, A, first);
    cache = withTeamSchedule(cache, A, second);
    cache = rollbackTeamSchedule(cache, A, first, prev);
    assert.deepEqual(pickTeamSchedule(cache, A), second);
  });

  test("строки до правки не было — откат убирает её, а не пишет пустую", () => {
    const written = sched("09:00", "18:00");
    let cache: ScheduleMap | undefined = { [B]: sched("10:00", "20:00") };
    cache = withTeamSchedule(cache, A, written);
    cache = rollbackTeamSchedule(cache, A, written, undefined);
    assert.deepEqual(cache, { [B]: sched("10:00", "20:00") });
    assert.ok(!Object.prototype.hasOwnProperty.call(cache, A));
  });

  test("равная по содержимому запись под другой ссылкой — всё равно своя", () => {
    const prev = sched("08:00", "18:00");
    const written = sched("09:00", "18:00");
    const cache: ScheduleMap = { [A]: sched("09:00", "18:00") };
    assert.deepEqual(rollbackTeamSchedule(cache, A, written, prev), { [A]: prev });
  });

  test("кэш уже сброшен — откат ничего не создаёт", () => {
    assert.equal(
      rollbackTeamSchedule(undefined, A, sched("09:00", "18:00"), undefined),
      undefined,
    );
  });
});

// ПРАВКА ВО ВРЕМЯ ПЕРВОЙ ЗАГРУЗКИ КАРТЫ — НАСТОЯЩИЙ QueryClient, А НЕ МОДЕЛЬ.
// Холодный старт или переход в компанию без кэша: карта летит 2–6 с, а
// владелец уже крутит колесо. Прежний порядок «отмена → запись» откатывал
// летящую загрузку к пустоте и клал карту из одной команды: соседняя команда
// читалась «без графика», и её правка заменила бы на сервере настоящий график.
describe("правка графика во время первой загрузки карты", () => {
  const KEY = ["team-schedules", "t-1", "owner", "all"] as const;
  const B_REAL: TeamSchedule = {
    start: "07:00",
    end: "15:00",
    breaks: [{ start: "12:00", end: "13:00" }],
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  test("соседняя команда остаётся со своим графиком, правка — поверх полной карты", async () => {
    const qc = new QueryClient();
    const server: ScheduleMap = { [A]: sched("08:00", "20:00"), [B]: B_REAL };
    let loads = 0;
    const load = () => {
      loads += 1;
      return new Promise<ScheduleMap>((r) => setTimeout(() => r(server), 50));
    };
    // Первая загрузка экрана уже в полёте.
    const first = qc.fetchQuery({ queryKey: KEY, queryFn: load }).catch(() => null);
    await wait(5);
    const edit = sched("09:00", "18:00");
    const ctx = await writeTeamScheduleOptimistic(qc, KEY, load, A, edit);
    await first;
    const map = qc.getQueryData<ScheduleMap>(KEY);
    assert.ok(map, "карта исчезла из кэша");
    assert.deepEqual(map[B], B_REAL, "соседняя команда потеряла свой график");
    assert.deepEqual(map[A], edit);
    assert.deepEqual(ctx.prev, sched("08:00", "20:00"), "откат вернул бы не то");
    assert.equal(loads, 1, "правка прислала второй запрос вместо ожидания первого");
    qc.clear();
  });

  test("карта не прочиталась — мутация падает до записи, кэш пуст", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await assert.rejects(
      writeTeamScheduleOptimistic(
        qc,
        KEY,
        () => Promise.reject(new Error("сеть")),
        A,
        sched("09:00", "18:00"),
      ),
    );
    assert.equal(qc.getQueryData(KEY), undefined);
    qc.clear();
  });
});
