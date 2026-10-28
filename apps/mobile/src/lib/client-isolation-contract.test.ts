// ИЗОЛЯЦИЯ КЛИЕНТОВ НА СЕРВЕРЕ (P0 владельца: «чтобы муха не пролетела»).
// Две миграции: справочники клиента читаются только по своим живым командам,
// а у клиента — тег, метка, источник, тип объекта и «Люди» только из
// обслуживающих живых команд (его команда и команды его записей). Обе
// прогнаны с откатом на боевой; здесь сторожится смысл до наката.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** До наката файл лежит в `supabase/parked/`, после — в `supabase/migrations/`. */
function migration(file: string): string {
  for (const dir of ["supabase/migrations", "supabase/parked"]) {
    const full = path.join(REPO_ROOT, dir, file);
    if (existsSync(full)) return readFileSync(full, "utf8");
  }
  assert.fail(`нет ${file} ни в migrations, ни в parked`);
}

function code(sql: string): string {
  return sql.replace(/^\s*--.*$/gm, "");
}

const READS = "20261028200100_client_references_read_by_own_teams.sql";
const WRITES = "20261028200200_client_references_from_serving_teams.sql";

describe("client isolation on the server", () => {
  test("a partner reads tags, labels and object types of his own live teams only", () => {
    const sql = code(migration(READS));
    const tags = sql.slice(sql.indexOf("create policy client_tags_select"), sql.indexOf("drop policy cities_select"));
    assert.ok(!tags.includes("access_company("), "теги снова открыты всей компании");
    assert.match(tags, /team_id in \(select unnest\(public\.access_calendars\('clients', 'read'\)\)\)/);
    const cities = sql.slice(sql.indexOf("create policy cities_select"), sql.indexOf("drop policy location_labels_operational_read"));
    assert.match(cities, /deleted_at is null\s+and team_id in \(select unnest\(public\.member_active_team_ids\(\)\)\)/);
    const types = sql.slice(sql.indexOf("create policy location_labels_operational_read"), sql.indexOf("create view public.cities_live"));
    assert.match(types, /team_id in \(select unnest\(public\.member_active_team_ids\(\)\)\)/);
    // Таблицу команд партнёру RLS не показывает — живые команды читает помощник владельца.
    assert.match(sql, /join public\.teams t\s+on t\.tenant_id = mc\.tenant_id\s+and t\.id = mc\.team_id\s+and t\.is_active/);
    assert.match(sql, /where c\.deleted_at is null\s+and c\.team_id = any\(public\.tenant_active_team_ids\(\)\);/);
    assert.match(sql, /revoke all on public\.cities_live from public, anon;/);
  });

  test("serving teams are the client's team and the teams of his records, live only", () => {
    const sql = code(migration(WRITES));
    const fn = sql.slice(sql.indexOf("create or replace function public.client_serving_teams"), sql.indexOf("create or replace function public.client_checks_apply"));
    assert.match(fn, /and t\.is_active/);
    assert.match(fn, /t\.id = p_team/);
    assert.match(fn, /a\.client_id = p_client\s+and a\.team_id = t\.id/);
    // Сверку минуют только внутренние ходы и помеченные доверенные перезаписи.
    assert.match(sql, /coalesce\(auth\.role\(\), ''\) in \('authenticated', 'anon'\)/);
    assert.match(sql, /current_setting\('babun\.client_refs_trusted', true\)/);
  });

  test("a foreign tag and foreign people are refused, for the owner too", () => {
    const sql = code(migration(WRITES));
    assert.match(sql, /tag\.team_id = any\(public\.client_serving_teams\(new\.tenant_id, new\.client_id, client\.team_id\)\)/);
    assert.match(sql, /using errcode = '23503', hint = 'client:tag_other_team';/);
    assert.match(sql, /hint = ''client:people_other_team''/);
    // Уже стоящий тег правку не запирает: прежнее правило сотрудника остаётся, новое — поверх.
    assert.match(sql, /''client tag belongs to another team''\\n'\s+\|\| E' {8}using errcode = ''23503'', hint = ''client:tag_other_team'';\\n'\s+\|\| E' {4}end if;\\n'\s+\|\| E' {4}-- И у владельца/);
  });

  test("a foreign label, source or object type is dropped, old values stay", () => {
    const sql = code(migration(WRITES));
    const fn = sql.slice(sql.indexOf("create or replace function public.enforce_client_reference_tenant"), sql.indexOf("drop trigger clients_enforce_reference_tenant"));
    assert.match(fn, /new\.city is distinct from old\.city/);
    assert.match(fn, /new\.city := '';/);
    assert.match(fn, /new\.acquisition_source := 'unknown';/);
    assert.match(fn, /else l\.value \|\| jsonb_build_object\('label', ''\)/);
    // Страница «Пришлите адрес» правит одни объекты — триггер обязан на них просыпаться.
    assert.match(sql, /before insert or update of tenant_id, referred_by_client_id, favorite_master_id, city, acquisition_source, locations/);
  });

  test("merge and object type rename are trusted rewrites", () => {
    const sql = code(migration(WRITES));
    assert.equal(sql.split("perform set_config(''babun.client_refs_trusted'', ''on'', true);").length - 1, 2);
    assert.equal(sql.split("perform set_config(''babun.client_refs_trusted'', '''', true);").length - 1, 2);
  });
});
