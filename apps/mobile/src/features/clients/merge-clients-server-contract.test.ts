import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ДУБЛЬ НЕ УНОСИТ НИЧЕГО С СОБОЙ. Слияние переносило только визиты, а дубль
// через 30 дней стирался — с файлами карточки (cascade), долгами (set null),
// записями в «Удалённых записях» и SMS. Сервер сливает одной транзакцией;
// здесь — что именно он обязан перенести и кому это можно.

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  resolve(here, "../../../../../supabase/parked/20261027234500_merge_clients.sql"),
  "utf8",
);
const body = sql.slice(sql.indexOf("create or replace function public.merge_clients("));

test("сливает только владелец, две разные живые карточки, под замком", () => {
  assert.match(body, /public\.current_user_role\(\) is distinct from 'owner' then/);
  assert.match(body, /p_primary = p_duplicate then/);
  assert.match(body, /order by c\.id\s+for update;/);
  assert.match(body, /prim\.deleted_at is not null or dup\.deleted_at is not null/);
});

test("правка основной — той же дверью, что обычная правка карточки", () => {
  assert.match(body, /perform public\.update_client_with_tags\(active_tenant, p_primary,/);
  assert.match(body, /perform public\.set_client_sms_opt_out\(p_primary, true\);/);
});

test("к основной переезжает всё, что держится за дубля", () => {
  for (const table of [
    "appointments",
    "deleted_appointments",
    "client_attachments",
    "debts",
    "recurring_reminders",
    "sms_messages",
    "master_ratings",
    "location_requests",
  ]) {
    assert.match(body, new RegExp(`update public\\.${table}\\b`), table);
  }
  assert.match(body, /'\{client_id\}', to_jsonb\(p_primary::text\)\)/);
  assert.match(body, /set referred_by_client_id = p_primary/);
  // дубль — в корзину, а не насовсем
  assert.match(body, /set deleted_at = now\(\),\s+purge_at = now\(\) \+ interval '30 days'/);
  assert.doesNotMatch(body, /delete from public\.clients/);
});

test("оплаченный визит у дубля — отказ до первой записи", () => {
  const paid = body.indexOf("hint = 'merge:paid_visits'");
  const firstWrite = body.indexOf("perform public.update_client_with_tags(");
  assert.ok(paid > -1 && paid < firstWrite);
});

test("файл карточки ищет клиента по своей строке — путь называет дубля", () => {
  assert.match(sql, /from public\.client_attachments a\s+where a\.storage_path = p_name/);
  for (const name of ["select", "delete", "update", "select_block", "delete_block", "update_block"]) {
    const at = sql.indexOf(`alter policy storage_client_attachments_${name} on storage.objects`);
    assert.ok(at > -1, name);
    const stmt = sql.slice(at, sql.indexOf(";", at));
    assert.match(stmt, /public\.client_attachment_owner\(name\)/, name);
    assert.doesNotMatch(stmt, /foldername\(name\)\)\[2\]/, name);
  }
});

test("функции закрыты от anon", () => {
  assert.match(sql, /revoke all on function public\.merge_clients\(uuid, uuid, jsonb, uuid\[\], jsonb\) from public, anon;/);
  assert.match(sql, /revoke all on function public\.client_attachment_owner\(text\) from public, anon;/);
});
