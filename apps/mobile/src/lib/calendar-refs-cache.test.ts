import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { MemoryKVStorage, getStorage, setStorage } from "@babun/shared/storage";
import {
  CALENDAR_REFS_STORAGE_KEY,
  isCalendarRefKey,
  restoreCalendarRefs,
  watchCalendarRefs,
} from "./calendar-refs-cache";
import {
  allServicesQueryKey,
  allTeamSchedulesQueryKey,
  appointmentsQueryKey,
  calendarSettingsQueryKey,
  citiesQueryKey,
  clientsQueryKey,
  dayCitiesQueryKey,
  dayExtrasQueryKey,
  debtsRangeQueryKey,
  ledgerRangeQueryKey,
} from "./company-query-keys";

// Сетка календаря рисуется с телефона, не дожидаясь сервера: справочники —
// из этого запаса, записи и клиенты — из SQLite.

const T = "t1";

describe("что идёт в запас справочников календаря", () => {
  test("справочники сетки — да, ключами из реестра компании", () => {
    for (const key of [
      allServicesQueryKey(T, "owner"),
      calendarSettingsQueryKey(T, "master"),
      citiesQueryKey(T, false, null),
      citiesQueryKey(T, true, null),
      dayCitiesQueryKey(T, "owner"),
      allTeamSchedulesQueryKey(T, "dispatcher"),
    ]) {
      assert.equal(isCalendarRefKey(key), true, JSON.stringify(key));
    }
  });

  test("деньги, записи, клиенты и ключи без компании — нет", () => {
    for (const key of [
      dayExtrasQueryKey(T, "owner"),
      ledgerRangeQueryKey(T, "2026-10-01", "2026-10-31", null, null),
      debtsRangeQueryKey(T, "2026-10-01", "2026-10-31", null),
      appointmentsQueryKey(T, "owner"),
      clientsQueryKey(T, "owner"),
      // Страница «Услуги» с экономикой — свой ключ под тем же корнем.
      ["services", "settings-page", T],
      calendarSettingsQueryKey(null, "owner"),
      allServicesQueryKey(null, "owner"),
    ]) {
      assert.equal(isCalendarRefKey(key), false, JSON.stringify(key));
    }
  });
});

describe("круг: ответ сервера → перезапуск → сетка без сервера", () => {
  test("после «перезапуска» справочники на месте и помечены протухшими", async () => {
    setStorage(new MemoryKVStorage());
    const before = new QueryClient();
    const stop = watchCalendarRefs(before);
    const services = [{ id: "s1", name: "Чистка", color: "#2c5be0" }];
    await before.fetchQuery({ queryKey: allServicesQueryKey(T, "owner"), queryFn: async () => services });
    await before.fetchQuery({ queryKey: dayCitiesQueryKey(T, "owner"), queryFn: async () => ({ "a:2026-10-12": "c1" }) });
    await before.fetchQuery({ queryKey: dayExtrasQueryKey(T, "owner"), queryFn: async () => ({ "a:2026-10-12": [{ amount: 50 }] }) });
    stop();

    const after = new QueryClient();
    assert.equal(restoreCalendarRefs(after), 2);
    assert.deepEqual(after.getQueryData(allServicesQueryKey(T, "owner")), services);
    assert.equal(after.getQueryState(allServicesQueryKey(T, "owner"))?.dataUpdatedAt, 0);
    // Деньги дня не хранятся: без сервера их нет.
    assert.equal(after.getQueryData(dayExtrasQueryKey(T, "owner")), undefined);
  });

  test("запас другой компании или роли не читается под этой", async () => {
    setStorage(new MemoryKVStorage());
    const before = new QueryClient();
    const stop = watchCalendarRefs(before);
    await before.fetchQuery({ queryKey: allServicesQueryKey("other", "owner"), queryFn: async () => [{ id: "x" }] });
    stop();
    const after = new QueryClient();
    restoreCalendarRefs(after);
    assert.equal(after.getQueryData(allServicesQueryKey(T, "owner")), undefined);
    assert.equal(after.getQueryData(allServicesQueryKey("other", "master")), undefined);
  });

  test("выход из аккаунта стёр запас — поднимать нечего, старое не воскресает", async () => {
    setStorage(new MemoryKVStorage());
    const qc = new QueryClient();
    const stop = watchCalendarRefs(qc);
    await qc.fetchQuery({ queryKey: dayCitiesQueryKey(T, "owner"), queryFn: async () => ({ k: "c1" }) });
    getStorage().remove(CALENDAR_REFS_STORAGE_KEY);
    await qc.fetchQuery({ queryKey: citiesQueryKey(T, false, null), queryFn: async () => [{ id: "c1" }] });
    stop();
    const fresh = new QueryClient();
    restoreCalendarRefs(fresh);
    assert.equal(fresh.getQueryData(dayCitiesQueryKey(T, "owner")), undefined);
    assert.deepEqual(fresh.getQueryData(citiesQueryKey(T, false, null)), [{ id: "c1" }]);
  });

  // Чистка на выходе и при входе другим человеком — `clear()`: он гасит
  // летящий запрос, и ответ прежнего аккаунта «успехом» не становится.
  test("поздний ответ выброшенного чисткой запроса в запас не идёт", async () => {
    setStorage(new MemoryKVStorage());
    const qc = new QueryClient();
    const stop = watchCalendarRefs(qc);
    let answer: (v: unknown) => void = () => {};
    const pending = qc.fetchQuery({
      queryKey: allServicesQueryKey(T, "owner"),
      queryFn: () => new Promise((resolve) => (answer = resolve)),
    });
    await Promise.resolve();
    qc.clear();
    answer([{ id: "чужое" }]);
    await pending.catch(() => {});
    stop();
    assert.equal(getStorage().get(CALENDAR_REFS_STORAGE_KEY), null);
  });
});

describe("подключение на холодном старте", () => {
  test("query-client поднимает запас, когда хранилище подключено, и пишет ответы", () => {
    const src = readFileSync(path.resolve(__dirname, "query-client.ts"), "utf8").replace(/\/\/.*$/gm, "");
    assert.match(src, /onStorageReady\(\s*\(\)\s*=>\s*restoreCalendarRefs\(queryClient\)\s*\)/);
    assert.match(src, /watchCalendarRefs\(queryClient\)/);
  });
});
