import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ФАЙЛЫ НЕ ПЕРЕЖИВАЮТ СВОИ СТРОКИ. Каскады и ночные очистки уносят строки,
// а SQL блобы не стирает (`storage.protect_delete()`): фото записей, чеки,
// файлы клиентов и публичные логотипы удалённого аккаунта оставались навсегда.
// Удаление аккаунта сносит файлы своих компаний сразу, ночной уборщик —
// остальное; решает SQL, сносит Storage API.

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), "utf8");
const janitor = read("index.ts");
const shared = read("../_shared/tenant-storage.ts");
const accountDelete = read("../account-delete/index.ts");
const cleanup = read("../account-delete-cleanup/index.ts");
const sql = read("../../parked/20261027224300_storage_janitor.sql");
const config = read("../../config.toml");

const BUCKETS = ["appointment-photos", "client-attachments", "partner-files", "receipts", "tenant-logos"];

test("удаление аккаунта: компании — ДО каскада, файлы — ПОСЛЕ удаления входа", () => {
  for (const src of [accountDelete, cleanup]) {
    const owned = src.indexOf("await ownedTenants(");
    const rpc = src.indexOf('"delete_sole_owned_tenants_for_account"');
    const hard = src.lastIndexOf("auth.admin.deleteUser(");
    const purge = src.indexOf("await purgeGoneTenantsStorage(");
    assert.ok(owned > 0 && rpc > owned && hard > rpc && purge > hard,
      "порядок: членства → каскад → удаление входа → снос файлов");
  }
});

test("файлы сносятся только у компании, чьих строк уже нет", () => {
  assert.match(shared, /\.from\("tenants"\)\.select\("id"\)\.in\("id", \[\.\.\.tenantIds\]\)/);
  assert.match(shared, /if \(alive\.has\(tenantId\)\) continue;/);
  assert.match(shared, /\.eq\("role", "owner"\)/);
});

test("один набор бакетов у edge-функций и у SQL", () => {
  for (const b of BUCKETS) {
    assert.ok(shared.includes(`"${b}"`), `tenant-storage: ${b}`);
    assert.ok(sql.includes(`'${b}'`), `storage_janitor_candidates: ${b}`);
  }
});

test("кандидаты — только для service_role, у живой компании — с возрастом и без ссылок", () => {
  assert.match(sql, /revoke all on function public\.storage_janitor_candidates\(integer, interval\)\s+from public, anon, authenticated;/);
  assert.match(sql, /security definer/);
  assert.match(sql, /when ob\.created_at > now\(\) - p_min_age then null/);
  // снимки ящиков «Удалённые …» держат свои файлы до стирания строки
  assert.match(sql, /d\.dependents -> 'photos'/);
  assert.match(sql, /x\.operation ->> 'receipt_url'/);
  // логотип напечатан в выставленных документах
  assert.match(sql, /public\.invoices x where strpos\(x\.seller_snapshot::text, ob\.name\)/);
  assert.match(sql, /public\.receipts x where strpos\(x\.seller_snapshot::text, ob\.name\)/);
});

test("уборщик: секрет крона, сухой режим, снос через Storage API", () => {
  assert.match(janitor, /\.eq\("name", "storage-janitor"\)/);
  assert.match(janitor, /constantTimeEqual\(supplied, secretRow\.secret\)/);
  assert.match(janitor, /if \(mode === "dry"\) return json\(200, \{ mode, candidates \}\);/);
  assert.match(janitor, /removePaths\(service, bucket,/);
  assert.match(config, /\[functions\.storage-janitor\]\nverify_jwt = false/);
  assert.match(sql, /functions\/v1\/storage-janitor/);
  assert.match(sql, /where name = 'storage-janitor'/);
});
