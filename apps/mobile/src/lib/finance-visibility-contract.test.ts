import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ВИДИМОСТЬ ФИНАНСОВ ПАРТНЁРУ И КОРЗИНА ОПЕРАЦИЙ (миграция
// 20261016150100). Корзина и журнал отдают снимки денег, и правила живой
// таблицы — скрытые счета и окно «Ограничения» — обязаны действовать и там.
// Клиент не зовёт `tenant_currency` вовсе, а `tenant_business_date` — только
// со своей компанией: чужую базу об этом не спрашиваем.

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../../..");
const MIGRATION = path.join(
  REPO,
  "supabase/migrations/20261016150100_finance_partner_visibility_and_trash.sql",
);

function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : files(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function policyBody(sql: string, name: string): string {
  const start = sql.indexOf(`create policy ${name} `);
  assert.ok(start >= 0, `в миграции нет политики ${name}`);
  const end = sql.indexOf("\n  );\n", start);
  return sql.slice(start, end);
}

test("корзина операций: скрытые счета и окно финансов режут и чтение, и стирание", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  for (const name of ["deleted_operations_select", "deleted_operations_delete"]) {
    const body = policyBody(sql, name);
    assert.match(body, /hidden_account_ids\(\)/, name);
    assert.match(body, /member_finance_window_starts\(\)/, name);
    assert.match(body, /operation ->> 'occurred_on'/, name);
  }
});

test("журнал партнёра: тип операции, счёт и окно; запись без account_id скрыта", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const body = policyBody(sql, "change_log_select_partner");
  assert.match(body, /\(meta \? 'account_id'\)/);
  assert.match(body, /hidden_account_ids\(\)/);
  assert.match(body, /member_finance_window_starts\(\)/);
  assert.match(body, /access_calendars\('finance\.accounts', 'read'\)/);
  // События скрытого счёта скрыты и в разделе «Счета».
  assert.match(body, /entity_id <> all/);
  // Прежнее правило «Доход ∪ Расход» одной строкой больше не живёт.
  assert.doesNotMatch(body, /access_calendars\('finance\.income', 'read'\) \|\| public\.access_calendars\('finance\.expense', 'read'\)/);
  // Ключи, которые политика читает, пишет log_change.
  assert.match(sql, /'account_id', v_row ->> 'account_id'/);
  assert.match(sql, /'debt_id', v_row ->> 'debt_id'/);
});

test("справки о компании: клиент не зовёт tenant_currency и tenant_business_date чужой компании", () => {
  const roots = ["apps/mobile/src", "apps/mobile/app", "supabase/functions"].map((r) => path.join(REPO, r));
  const callers = roots
    .flatMap(files)
    .filter((f) => /["'`]tenant_currency["'`]/.test(readFileSync(f, "utf8")))
    .map((f) => path.relative(REPO, f));
  assert.deepEqual(callers, []);

  const sql = readFileSync(MIGRATION, "utf8");
  assert.match(sql, /revoke all on function public\.tenant_currency\(uuid\) from public, anon, authenticated;/);
  assert.match(sql, /revoke all on function public\.tenant_business_date\(uuid\) from public, anon;/);
  assert.match(sql, /tm\.user_id = auth\.uid\(\) and tm\.tenant_id = p_tenant_id/);
});

test("доход с возвратом в корзине не удаляется, новый сторож закрыт для клиента", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  assert.match(sql, /create trigger trg_guard_income_with_trashed_refund\s+before delete on public\.finance_transactions/);
  assert.match(sql, /revoke all on function public\.guard_income_with_trashed_refund\(\) from public, anon, authenticated;/);
});
