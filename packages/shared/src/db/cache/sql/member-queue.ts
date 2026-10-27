// Очередь правок сотрудника (`member_queue`).
//
// Владелец пишет таблицы сам, и его офлайн-правка — это строка таблицы
// (`sync_queue`, её сливает реплеер с LWW-сторожем). Сотрудник таблиц не
// пишет вовсе: каждая его правка — вызов двери сервера (`member_appointment_*`,
// оплата, фото), где сервер проверяет его право по блоку. Поэтому его очередь
// хранит не строку, а сам вызов: вид, аргументы, номер записи для порядка.
// Отправляет её тот же вызов, что и без очереди, — мимо прав ничего не уходит.

import { ready } from "./connection";

export interface MemberQueuedOp {
  id: number;
  created_at: number;
  tenant_id: string;
  /** Запись, к которой относится вызов: правки одной записи идут по порядку. */
  record_id: string;
  /** Вид вызова — отправщик выбирается по нему. */
  kind: string;
  args: Record<string, unknown>;
  /** Что это за правка словами — строка в «Синхронизации». */
  label: string;
  attempts: number;
  last_error: string | null;
  /** Сервер отказал — повтор только руками («Повторить» в «Синхронизации»). */
  refused: boolean;
}

type Row = {
  id: number;
  created_at: number;
  tenant_id: string;
  record_id: string;
  kind: string;
  args: string;
  label: string;
  attempts: number;
  last_error: string | null;
  refused: number;
};

function rowToOp(row: Row): MemberQueuedOp {
  return {
    id: row.id,
    created_at: row.created_at,
    tenant_id: row.tenant_id,
    record_id: row.record_id,
    kind: row.kind,
    args: JSON.parse(row.args) as Record<string, unknown>,
    label: row.label,
    attempts: row.attempts,
    last_error: row.last_error,
    refused: row.refused !== 0,
  };
}

export async function enqueueMemberOp(
  op: Pick<MemberQueuedOp, "tenant_id" | "record_id" | "kind" | "args" | "label">,
): Promise<void> {
  const sql = await ready();
  await sql.runAsync(
    `INSERT INTO member_queue (created_at, tenant_id, record_id, kind, args, label, attempts, last_error, refused)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 0)`,
    [Date.now(), op.tenant_id, op.record_id, op.kind, JSON.stringify(op.args), op.label],
  );
}

/** Вся очередь в порядке постановки: id растёт строго по порядку записи, а
 *  часы телефона могут идти назад. */
export async function listMemberOps(): Promise<MemberQueuedOp[]> {
  const sql = await ready();
  const rows = await sql.getAllAsync<Row>(
    `SELECT id, created_at, tenant_id, record_id, kind, args, label, attempts, last_error, refused
       FROM member_queue ORDER BY id ASC`,
  );
  return rows.map(rowToOp);
}

/** Есть ли у записи неотправленные вызовы: новая правка за ними встаёт в
 *  очередь, иначе обгонит их и старая ляжет поверх новой. */
export async function hasMemberOps(recordId: string): Promise<boolean> {
  const sql = await ready();
  const row = await sql.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM member_queue WHERE record_id = ?",
    [recordId],
  );
  return (row?.n ?? 0) > 0;
}

export async function memberQueueDepth(): Promise<number> {
  const sql = await ready();
  const row = await sql.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM member_queue");
  return row?.n ?? 0;
}

export async function removeMemberOp(id: number): Promise<void> {
  const sql = await ready();
  await sql.runAsync("DELETE FROM member_queue WHERE id = ?", [id]);
}

/** Связь оборвалась на отправке — вызов остаётся, счётчик для «Синхронизации». */
export async function noteMemberOpAttempt(id: number, error: string): Promise<void> {
  const sql = await ready();
  await sql.runAsync(
    "UPDATE member_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?",
    [error, id],
  );
}

/** Сервер отказал: вызов ждёт человека, причина — словами. */
export async function markMemberOpRefused(id: number, words: string): Promise<void> {
  const sql = await ready();
  await sql.runAsync(
    "UPDATE member_queue SET refused = 1, attempts = attempts + 1, last_error = ? WHERE id = ?",
    [words, id],
  );
}

/** «Повторить» в «Синхронизации»: отказ снят, вызов снова в очереди. */
export async function retryMemberOp(id: number): Promise<void> {
  const sql = await ready();
  await sql.runAsync(
    "UPDATE member_queue SET refused = 0, attempts = 0, last_error = NULL WHERE id = ?",
    [id],
  );
}

/** Часть вызова уже дошла (из пачки фото уехали первые) — в очереди остаётся
 *  только хвост, чтобы повтор не задвоил уехавшее. */
export async function replaceMemberOpArgs(id: number, args: Record<string, unknown>): Promise<void> {
  const sql = await ready();
  await sql.runAsync("UPDATE member_queue SET args = ? WHERE id = ?", [JSON.stringify(args), id]);
}

/** Компанию убрали с телефона — её вызовы уже никто не отправит. */
export async function clearMemberOpsOfTenant(tenantId: string): Promise<void> {
  const sql = await ready();
  await sql.runAsync("DELETE FROM member_queue WHERE tenant_id = ?", [tenantId]);
}
