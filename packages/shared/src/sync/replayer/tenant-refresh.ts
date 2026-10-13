// Whether queued ops hold the authoritative server refresh of a table.

import type { CachedTable, QueuedOp } from "../../db/cache/sql";
import { MAX_ATTEMPTS } from "./options";
import { awaitedParentId, parentInsertId } from "./table-rules";

/** ДЕРЖИТ ЛИ ОПЕРАЦИЯ ПЕРЕЧИТКУ ТАБЛИЦЫ ЭТОЙ КОМПАНИИ (аудит 2026-10-03).
 *  Перечитка с сервера пропускается, пока своя операция той же таблицы ждёт
 *  выгрузки: снимок сервера стёр бы оптимистичную строку раньше, чем она
 *  туда дойдёт. Но операция ДРУГОЙ компании под текущей не уходит никогда
 *  (гейт компании в `drain`), и без этой сверки она замораживала
 *  календарь, клиентов и теги текущей компании до возвращения в ту: не
 *  видно ни правок партнёров, ни удалений, ни оплат. Её строк перечитка и не
 *  касается — `cacheReplaceTenant` меняет только строки своей компании.
 *  Операция без компании в теле (правки до 24.09) держит, как раньше:
 *  гейт узнает её компанию из кэша, а здесь осторожнее не гадать. */
export function holdsTenantRefresh(
  op: QueuedOp,
  table: CachedTable,
  tenantId: string,
): boolean {
  if (op.table !== table || op.attempts >= MAX_ATTEMPTS) return false;
  const opTenant = (op.payload as { tenant_id?: unknown } | null)?.tenant_id;
  return (
    typeof opTenant !== "string" || opTenant.length === 0 || opTenant === tenantId
  );
}

/** ДЕРЖИТ ЛИ ОЧЕРЕДЬ ПЕРЕЧИТКУ ТАБЛИЦЫ ЭТОЙ КОМПАНИИ.
 *
 *  Правки, придержанные за навсегда упавшей операцией своей строки (см.
 *  `drain`), сами не уйдут, пока человек не нажмёт «Повторить» или
 *  «Удалить», — держать ими перечитку значило бы заморозить весь календарь
 *  из-за одной строки. Они ждут в «Синхронизации», как и упавшая. */
export function tenantRefreshHeld(
  pending: readonly QueuedOp[],
  table: CachedTable,
  tenantId: string,
): boolean {
  const stuck = new Set(
    pending
      .filter((op) => op.attempts >= MAX_ATTEMPTS)
      .map((op) => `${op.table}:${op.row_id}`),
  );
  // ЖДУЩАЯ НАВСЕГДА УПАВШЕГО КЛИЕНТА — ТОЖЕ ЗАСТРЯЛА (аудит 04.10). Запись,
  // заведённая без сети к новому клиенту, ждёт его вставку, попыток не тратя
  // (`waitsForClient` в `drain`). Упала вставка клиента навсегда («номер уже
  // заведён», конец пробного) — запись ждала бы вечно и держала перечитку
  // календаря: чужие брони, удаления и оплаты на телефоне не появлялись, и
  // занятое время выглядело свободным. Она ждёт в «Синхронизации» вместе с
  // клиентом; на сетке остаётся (`appointmentsCached`, неотправленные вставки).
  const failedClientInserts = new Set(
    pending
      .filter((op) => op.attempts >= MAX_ATTEMPTS && parentInsertId(op) !== null)
      .map((op) => op.row_id),
  );
  if (failedClientInserts.size > 0) {
    for (const op of pending) {
      const clientId = awaitedParentId(op);
      if (clientId !== null && failedClientInserts.has(clientId)) {
        stuck.add(`${op.table}:${op.row_id}`);
      }
    }
  }
  return pending.some(
    (op) =>
      holdsTenantRefresh(op, table, tenantId) && !stuck.has(`${op.table}:${op.row_id}`),
  );
}
