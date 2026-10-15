import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ЛИМИТЫ ЧУЖОЙ КОМПАНИИ ЗАКРЫТЫ (миграция 20261013120000). `tenant_quota_sms_month`
// и `tenant_quota_team_members` отняты у authenticated: они отдавали квоту SMS и
// тариф ЧУЖОЙ компании по её UUID. Приложение и edge-функции их не зовут —
// и не должны начать, иначе rpc упадёт с «нет прав». Две, что зовёт
// `quota.ts` во всех выпущенных сборках, остаются открытыми.

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../../..");

function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : files(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

test("клиент и edge-функции не зовут отнятые у authenticated лимиты", () => {
  const roots = ["apps/mobile/src", "apps/mobile/app", "supabase/functions"].map((r) => path.join(REPO, r));
  const callers = roots
    .flatMap(files)
    .filter((f) => /["'`]tenant_quota_(sms_month|team_members)["'`]/.test(readFileSync(f, "utf8")))
    .map((f) => path.relative(REPO, f));
  assert.deepEqual(callers, []);
});

test("миграция закрывает ровно две функции и оставляет лимиты выпущенных сборок", () => {
  const sql = readFileSync(path.join(REPO, "supabase/migrations/20261013120000_quota_readers_closed.sql"), "utf8");
  assert.match(sql, /revoke execute on function public\.tenant_quota_sms_month\(uuid\) from public, anon, authenticated;/);
  assert.match(sql, /revoke execute on function public\.tenant_quota_team_members\(uuid\) from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /revoke[^;]*tenant_quota_(clients|appointments_month)/);
  const quota = readFileSync(path.join(REPO, "apps/mobile/src/lib/quota.ts"), "utf8");
  assert.match(quota, /client\.rpc\("tenant_quota_clients"/);
  assert.match(quota, /client\.rpc\("tenant_quota_appointments_month"/);
});
