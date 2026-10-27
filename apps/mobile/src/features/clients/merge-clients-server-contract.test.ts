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
  resolve(here, "../../../../../supabase/migrations/20261027234500_merge_clients.sql"),
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
  // «Люди» дубля: связь хранится у того, кто входит, — переписывается у них
  assert.match(body, /when e\.value ->> 'group_id' = p_duplicate::text then/);
  assert.match(body, /and c\.id not in \(p_primary, p_duplicate\)/);
  assert.match(body, /select distinct on \(x\.item ->> 'group_id', coalesce\(x\.item ->> 'location_id', ''\)\)/);
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

// СТРОКА ФАЙЛА НЕ НАЗЫВАЕТ ЧУЖОЙ ФАЙЛ. Политики Storage верят строке, значит
// партнёр со своим клиентом X не должен суметь записать строку на путь файла
// клиента Y — иначе он читал бы и удалял чужой файл.
test("путь файла — уникальный, свой при вставке, неизменный; клиента меняет только слияние", () => {
  assert.match(sql, /create unique index if not exists client_attachments_storage_path_key\s+on public\.client_attachments \(storage_path\);/);
  const guard = sql.slice(sql.indexOf("create or replace function public.client_attachments_path_guard()"));
  assert.match(guard, /split_part\(new\.storage_path, '\/', 1\) is distinct from new\.tenant_id::text/);
  assert.match(guard, /split_part\(new\.storage_path, '\/', 2\) is distinct from new\.client_id::text/);
  assert.match(guard, /new\.storage_path is distinct from old\.storage_path/);
  assert.match(guard, /coalesce\(current_setting\('babun\.merge_clients', true\), ''\) <> 'on'/);
  assert.match(sql, /before insert or update on public\.client_attachments/);
  // флаг поднимается только вокруг переноса файлов и сразу опускается
  const on = body.indexOf("perform set_config('babun.merge_clients', 'on', true);");
  const move = body.indexOf("update public.client_attachments");
  const off = body.indexOf("perform set_config('babun.merge_clients', '', true);");
  assert.ok(on > -1 && on < move && move < off, "флаг слияния открыт шире переноса файлов");
});
