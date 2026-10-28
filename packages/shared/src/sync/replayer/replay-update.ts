// Replay of a queued UPDATE through the `updated_at` sentinel. On a conflict
// the fresher server row wins: the op is dropped and the cache takes the
// server row. Tags carry no sentinel (`client_tags` has no `updated_at`) and
// go through the plain update.

import type { QueuedOp } from "../../db/cache/sql";
import { assertTenantStill } from "./guards";
import { relayClient, type DbSupabase, type ReplayTable } from "./relay";
import { carrySentinel, type AppliedFn } from "./sentinel";
import { cacheServerRow, touchesGuardedAppointmentFields } from "./table-rules";

export async function replayUpdate(
  supabase: DbSupabase,
  op: QueuedOp,
  tableName: ReplayTable,
  /** Правка легла чисто, и у строки теперь новое `updated_at`. */
  onApplied?: AppliedFn,
  /** Компания устройства всё ещё та, под которой начат слив. */
  tenantStill?: () => boolean,
): Promise<false | "server-won" | "server-newer"> {
  // op.op === 'update' — guarded by the updated_at sentinel.
  // Table-agnostic dispatch: cast through `unknown` to a
  // PostgrestFilterBuilder so we can chain `.eq("updated_at", ...)`
  // without per-table type narrowing. The replayer is intentionally
  // generic across cached tables.
  // КОМПАНИЯ В ТЕЛЕ ПРАВКИ — ДЛЯ ГЕЙТА, А НЕ ДЛЯ СЕРВЕРА. Правка компанию
  // строки не меняет никогда: колонку из SET убираем.
  const { tenant_id: _tenantForGate, ...updatePayload } = op.payload as Record<string, unknown>;
  void _tenantForGate;

  if (op.expected_updated_at) {
    const { data, error } = await relayClient(supabase)
      .from(tableName)
      .update(updatePayload)
      .eq("id", op.row_id)
      .eq("updated_at", op.expected_updated_at)
      .select("id, updated_at");
    if (error) throw new Error(`replay update: ${error.message}`);
    if (data && data.length > 0) {
      // Matched cleanly. Свежий `updated_at` — следующим правкам строки и
      // кэшу: иначе вторая офлайн-правка несла бы прежний сторож и ловила
      // ложный «конфликт».
      const next = (data[0] as { updated_at?: unknown }).updated_at;
      if (typeof next === "string" && next !== op.expected_updated_at) {
        await carrySentinel(op, op.expected_updated_at, next);
        onApplied?.(next);
      }
      return false;
    }

    assertTenantStill(tenantStill);
    // Ноль строк — либо строку изменили позже (её `updated_at` ушёл), либо
    // сервер отказал в правке, либо строки не видно. Различает их сама строка
    // сервера. Силой поверх чужой правки не пишем никогда: правка могла
    // пролежать в очереди часы, а «последний побеждает» молча вернул бы чужой
    // перенос назад или стёр бы чужой объект клиента — массивы клиента
    // пишутся целиком.
    const { data: fresh, error: freshErr } = await supabase
      .from(tableName)
      .select()
      .eq("id", op.row_id)
      .maybeSingle();
    if (freshErr) throw new Error(`replay refresh: ${freshErr.message}`);
    // Строки не видно — удалили на другом устройстве: применять некуда,
    // операцию снимаем молча, кэш догонит полная перечитка.
    if (!fresh) return false;
    const row = fresh as Record<string, unknown>;
    const stamp = typeof row.updated_at === "string" ? row.updated_at : null;
    // Версия та же, а правка не легла — это отказ сервера (права), а не
    // чужая правка: операция остаётся с причиной.
    if (stamp === null || stamp === op.expected_updated_at) {
      throw new Error("Сервер не дал изменить эту запись: нет прав на неё.");
    }
    await cacheServerRow(op, row);
    // Правка статуса или денег записи уступила — об этом говорится особыми
    // словами (`APPOINTMENT_GUARDED_FIELDS`).
    return touchesGuardedAppointmentFields(op.table, updatePayload)
      ? "server-won"
      : "server-newer";
  }

  // No expected_updated_at — unconditional update (e.g. queued from
  // a context where we didn't have the cached row yet).
  const { error: plainErr } = await relayClient(supabase)
    .from(tableName)
    .update(updatePayload)
    .eq("id", op.row_id);
  if (plainErr) throw new Error(`replay update (plain): ${plainErr.message}`);
  return false;
}
