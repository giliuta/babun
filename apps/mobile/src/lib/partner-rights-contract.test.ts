// ПРАВА ПАРТНЁРА НА СЕРВЕРЕ (аудит 035, пачка 7). Три миграции: история
// изменений в тех же окнах, что сами таблицы; директор меряет «не выше
// своих» действующим уровнем и ведёт только партнёров общих команд; пуш об
// оплате — имя клиента по праву и без скрытых счетов. Каждая прогнана с
// откатом на боевой; здесь сторожится смысл до наката.

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

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("partner rights on the server", () => {
  test("history rows follow the calendar window and the clients scope", () => {
    const sql = code(migration("20261028190100_change_log_partner_windows.sql"));
    // Запись и её фото — по началу «Окна календаря», как `member_record_hidden`.
    assert.equal(count(sql, "(c.meta ->> ''date'') < (v_rec_from ->> c.team_id), false)"), 2);
    assert.match(sql, /v_rec_from := public\.member_record_window_starts\(\);/);
    // Клиент, его теги и файлы — по базе партнёра; «Без ограничения» открывает команду целиком.
    assert.equal(count(sql, "and (c.team_id = any(v_scope_all) or v_clients ?"), 3);
    assert.match(sql, /from unnest\(public\.access_client_ids\(\)\) as x\(id\);/);
    assert.match(sql, /''clients\.scope'', t\.team_id\), ''week''\) in \(''own'', ''all''\);/);
  });

  test("a director is measured by the effective level and keeps to shared teams", () => {
    const sql = code(migration("20261028190200_director_effective_level_common_team.sql"));
    assert.match(sql, /change_team = any\(public\.access_calendars\(b\.key, v_step\)\)/);
    assert.match(sql, /public\.access_company\(b\.key, v_step\)/);
    // Окна (неделя … без ограничения) ступеней доступа не имеют — там хранимый уровень.
    assert.match(sql, /if b\.levels <@ array\[''off'', ''read'', ''write'', ''full''\] then/);
    assert.match(sql, /from public\.member_calendars theirs\\n'/);
    assert.match(sql, /and mine\.user_id = auth\.uid\(\)\\n'/);
  });

  test("a payment push names the client only to those who see him, and skips unseen accounts", () => {
    const sql = code(migration("20261028190300_push_payment_client_and_accounts.sql"));
    assert.match(sql, /a4 constant text := E' {13}when v_kind = ''payment'' then true\\n';/);
    assert.match(sql, /replace\(replace\(replace\(replace\(d, a1, r1\), a2, r2\), a3, r3\), a4, ''\)/);
    assert.match(sql, /and not public\.push_payment_account_seen\(p_log\.tenant_id, v_account, p\.seen\) then null/);
    assert.match(sql, /and not a\.is_hidden/);
    assert.match(sql, /revoke execute on function public\.push_payment_account_seen\(uuid, uuid, text\[\]\) from public, anon, authenticated;/);
  });
});
