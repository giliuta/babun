import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import type { Appointment } from "../../local/appointments";
import { rowToAppointment } from "./appointments";

// «УДАЛЁННЫЕ ЗАПИСИ» (миграция 20261016170000) — как «Удалённые операции».
//
// Удалённая запись или событие уходит из календаря целиком, а снимок строки
// (с фото, ссылкой клиента и отвязанными SMS) 30 дней лежит в
// `deleted_appointments`. Сетка, слоты, напоминания и история клиента ящик не
// читают — для них записи нет. Отсюда её возвращают («Вернуть» — та же строка
// с тем же id) или стирают насовсем. Кто что видит, решает сервер теми же
// условиями, что RLS ящика: владелец — всё, остальные — своё удалённое там,
// где и сейчас могут удалять.
//
// Снимок читается только функцией `list_deleted_appointments`: колонки
// `appointment` и `dependents` приложению закрыты. В снимке цена, клиент,
// адрес и токены ссылки клиента и оценки мастера; сотруднику функция отдаёт
// запись через ту же маску блоков, что и его календарь, а из `dependents` —
// только пути фото.

type DbSupabase = SupabaseClient<Database>;
type AppointmentRow = Database["public"]["Tables"]["appointments"]["Row"];

/** Строка ответа `list_deleted_appointments`. */
interface DeletedAppointmentJson {
  id: string;
  team_id: string;
  kind: string;
  created_by: string | null;
  deleted_at: string;
  purge_at: string;
  deleted_by: string | null;
  photo_paths: unknown;
  appointment: AppointmentRow;
}

export interface DeletedAppointment {
  id: string;
  teamId: string;
  kind: string;
  /** Автор: событие возвращает только он. */
  createdBy: string | null;
  deletedAt: string;
  /** Когда снимок сотрёт ночная очистка. */
  purgeAt: string;
  deletedBy: string | null;
  /** Пути файлов фото: «Удалить насовсем» стирает их из хранилища. */
  photoPaths: string[];
  /** Запись, какой она была в миг удаления. */
  appointment: Appointment;
}

function photoPaths(paths: unknown): string[] {
  if (!Array.isArray(paths)) return [];
  return paths.filter((path): path is string => typeof path === "string" && path.length > 0);
}

/** Ящик компании (её задаёт сессия), свежие сверху; с `teamId` — только
 *  этот календарь. */
export async function listDeletedAppointments(
  supabase: DbSupabase,
  teamId?: string | null,
): Promise<DeletedAppointment[]> {
  const { data, error } = await supabase.rpc(
    "list_deleted_appointments",
    teamId ? { p_team_id: teamId } : {},
  );
  if (error) throw new Error(`listDeletedAppointments: ${error.message}`);
  return ((data ?? []) as unknown as DeletedAppointmentJson[]).map((row) => ({
    id: row.id,
    teamId: row.team_id,
    kind: row.kind,
    createdBy: row.created_by,
    deletedAt: row.deleted_at,
    purgeAt: row.purge_at,
    deletedBy: row.deleted_by,
    photoPaths: photoPaths(row.photo_paths),
    // Снимок — строка записей (у сотрудника — с маской его календаря): те же
    // поля, что у живой строки.
    appointment: rowToAppointment(row.appointment),
  }));
}

/** «Удалить» в календаре: запись уходит в ящик. Отказ сервера (деньги на
 *  записи, нет права) доходит текстом. */
export async function trashAppointment(supabase: DbSupabase, id: string): Promise<void> {
  const { data, error } = await supabase.rpc("delete_appointment", { p_id: id });
  if (error || !data) {
    throw new Error(`deleteAppointment: ${error?.message ?? "Запись недоступна или уже удалена"}`);
  }
}

/** «Вернуть»: запись снова в календаре с тем же id, с фото и связями. */
export async function restoreDeletedAppointment(
  supabase: DbSupabase,
  id: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("restore_deleted_appointment", { p_id: id });
  if (error || !data) {
    throw new Error(`restoreAppointment: ${error?.message ?? "Записи нет в «Удалённых»"}`);
  }
}

/** «Удалить насовсем» — снимок стирается раньше срока. */
export async function eraseDeletedAppointment(
  supabase: DbSupabase,
  id: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("deleted_appointments")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(`eraseAppointment: ${error?.message ?? "Записи нет в «Удалённых»"}`);
  }
}
