import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ТРАНЗАКЦИЯ ОЧЕРЕДИ ТОЖЕ ЖДЁТ БЛОКИРОВКУ. `withExclusiveTransactionAsync`
// в expo-sqlite открывает НОВОЕ соединение, а `busy_timeout` — настройка
// соединения: у основного она есть, у транзакционного не было. Пока другая
// транзакция (полная замена кэша компании) держала запись, enqueue сразу
// падал «database is locked» вместо того, чтобы подождать. Нативный модуль в
// тесте не живёт, поэтому проверяем исходник: первая команда транзакционного
// соединения — то же ожидание, что у основного.

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "sqlite.ts"), "utf8");

test("основное соединение ждёт блокировку", () => {
  assert.match(source, /this\.db\.execSync\("PRAGMA busy_timeout = 5000;"\);/);
});

test("транзакционное соединение первой командой получает то же ожидание", () => {
  assert.match(
    source,
    /withExclusiveTransactionAsync\(async \(txn\) => \{\s*await txn\.execAsync\("PRAGMA busy_timeout = 5000;"\);\s*await task\(txn as unknown as SqlAdapter\);/,
  );
});
