import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { cacheCopyWins, freshestClientField } from "./freshest-client-field";

// ОБЪЕКТ, ДОБАВЛЕННЫЙ НА КАРТОЧКЕ, НЕ СТИРАЕТ ФОРМА ЗАПИСИ (С11).

const ID = "c-1";
const card = (locations: unknown[], extra: Record<string, unknown> = {}) => ({ id: ID, locations, ...extra });

describe("самая свежая копия объектов клиента", () => {
  test("список, отставший от карточки, не главнее карточки", () => {
    const queries = [
      { data: [card([{ id: "l1" }]), { id: "other", locations: [] }], dataUpdatedAt: 100 },
      { data: card([{ id: "l1" }, { id: "l2" }]), dataUpdatedAt: 200 },
    ];
    assert.deepEqual(freshestClientField(queries, ID, "locations")?.items, [{ id: "l1" }, { id: "l2" }]);
  });

  test("свежий список главнее старой карточки", () => {
    const queries = [
      { data: card([{ id: "l1" }]), dataUpdatedAt: 100 },
      { data: [card([{ id: "l1" }, { id: "l3" }])], dataUpdatedAt: 300 },
    ];
    assert.deepEqual(freshestClientField(queries, ID, "locations")?.items, [{ id: "l1" }, { id: "l3" }]);
  });

  test("строка «его глазами» с пустыми объектами не главнее полной", () => {
    const queries = [
      { data: card([{ id: "l1" }]), dataUpdatedAt: 100 },
      { data: [card([], { blocks: { clients: "read" } })], dataUpdatedAt: 500 },
    ];
    assert.deepEqual(freshestClientField(queries, ID, "locations")?.items, [{ id: "l1" }]);
    // Полной нет (сотрудник) — берём его же окно.
    assert.deepEqual(freshestClientField(queries.slice(1), ID, "locations")?.items, []);
  });

  test("клиента в кэше нет — null; чужие строки не берём", () => {
    assert.equal(freshestClientField([{ data: [{ id: "x", locations: [{ id: "q" }] }], dataUpdatedAt: 1 }], ID, "locations"), null);
    assert.equal(freshestClientField([{ data: undefined, dataUpdatedAt: 0 }], ID, "locations"), null);
  });

  test("копия, прочитанная до конца нашей записи, её не перетирает", () => {
    assert.equal(cacheCopyWins(100, 150), false);
    assert.equal(cacheCopyWins(200, 150), true);
    assert.equal(cacheCopyWins(1, null), true);
  });
});

describe("писатель берёт объекты из кэша, а не из экрана", () => {
  const SRC = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "use-json-writer.ts"), "utf8");
  test("только объекты: реквизиты экран собирает сам", () => {
    assert.match(SRC, /const FIELDS_FROM_CACHE: ReadonlySet<string> = new Set\(\["locations"\]\);/);
  });
  test("копия старше записи — держим свою; копии нет — массив экрана", () => {
    assert.match(SRC, /if \(cached\.kind === "fresh"\) st\.latest = cached\.items;\s*else if \(cached\.kind === "none"\) st\.latest = rendered;/);
    assert.match(SRC, /if \(st\.pending === 0\) st\.settledAt = Date\.now\(\);/);
  });
  test("правка — от свежайшего, даже без перерисовки экрана", () => {
    assert.match(SRC, /if \(sharedKey\) refresh\(st, st\.latest\);\s*return commit\(fn\(st\.latest\)\);/);
  });
});
