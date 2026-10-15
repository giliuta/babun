// Schema bootstrap, the local-write counter and the helpers every cache
// module shares (table-name guard, row (de)serialisation).

import { getSql } from "../../../storage/sql/provider";
import type { SqlAdapter } from "../../../storage/sql/types";
import { migrate } from "../schema";
import type { CachedTable } from "../index";
import type { CachedRow } from "./types";

// ─── Schema bootstrap (run-once, awaited by every call) ───────────────
// Mirrors the web cache's `getCache()` singleton: the first call opens +
// migrates; every later call reuses the resolved promise. We memoise the
// *migration*, not a db handle — the handle is the injected SqlAdapter.

let migratePromise: Promise<void> | null = null;

/** Ensure the schema exists, exactly once per process. Returns the live
 *  SqlAdapter so callers can `const sql = await ready()` in one line. */
export async function ready(): Promise<SqlAdapter> {
  const sql = getSql();
  if (!migratePromise) {
    migratePromise = migrate(sql).catch((err) => {
      // Reset so a transient failure (locked db during prewarm) retries
      // on the next call instead of wedging the cache forever.
      migratePromise = null;
      throw err;
    });
  }
  await migratePromise;
  return sql;
}

/** Test seam — drop the memoised migration so a fresh in-memory adapter
 *  re-migrates. Never called in production. */
export function __resetCacheForTests(): void {
  migratePromise = null;
  localWriteSeq.clear();
}

// ─── Local-write sequence (guard for authoritative resync) ────────────
// АВТОРИТЕТНАЯ СВЕРКА НЕ СТИРАЕТ ПРАВКУ, ЛЕГШУЮ ВО ВРЕМЯ ЕЁ ЗАПРОСА.
// Сверка календаря качает снимок сервера секундами (1–6 с на слабой связи),
// а потом целиком заменяет им кэш компании. Перенос или новая запись,
// записанные в кэш за эти секунды, в снимке ещё старые или их нет вовсе — и
// замена возвращала запись на прежнее место до следующей сверки, а
// следующая правка уходила со старым `updated_at` («Запись изменилась на
// другом устройстве»). Счётчик растёт В НАЧАЛЕ каждой локальной записи
// (до первого await), сверка запоминает его до запроса и сверяет внутри
// эксклюзивной транзакции замены: начатая раньше правка отменяет замену,
// начатая позже ляжет после неё и останется.
const localWriteSeq = new Map<CachedTable, number>();

export function bumpLocalWrite(table: CachedTable): void {
  localWriteSeq.set(table, (localWriteSeq.get(table) ?? 0) + 1);
}

/** Сколько раз приложение само писало в таблицу кэша — не сверкой. */
export function cacheLocalWriteSeq(table: CachedTable): number {
  return localWriteSeq.get(table) ?? 0;
}

// ─── Table-name guard ────────────────────────────────────────────────
// `CachedTable` is a compile-time union; we still validate at runtime
// before interpolating it into SQL (table names can't be bound params).
// Every value here is a trusted literal — no user input reaches this.
const TABLE_NAMES: Record<CachedTable, string> = {
  clients: "clients",
  appointments: "appointments",
  tags: "tags",
};

export function tableName(table: CachedTable): string {
  const name = TABLE_NAMES[table];
  if (!name) throw new Error(`[cache] unknown table: ${String(table)}`);
  return name;
}

// ─── Row (de)serialisation ───────────────────────────────────────────

export function serializeRow(row: CachedRow): string {
  return JSON.stringify(row);
}

export function parseRow<T extends CachedRow>(data: string): T {
  return JSON.parse(data) as T;
}

// ─── getCache() shim ─────────────────────────────────────────────────
// The web cache exposes `getCache()` returning an IDBPDatabase, and a few
// call-sites do `(await getCache()).get(table, id)` for single-row reads.
// SQLite has no such handle. We expose `cacheGetOne(table, id)` as the
// first-class single-row read; `getCache()` returns the raw SqlAdapter for
// any advanced/escape-hatch use, keeping the export name present.
export async function getCache(): Promise<SqlAdapter> {
  return ready();
}
