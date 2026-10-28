// АНОНИМНЫЕ СТРАНИЦЫ (аудит 035, пачка 6). Страницы без входа — онлайн-запись
// /b/, ссылка из SMS /r/, «Пришлите адрес» — зовут базу ролью anon. Пять
// миграций закрывают то, что через них утекало или забивалось: лимит заявок
// по адресу заказчика, детали прошедшей записи по бессрочной ссылке, двери
// оценки мастера, чёрный список в ответе брони, вечный токен страницы записи
// и любую ссылку под видом пина карты. Каждая прогнана с откатом на боевой;
// здесь сторожится смысл до наката и то, что клиент и сервер держат один
// список карт.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { isTrustedMapUrl } from "@babun/shared/common/utils/map-links";

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

/** Строки массива `<name> text[] := array[...]` из охраны миграции. */
function sqlList(sql: string, name: string): string[] {
  const body = new RegExp(`${name} text\\[\\] := array\\[([\\s\\S]*?)\\];`).exec(sql)?.[1] ?? "";
  return [...body.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

describe("anonymous pages hold their limits", () => {
  test("online booking counts the customer's address and caps the calendar per day", () => {
    const sql = code(migration("20261028171100_online_booking_ip_limits.sql"));
    // Колонка без умолчания: старые заявки не получают чужой отпечаток.
    assert.match(sql, /alter table public\.online_booking_requests add column ip_hash text;/);
    // Cloudflare ставит адрес сам — подделанный x-forwarded-for идёт только вторым.
    assert.ok(sql.indexOf("'cf-connecting-ip'") < sql.indexOf("'x-forwarded-for'"));
    assert.match(sql, /revoke execute on function public\.online_booking_client_ip\(\) from public, anon, authenticated;/);
    assert.match(sql, /interval ''1 hour''\) >= 5\\n'/);
    assert.match(sql, /interval ''1 day''\) >= 10\\n'/);
    assert.match(sql, /interval ''1 day''\) >= 50 then\\n'/);
    assert.match(sql, /q\.created_at < now\(\) - interval ''2 days'';\\n'/);
    // Без адреса в заголовках лимит по адресу молчит, а не делит одни 10 заявок на всех.
    assert.match(sql, /if v_ip_hash is not null and \(\\n'/);
  });

  test("a blacklisted number gets the same answer as a booking", () => {
    const sql = code(migration("20261028171100_online_booking_ip_limits.sql"));
    const r5 = sql.slice(sql.indexOf("r5 constant text"), sql.indexOf("begin\n", sql.indexOf("r5 constant text")));
    assert.ok(r5.includes("''state'', ''booked''"), "ответ чёрному списку не похож на бронь");
    assert.ok(!r5.includes("online:refused"), "ответ снова выдаёт чёрный список");
    assert.match(sql, /position\('online:refused' in src\) > 0/);
  });

  test("a past or cancelled link says nothing about the visit", () => {
    const sql = code(migration("20261028171200_appointment_link_closed_after_visit.sql"));
    const past = sql.indexOf("then 'past'");
    assert.ok(past > 0 && past < sql.indexOf("then 'confirmed'"), "подтверждённая прошедшая запись снова «подтверждена» со всеми полями");
    const minimal = sql.slice(sql.indexOf("if v_state in ('cancelled', 'past') then"), sql.indexOf("end if;", sql.indexOf("if v_state in")));
    assert.ok(minimal.length > 0);
    for (const field of ["address", "client_first_name", "date", "services"]) {
      assert.ok(!minimal.includes(`'${field}'`), `прошедшая запись снова отдаёт ${field}`);
    }
  });

  test("rating doors are closed to everyone outside", () => {
    const sql = code(migration("20261028171300_rating_rpcs_closed.sql"));
    assert.match(sql, /revoke execute on function public\.lookup_rating_token\(text\) from public, anon, authenticated;/);
    assert.match(sql, /revoke execute on function public\.submit_rating\(text, integer, text\) from public, anon, authenticated;/);
  });

  test("a new booking link is the owner's and replaces the token", () => {
    const sql = code(migration("20261028171400_online_booking_new_link.sql"));
    assert.match(sql, /v_tenant uuid := public\.online_booking_owner_tenant\(p_team\);/);
    assert.match(sql, /set token = public\.appointment_link_token\(\), updated_at = now\(\)/);
    assert.match(sql, /revoke execute on function public\.online_booking_new_link\(text\) from public, anon;/);
    assert.match(sql, /grant execute on function public\.online_booking_new_link\(text\) to authenticated;/);
  });

  test("a client's pin is a map link — and the app agrees with the server", () => {
    const sql = migration("20261028171500_location_map_hosts.sql");
    assert.match(code(sql), /\|\| E' {2}if v_map <> '''' and not public\.is_map_url\(v_map\) then\\n'/);
    const ok = sqlList(sql, "ok");
    const bad = sqlList(sql, "bad");
    assert.ok(ok.length >= 8 && bad.length >= 6);
    for (const url of ok) assert.equal(isTrustedMapUrl(url), true, url);
    for (const url of bad) assert.equal(isTrustedMapUrl(url), false, url);
  });

  test("the route opens only map links", () => {
    const src = readFileSync(path.join(REPO_ROOT, "apps/mobile/src/features/clients/route-menu.ts"), "utf8");
    assert.match(src, /return \(pin && isTrustedMapUrl\(pin\) \? pin : ""\) \|\| \(address \|\| ""\)\.trim\(\);/);
    assert.match(src, /if \(parsed\.isUrl && !parsed\.coords && isTrustedMapUrl\(clean\)\) \{/);
  });
});
