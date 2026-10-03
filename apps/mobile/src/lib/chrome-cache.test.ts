import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { MemoryKVStorage, getStorage, setStorage } from "@babun/shared/storage";
import {
  CHROME_STORAGE_KEY,
  isChromeKey,
  nextChromeStore,
  restoreChrome,
  watchChrome,
  type ChromeStore,
} from "./chrome-cache";

// Владелец 03.10: без сервера шапка вкладок (команды, роль) должна остаться.

describe("что запоминается", () => {
  test("шапка — да, данные — нет", () => {
    for (const key of [
      ["current-role", "t1"],
      ["my-memberships", "u1"],
      ["my-calendars", "u1"],
      ["my-access", "t1"],
      ["teams", "t1", "owner", true],
      ["tenant", "t1", "owner"],
    ]) {
      assert.equal(isChromeKey(key), true, JSON.stringify(key));
    }
    for (const key of [["clients", "t1", "owner"], ["appointments", "t1", "owner"], ["finance-transactions", "t1"]]) {
      assert.equal(isChromeKey(key), false, JSON.stringify(key));
    }
  });

  test("тот же ответ — хранилище не трогаем", () => {
    const store = nextChromeStore({}, ["current-role", "t1"], "owner", 1);
    assert.equal(nextChromeStore(store, ["current-role", "t1"], "owner", 2), store);
    assert.notEqual(nextChromeStore(store, ["current-role", "t1"], "master", 2), store);
  });

  test("сверх предела уходят самые старые", () => {
    let store: ChromeStore = {};
    for (let i = 0; i < 5; i++) store = nextChromeStore(store, ["teams", `t${i}`], [i], i, 3);
    assert.deepEqual(
      Object.values(store).map((e) => e.key[1]).sort(),
      ["t2", "t3", "t4"],
    );
  });
});

describe("круг: записали → перезапуск → подняли", () => {
  test("после «перезапуска» шапка на месте и помечена протухшей", async () => {
    setStorage(new MemoryKVStorage());
    const before = new QueryClient();
    const stop = watchChrome(before);
    await before.fetchQuery({ queryKey: ["current-role", "t1"], queryFn: async () => "owner" });
    await before.fetchQuery({ queryKey: ["teams", "t1", "owner", true], queryFn: async () => [{ id: "a", name: "Команда 1" }] });
    await before.fetchQuery({ queryKey: ["clients", "t1", "owner"], queryFn: async () => [{ id: "c" }] });
    stop();

    const after = new QueryClient();
    assert.equal(restoreChrome(after), 2);
    assert.equal(after.getQueryData(["current-role", "t1"]), "owner");
    assert.deepEqual(after.getQueryData(["teams", "t1", "owner", true]), [{ id: "a", name: "Команда 1" }]);
    // Клиенты — данные, а не шапка: без сервера их нет.
    assert.equal(after.getQueryData(["clients", "t1", "owner"]), undefined);
    assert.equal(after.getQueryState(["current-role", "t1"])?.dataUpdatedAt, 0);
  });

  test("стёрли выходом из аккаунта — поднимать нечего, старое не воскресает", async () => {
    setStorage(new MemoryKVStorage());
    const qc = new QueryClient();
    const stop = watchChrome(qc);
    await qc.fetchQuery({ queryKey: ["current-role", "t1"], queryFn: async () => "owner" });
    getStorage().remove(CHROME_STORAGE_KEY);
    await qc.fetchQuery({ queryKey: ["my-access", "t1"], queryFn: async () => ({ blocks: {} }) });
    stop();
    const fresh = new QueryClient();
    restoreChrome(fresh);
    assert.equal(fresh.getQueryData(["current-role", "t1"]), undefined);
    assert.deepEqual(fresh.getQueryData(["my-access", "t1"]), { blocks: {} });
  });

  test("уже есть данные — поднятое их не затирает", () => {
    setStorage(new MemoryKVStorage());
    getStorage().set(CHROME_STORAGE_KEY, nextChromeStore({}, ["current-role", "t1"], "master", 1));
    const qc = new QueryClient();
    qc.setQueryData(["current-role", "t1"], "owner");
    assert.equal(restoreChrome(qc), 0);
    assert.equal(qc.getQueryData(["current-role", "t1"]), "owner");
  });
});
