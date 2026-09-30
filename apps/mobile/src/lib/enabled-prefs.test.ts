import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MemoryKVStorage, getStorage, setStorage } from "@babun/shared/storage";

import { createEnabledPrefsStore as createEnabledPrefs } from "./enabled-prefs-core";

// НАБОР У КОМАНДЫ (владелец 30.09): команда без своих настроек живёт набором
// компании, своя запись команды — только её.
const TENANT = "11365a87-bef9-4f6c-a030-b15083fe646b";
const prefs = createEnabledPrefs<"a" | "b" | "c">({
  storageKey: "test-set",
  queryKey: "test-set",
  all: ["a", "b", "c"],
  defaults: ["a", "b", "c"],
});

describe("набор «что предлагать» у команды", () => {
  test("команда без своего набора читает набор компании", () => {
    setStorage(new MemoryKVStorage());
    getStorage().set(`test-set:${TENANT}`, ["a"]);
    assert.deepEqual(prefs.read(TENANT, "team-1"), ["a"]);
    assert.deepEqual(prefs.read(TENANT, null), ["a"]);
  });

  test("свой набор команды — только её: компания и соседи его не видят", () => {
    setStorage(new MemoryKVStorage());
    getStorage().set(`test-set:${TENANT}`, ["a", "b"]);
    getStorage().set(`test-set:${TENANT}:team:team-1`, ["c"]);
    assert.deepEqual(prefs.read(TENANT, "team-1"), ["c"]);
    assert.deepEqual(prefs.read(TENANT, "team-3"), ["a", "b"]);
    assert.deepEqual(prefs.read(TENANT, null), ["a", "b"]);
  });

  test("ключ команды начинается с ключа компании — переход его не сносит", () => {
    setStorage(new MemoryKVStorage());
    getStorage().set(`test-set:${TENANT}:team:team-1:order`, ["c", "b", "a"]);
    assert.deepEqual(prefs.readOrder(TENANT, "team-1"), ["c", "b", "a"]);
  });
});
