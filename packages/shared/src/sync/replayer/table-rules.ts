// Table-specific replay rules — the one place the generic relay asks about
// a table: DB table names, guarded appointment fields, insert preparation,
// cache rows after a conflict, and which ops wait on a parent insert.
// Client-only details live in ./replay-clients.

import type { Database } from "../../db/database.types";
import {
  cacheUpsert,
  type CachedAppointmentData,
  type CachedTable,
  type CachedTag,
  type QueuedOp,
} from "../../db/cache/sql";
import { rowToAppointment } from "../../db/repositories/appointments";
import type { PreparedInsert, ReplayTable } from "./relay";
import {
  awaitedClientId,
  cacheClientServerRow,
  clientInsertId,
  prepareClientInsert,
} from "./replay-clients";

export function tableForOp(t: QueuedOp["table"]): ReplayTable {
  // UI vocab → DB table. See cache layer header for rationale.
  return t === "tags" ? "client_tags" : t;
}

/** ПОЛЯ ЗАПИСИ, КОТОРЫЕ НЕЛЬЗЯ ПРОДАВИТЬ ПОВЕРХ ЧУЖОЙ ПРАВКИ (аудит 03.10).
 *  Статус и деньги решают сервер и сверка финансов: отмена записи с оплатой
 *  — это возврат всех её денег, и он необратим. Правка, вставшая в очередь
 *  до того, как другой телефон принял оплату, силой «последний побеждает»
 *  оформила бы клиенту возврат, которого никто не просил. Такая правка при
 *  конфликте уступает серверу, а человек узнаёт об этом словами. */
export const APPOINTMENT_GUARDED_FIELDS: ReadonlySet<string> = new Set([
  "status",
  "cancel_reason",
  "prepaid_amount",
  "paid_amount",
  "payment_status",
  "payment",
  "payments",
  "payment_method",
]);

/** Правка записи трогает статус или деньги — см. `APPOINTMENT_GUARDED_FIELDS`. */
export function touchesGuardedAppointmentFields(
  table: string,
  payload: Record<string, unknown>,
): boolean {
  return (
    table === "appointments" &&
    Object.keys(payload).some((key) => APPOINTMENT_GUARDED_FIELDS.has(key))
  );
}

/** Сообщение, когда правка статуса или денег уступила серверу. */
export const GUARDED_CONFLICT_MESSAGE =
  "Запись изменилась на другом устройстве, и ваша правка статуса или оплаты не применена. Откройте запись и сделайте это ещё раз.";

/** Insert payload after table rules; a client may replay as an aggregate. */
export function prepareInsert(op: QueuedOp): PreparedInsert {
  if (op.table === "clients") return prepareClientInsert(op);
  return { payload: op.payload as Record<string, unknown>, aggregate: null };
}

/** Duplicate-key insert whose row is NOT on the server: the message. */
export function insertDuplicateMessage(
  tableName: ReplayTable,
  errorMessage: string,
): string {
  return tableName === "clients"
    ? "Клиент с таким номером уже заведён — откройте его карточку, а этот черновик удалите"
    : `replay insert: ${errorMessage}`;
}

/** Canonical server row (conflict refresh / force-update) → cache. */
export async function cacheServerRow(
  op: QueuedOp,
  row: Record<string, unknown>,
): Promise<void> {
  if (op.table === "clients") {
    await cacheClientServerRow(op.row_id, row);
    return;
  }
  await cacheUpsert(op.table as CachedTable, toCachedRow(op.table, row));
}

/** Каноническая серверная Row из force-update → строка кэша. Кэш
 *  appointments хранит ДОМЕННУЮ форму + tenant_id (cache-of-domain,
 *  slice 5) — прогоняем через маппер обычного чтения. clients/tags
 *  оставлены как были: их row→domain мапперы приватны в своих
 *  репозиториях, а строка самовосстанавливается на ближайшем полном
 *  refetch (foreground revalidate / realtime). */
function toCachedRow(
  table: QueuedOp["table"],
  row: Record<string, unknown>,
): CachedTag | CachedAppointmentData {
  if (table === "appointments") {
    const r = row as Database["public"]["Tables"]["appointments"]["Row"];
    return { ...rowToAppointment(r), tenant_id: r.tenant_id };
  }
  return row as CachedTag;
}

/** A parent insert whose failure holds its dependants: the id it creates
 *  (a queued client), or null. */
export function parentInsertId(op: QueuedOp): string | null {
  return clientInsertId(op);
}

/** The parent row a queued op depends on (an appointment's client), or null. */
export function awaitedParentId(op: QueuedOp): string | null {
  return awaitedClientId(op);
}
