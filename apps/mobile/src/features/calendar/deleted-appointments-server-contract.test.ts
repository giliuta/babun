import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// «УДАЛЁННЫЕ ЗАПИСИ» НА СЕРВЕРЕ. Пять правок сделаны точечной заменой в
// боевых телах функций, поэтому буквального определения с ними в репозитории
// нет. Сторож держит сами миграции и следит, чтобы функция, переписанная
// позже целиком, не потеряла правку молча:
//   • снимок ящика (цена, клиент, адрес, токены ссылки и оценки) читается
//     только дверью с маской прав — колонки закрыты, «Вернуть» берёт снимок
//     дверью;
//   • «Вернуть» сохраняет `created_at` и не тратит квоту месяца;
//   • удаление календаря чистит его ящик записей;
//   • готовность снимка отказывает снимку чужой компании;
//   • повторная отмена восстановленной заявки без новых денег — не «возврат».

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "../../../../../supabase/migrations");
const READ = "20261018173000_deleted_appointments_masked_read.sql";
const CREATED_AT = "20261018173100_restored_appointment_keeps_created_at.sql";
const CALENDAR = "20261018173200_delete_calendar_clears_deleted_appointments.sql";
const TENANT = "20261018173300_trash_ready_same_tenant.sql";
const RECANCEL = "20261018173400_recancel_after_restore_not_refunded.sql";

function migration(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8");
}

/** Буквальные тела функции в миграциях после `after`. */
function bodiesAfter(fn: string, after: string): { file: string; body: string }[] {
  const pattern = new RegExp(
    String.raw`create\s+(?:or\s+replace\s+)?function\s+public\.${fn}\s*\([\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\1`,
    "gi",
  );
  const found: { file: string; body: string }[] = [];
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql") && f > after).sort()) {
    for (const match of migration(file).matchAll(pattern)) {
      found.push({ file, body: match[2] ?? "" });
    }
  }
  return found;
}

describe("«Удалённые записи» на сервере", () => {
  test("снимок закрыт колонками и читается дверью с маской сотрудника", () => {
    const sql = migration(READ);
    assert.match(sql, /revoke select on table public\.deleted_appointments from authenticated;/);
    assert.match(
      sql,
      /grant select \(id, tenant_id, team_id, kind, created_by, deleted_by, deleted_at, purge_at\)\s+on table public\.deleted_appointments to authenticated;/,
    );
    assert.match(sql, /create function public\.list_deleted_appointments\(p_team_id text default null\)/);
    // Наружу из `dependents` — только пути фото.
    assert.match(sql, /'photo_paths', jsonb_path_query_array\(\s*d\.dependents, '\$\.photos\[\*\]\.storage_path/);
    assert.doesNotMatch(sql, /'dependents', d\.dependents/);
    // Маска сотрудника — из живого тела его календаря, а не вторая копия.
    assert.match(sql, /pg_get_functiondef\('public\.list_master_appointments_safe\(integer, integer\)'::regprocedure\)/);
    assert.match(sql, /select \* into trashed from public\.deleted_appointment_for_restore\(p_id\);/);
  });

  test("никто позже не открывает колонки снимка снова", () => {
    const later = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql") && f > READ);
    for (const file of later) {
      assert.doesNotMatch(
        migration(file),
        /grant\s+select\s+on\s+(?:table\s+)?public\.deleted_appointments\b/i,
        `${file} открывает весь ящик записей на чтение`,
      );
    }
    for (const { file, body } of bodiesAfter("restore_deleted_appointment", READ)) {
      assert.match(body, /deleted_appointment_for_restore/, `${file}: «Вернуть» читает снимок мимо двери`);
    }
  });

  test("«Вернуть» оставляет день создания и квоту", () => {
    const sql = migration(CREATED_AT);
    assert.match(sql, /current_setting\(''babun\.appointment_restore'', true\)/);
    assert.match(sql, /\(d\.appointment->>''created_at''\)::timestamptz = new\.created_at/);
    for (const { file, body } of bodiesAfter("enforce_tenant_insert_quota", CREATED_AT)) {
      assert.match(body, /babun\.appointment_restore/, `${file}: возвращённая запись снова «создана сегодня»`);
    }
  });

  test("удаление календаря чистит его «Удалённые записи»", () => {
    assert.match(migration(CALENDAR), /delete from public\.deleted_appointments\\n'\s*\|\|\s*E'   where tenant_id = v_tenant and team_id = p_team_id;/);
    for (const { file, body } of bodiesAfter("delete_calendar", CALENDAR)) {
      assert.match(body, /delete from public\.deleted_appointments/, `${file}: ящик календаря остаётся`);
    }
  });

  test("готовность снимка не отвечает про чужую компанию", () => {
    const sql = migration(TENANT);
    assert.match(sql, /tenant is distinct from public\.current_tenant_id\(\)/);
    assert.match(sql, /p_operation->>''tenant_id'', ''''\)::uuid is distinct from public\.current_tenant_id\(\)/);
    for (const fn of ["deleted_appointment_ready", "deleted_operation_ready"]) {
      for (const { file, body } of bodiesAfter(fn, TENANT)) {
        assert.match(body, /current_tenant_id\(\)/, `${file}: ${fn} снова отвечает про чужие id`);
      }
    }
  });

  test("повторная отмена без новых денег не ставит «возвращено»", () => {
    const sql = migration(RECANCEL);
    assert.match(sql, /\) into has_any_auto_income;/);
    assert.match(sql, /where refund\.refund_of_id = income\.id/);
    for (const { file, body } of bodiesAfter("protect_paid_appointment_finance", RECANCEL)) {
      assert.doesNotMatch(
        body,
        /where appointment_id = old\.id and source = 'auto' and type = 'income'/,
        `${file}: сторнированный доход прошлого круга снова считается деньгами`,
      );
    }
  });
});
