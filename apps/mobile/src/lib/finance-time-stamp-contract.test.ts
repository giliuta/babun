import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ОПЕРАЦИЯ СЕГОДНЯШНЕГО ДНЯ — СО ВРЕМЕНЕМ (20261016160000). Перевод и оплата
// инвойса писались только датой и падали в ленте под все операции дня.
// Сторож один на любую вставку; задним числом время не выдумывается.

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(here, "../../../../supabase/migrations");
const FILE = "20261016160000_finance_time_for_today.sql";
const sql = readFileSync(path.join(MIGRATIONS, FILE), "utf8");

test("время ставится только пустому и только сегодняшнему дню компании", () => {
  assert.match(sql, /if new\.occurred_time is not null or new\.occurred_on is null then\s+return new;/);
  assert.match(sql, /if new\.occurred_on = local_now::date then\s+new\.occurred_time := date_trunc\('minute', local_now\)::time;/);
  assert.match(sql, /before insert on public\.finance_transactions\s+for each row execute function public\.stamp_finance_transaction_time\(\);/);
});

test("сторож времени не переопределён позже и не вызывается клиентом", () => {
  const later = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql") && f > FILE)
    .filter((f) => /function public\.stamp_finance_transaction_time\(|trg_aa_stamp_finance_time/.test(
      readFileSync(path.join(MIGRATIONS, f), "utf8"),
    ));
  assert.deepEqual(later, []);
  assert.match(sql, /revoke all on function public\.stamp_finance_transaction_time\(\) from public, anon, authenticated;/);
});
