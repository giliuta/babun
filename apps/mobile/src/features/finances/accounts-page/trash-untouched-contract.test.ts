import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// СЧЁТ БЕЗ ОПЕРАЦИЙ УДАЛЯЕТСЯ ПРИ ЛЮБОМ СТАРТОВОМ ОСТАТКЕ — и на сервере: оба
// сторожа остатка (удаления и закрытия) пропускают счёт без строк журнала.
// До наката файл лежит в `supabase/parked/`, после — в `migrations/`.
const here = path.dirname(fileURLToPath(import.meta.url));
const file = "20261028001000_account_trash_without_moves.sql";
const repo = path.resolve(here, "../../../../../..");
const found = ["supabase/migrations", "supabase/parked"]
  .map((dir) => path.join(repo, dir, file))
  .find((p) => existsSync(p));

test("миграция правит оба сторожа по якорю в живом теле", () => {
  assert.ok(found, `нет ${file}`);
  const sql = readFileSync(found, "utf8");
  assert.match(sql, /pg_get_functiondef\('public\.account_trash_rules\(\)'::regprocedure\)/);
  assert.match(sql, /pg_get_functiondef\('public\.guard_account_financial_history\(\)'::regprocedure\)/);
  assert.equal(
    sql.match(/and exists \(select 1 from public\.finance_transactions t where t\.account_id = old\.id\) then/g)?.length,
    2,
  );
  assert.equal(sql.match(/якорь проверки остатка не найден/g)?.length, 2);
});
