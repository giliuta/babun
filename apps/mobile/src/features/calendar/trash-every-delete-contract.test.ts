import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// ЛЮБОЕ УДАЛЕНИЕ ЗАПИСИ — В «УДАЛЁННЫЕ ЗАПИСИ» (находка владельца №13).
// Ящик снимал запись, только если удаление шло через `delete_appointment`:
// «Отменить» в тосте, реплей очереди и прямой SQL уходили мимо. Теперь ящик —
// по умолчанию, мимо — только стирание, где возвращать некуда.

const root = join(__dirname, "../../../../..");
const NAME = "20261028111000_trash_every_appointment_delete.sql";
const file = [join(root, "supabase/migrations", NAME), join(root, "supabase/parked", NAME)].find((p) =>
  existsSync(p),
);
const sql = file ? readFileSync(file, "utf8").replace(/\s+/g, " ") : "";
const trash = sql.slice(
  sql.indexOf("create or replace function public.trash_deleted_appointment()"),
  sql.indexOf("create or replace function public.deleted_appointment_leave_tombstone()"),
);
const tomb = sql.slice(sql.indexOf("create or replace function public.deleted_appointment_leave_tombstone()"));

describe("appointment trash takes every delete", () => {
  test("no opt-in flag: the snapshot no longer waits for delete_appointment", () => {
    assert.ok(sql, "migration is missing");
    assert.doesNotMatch(trash, /babun\.appointment_trash/);
    assert.match(trash, /insert into public\.deleted_appointments/);
  });

  test("skips only where there is nothing to return to", () => {
    const skips = [
      /if old\.team_id is null then return old;/,
      /if public\.calendar_delete_in_progress\(\) then return old;/,
      /if not exists \(select 1 from public\.tenants t where t\.id = old\.tenant_id\) then return old;/,
      /if old\.kind in \('event', 'personal'\) and exists \( select 1 from auth\.users u where u\.id = old\.created_by and u\.deleted_at is not null \) then return old;/,
    ];
    for (const re of skips) assert.match(trash, re);
    // Пропуски — до снимка, иначе он уже вставлен.
    const insertAt = trash.indexOf("insert into public.deleted_appointments");
    for (const re of skips) assert.ok(trash.search(re) < insertAt, String(re));
  });

  test("a deleted company's cascade leaves no tombstone pointing at it", () => {
    const skip = tomb.search(/if not exists \(select 1 from public\.tenants t where t\.id = old\.tenant_id\) then return old;/);
    assert.ok(skip > -1 && skip < tomb.indexOf("insert into public.erased_appointment_blobs"));
  });

  test("both stay definer with a pinned search_path", () => {
    for (const body of [trash, tomb]) {
      assert.match(body, /security definer set search_path = public as \$function\$/);
    }
  });
});
