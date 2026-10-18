// Replay of a queued INSERT.

import { cacheDelete, type QueuedOp } from "../../db/cache/sql";
import { isUuid } from "../uuid";
import { relayClient, type DbSupabase, type ReplayTable } from "./relay";
import type { AppliedFn } from "./sentinel";
import { insertDuplicateMessage, prepareInsert } from "./table-rules";

export async function replayInsert(
  supabase: DbSupabase,
  op: QueuedOp,
  tableName: ReplayTable,
  /** Вставка через функцию сервера встала со своей версией строки. */
  onApplied?: AppliedFn,
): Promise<false> {
  const prepared = prepareInsert(op);
  if (prepared.aggregate) {
    await prepared.aggregate(supabase, onApplied);
    return false;
  }
  let payload = prepared.payload;

  // v489 — defensive: pre-v489 queued inserts may carry a non-UUID
  // `id` (`apt-mp2we5l1-...`) inside the payload. Supabase's id
  // columns are uuid → INSERT 22P02 «invalid input syntax for type
  // uuid», stranding the row. Strip the id so the server allocates
  // a fresh UUID, then drop the local-id row from IDB cache so
  // the orphan optimistic row doesn't double up next list().
  let stripped = false;
  if (!isUuid(op.row_id) && typeof payload === "object" && payload !== null) {
    const { id: _id, ...rest } = payload as { id?: string };
    void _id;
    payload = rest;
    stripped = true;
  }
  const { error } = await relayClient(supabase).from(tableName).insert(payload);
  if (error) {
    // v502 — idempotent insert: a duplicate-key error means the row
    // is already on the server (the previous attempt's HTTP response
    // got lost — app closed mid-flight, network blip, etc.). Treat
    // as success so the queue entry drops instead of getting stuck
    // forever retrying the same DOA insert. Without this, the panel
    // showed «replay insert: duplicate key value violates unique
    // constraint "appointments_pkey"» indefinitely after the user's
    // first successful save.
    //
    // PG code 23505 is the canonical signal; we also fall back to a
    // message-match because supabase-js can wrap the error and lose
    // the code in some paths.
    const code = (error as { code?: string }).code;
    const dup =
      code === "23505" || /duplicate key/i.test(error.message);
    if (!dup) throw new Error(`replay insert: ${error.message}`);
    // 23505 бывает ДВУХ РАЗНЫХ смыслов, и раньше они путались:
    //   • конфликт по ПЕРВИЧНОМУ ключу — строка действительно уже на
    //     сервере (ответ прошлой попытки потерялся), операцию можно снять;
    //   • конфликт по ДРУГОМУ уникальному индексу — например,
    //     clients_tenant_phone_e164_idx: номер занят ЧУЖИМ клиентом.
    //     Строки на сервере НЕТ, и снятие операции молча хоронило
    //     созданного офлайн клиента вместе с его объектами и заметками:
    //     на телефоне он есть, на сервере его никогда не будет.
    // Поэтому спрашиваем сервер прямо: есть ли строка с этим id.
    const probe = await supabase
      .from(tableName)
      .select("id")
      .eq("id", op.row_id)
      .maybeSingle();
    if (!probe.data) {
      throw new Error(insertDuplicateMessage(tableName, error.message));
    }
  }
  if (stripped) {
    try {
      await cacheDelete(op.table, op.row_id);
    } catch {
      /* ignore — cache may already be gone */
    }
  }
  return false;
}
