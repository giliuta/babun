import { describe, expect, it } from "bun:test";
import {
  NoCacheSqlAdapter,
  OfflineQueueUnavailableError,
} from "./no-cache";

// Договор веб-заглушки: кэша нет, но потери данных тоже нет. Всё, что
// является зеркалом сервера, можно проглотить; обещание «сохраню позже»
// проглотить нельзя.
describe("NoCacheSqlAdapter", () => {
  const sql = new NoCacheSqlAdapter();

  it("чтение — всегда промах", async () => {
    expect(await sql.getAllAsync("SELECT data FROM clients")).toEqual([]);
    expect(await sql.getFirstAsync("SELECT data FROM clients")).toBeNull();
  });

  it("зеркальная запись проходит вхолостую", async () => {
    expect(
      await sql.runAsync("INSERT INTO clients (id) VALUES (?)", ["c1"]),
    ).toEqual({ lastInsertRowId: 0, changes: 0 });
    await sql.execAsync("CREATE TABLE IF NOT EXISTS clients (id TEXT)");
  });

  it("постановка в очередь отказывает громко", async () => {
    await expect(
      sql.runAsync(
        `INSERT INTO sync_queue
           (created_at, table_name, op, row_id, payload, expected_updated_at, attempts, last_error)
           VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`,
        [1, "clients", "insert", "c1", "{}", null],
      ),
    ).rejects.toBeInstanceOf(OfflineQueueUnavailableError);
  });

  it("чистка очереди проходит — выходить из аккаунта надо уметь", async () => {
    await sql.runAsync("DELETE FROM sync_queue WHERE id = ?", [1]);
    await sql.execAsync("DELETE FROM sync_queue;");
  });

  it("атомарная пара падает на очереди, а не на зеркале", async () => {
    await expect(
      sql.withExclusiveTransactionAsync(async (txn) => {
        await txn.runAsync("INSERT INTO clients (id) VALUES (?)", ["c1"]);
        await txn.runAsync("INSERT INTO sync_queue (row_id) VALUES (?)", ["c1"]);
      }),
    ).rejects.toBeInstanceOf(OfflineQueueUnavailableError);
  });
});
