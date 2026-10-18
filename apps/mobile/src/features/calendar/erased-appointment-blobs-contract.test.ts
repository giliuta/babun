import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// «Удалить насовсем» стирает снимок записи, потом её файлы фото (Storage
// API: сначала SELECT объекта, потом DELETE). Партнёру, стёршему свою
// запись, обе политики бакета были закрыты — файлы оставались в хранилище
// навсегда. Снимок уходит раньше файлов, поэтому право держит надгробие
// `erased_appointment_blobs`: кто стёр — тот и стирает файлы.

const root = join(__dirname, "../../../../..");
const MIGRATION = join(root, "supabase/migrations/20261018172000_erased_appointment_blobs.sql");
const sql = existsSync(MIGRATION) ? readFileSync(MIGRATION, "utf8").replace(/\s+/g, " ") : "";
const hook = readFileSync(join(__dirname, "deleted-appointments.ts"), "utf8");

describe("files of an erased appointment", () => {
  test("erasing a trash row leaves a tombstone with the eraser, restore does not", () => {
    assert.ok(sql, "migration is missing");
    assert.match(sql, /after delete on public\.deleted_appointments for each row execute function public\.deleted_appointment_leave_tombstone\(\)/);
    assert.match(sql, /if exists \( select 1 from public\.appointments a where a\.id = old\.id and a\.tenant_id = old\.tenant_id \) then return old;/);
    assert.match(sql, /values \(old\.id, old\.tenant_id, old\.team_id, old\.kind, old\.created_by, auth\.uid\(\)\)/);
  });

  test("only the eraser with the files right reaches the blobs, and only once the trash row is gone", () => {
    assert.match(sql, /not exists \(select 1 from public\.deleted_appointments d where d\.id = p_appointment_id\)/);
    assert.match(sql, /e\.erased_by = auth\.uid\(\)/);
    assert.match(sql, /access_calendars\('record\.files', 'write'\)/);
    // SELECT и DELETE вместе: без SELECT Storage API молча ничего не удаляет.
    for (const cmd of ["select", "delete"]) {
      assert.match(
        sql,
        new RegExp(
          `create policy storage_appointment_photos_${cmd}_erased on storage\\.objects for ${cmd} to authenticated using \\( bucket_id = 'appointment-photos' .*?public\\.current_user_erased_appointment_blob\\(`,
        ),
        cmd,
      );
    }
    assert.match(sql, /revoke all on table public\.erased_appointment_blobs from public, anon, authenticated/);
  });

  test("the app erases the snapshot before it removes the files", () => {
    const erase = hook.indexOf("await eraseDeletedAppointment(");
    const blobs = hook.indexOf("removePhotoBlobs(supabase, item.photoPaths)");
    assert.ok(erase > 0 && blobs > erase);
  });
});
