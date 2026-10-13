// Replay of a queued UPDATE: last-write-wins via the `updated_at` sentinel,
// the server-wins conflict path, and the force-update fallback.

import {
  cacheGetOne,
  cacheUpsert,
  forwardQueuedSentinel,
  type CachedAppointmentData,
  type CachedClientData,
  type CachedTable,
  type QueuedOp,
} from "../../db/cache/sql";
import { assertTenantStill } from "./guards";
import {
  relayClient,
  rowStillVisible,
  type DbSupabase,
  type ReplayTable,
} from "./relay";
import { cacheServerRow, touchesGuardedAppointmentFields } from "./table-rules";

export async function replayUpdate(
  supabase: DbSupabase,
  op: QueuedOp,
  tableName: ReplayTable,
  /** Правка старого образца (без компании в теле, см. гейт в `drain`). Она
   *  пролежала в очереди часы и дни, и строку за это время правили — при
   *  конфликте побеждает сервер, а не она. */
  serverWinsOnConflict: boolean,
  /** Правка легла чисто, и у строки теперь новое `updated_at`. */
  onApplied?: (updatedAt: string) => void,
  /** Компания устройства всё ещё та, под которой начат слив. */
  tenantStill?: () => boolean,
): Promise<boolean | "server-won"> {
  // op.op === 'update' — last-write-wins via updated_at sentinel.
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
      // ложный «конфликт» (аудит 03.10).
      const next = (data[0] as { updated_at?: unknown }).updated_at;
      if (typeof next === "string" && next !== op.expected_updated_at) {
        await carrySentinel(op, op.expected_updated_at, next);
        onApplied?.(next);
      }
      return false;
    }

    assertTenantStill(tenantStill);
    const guarded = touchesGuardedAppointmentFields(op.table, updatePayload);
    if (serverWinsOnConflict || guarded) {
      // Строку правили после того, как эта правка встала в очередь. Старая
      // правка поверх новой затёрла бы свежие изменения (время, услуги),
      // поэтому операция снимается, а кэш берёт строку сервера. Правка
      // статуса или денег записи уступает ВСЕГДА — см.
      // `APPOINTMENT_GUARDED_FIELDS`.
      const { data: fresh, error: freshErr } = await supabase
        .from(tableName)
        .select()
        .eq("id", op.row_id)
        .maybeSingle();
      if (freshErr) throw new Error(`replay refresh: ${freshErr.message}`);
      if (fresh) {
        const row = fresh as Record<string, unknown>;
        await cacheServerRow(op, row);
      }
      // Строки больше нет — говорить не о чем; есть — правка статуса или
      // денег уступила, и человек должен это узнать.
      return guarded && fresh ? "server-won" : false;
    }

    assertTenantStill(tenantStill);
    // 0 rows → conflict. Retry without updated_at filter and re-fetch
    // the canonical server row (now carrying the new updated_at) so
    // the cache stays consistent. Without this re-fetch, IDB would
    // hold the pre-conflict updated_at and falsely conflict on the
    // next edit.
    const forceFilter = relayClient(supabase)
      .from(tableName)
      .update(updatePayload)
      .eq("id", op.row_id)
      .select()
      // maybeSingle, NOT single. When the force-update matches 0 rows —
      // the target was deleted on the server, or RLS hides it from this
      // user (a non-'work' row created by someone else, or a stale
      // tenant JWT) — `.single()` throws PGRST116 «Cannot coerce the
      // result to a single JSON object». That re-threw on every retry,
      // wedging the op at attempt N/N and blocking the ENTIRE queue, so
      // later writes never synced → silent cross-device desync
      // (user-reported). maybeSingle returns { data: null } instead.
      .maybeSingle();
    const { data: forced, error: forceErr } = await forceFilter;
    if (forceErr)
      throw new Error(`replay force-update: ${forceErr.message}`);
    if (forced) {
      // Cache write-through with the canonical row. Кэш хранит
      // ДОМЕННУЮ форму (cache-of-domain, slice 5) — сырую серверную
      // Row прогоняем через тот же row→domain маппер, что и обычное
      // чтение (иначе строка без photos:[] и с numeric-строками).
      await cacheServerRow(op, forced as Record<string, unknown>);
      return true;
    }
    // forced === null → 0 rows, и это НЕ конфликт: правку не применили вовсе.
    // Раньше операция уходила с `true`, то есть с тостом «Применены ваши
    // изменения», — человеку сообщали об успехе, а правка пропадала. Разводим
    // тем же чтением видимости, что у удаления:
    //   • строки не видно — её удалили на другом устройстве. Применять некуда:
    //     операцию снимаем МОЛЧА (зависшая держала бы очередь), кэш догонит
    //     следующая полная перечитка (foreground revalidate / onResync);
    //   • строка ВИДНА — сервер отказал в правке, это права (`view` без
    //     `edit_all`). Операция остаётся с причиной и по исчерпании попыток
    //     уходит в `onPermanentFailure`, а не в ложное «применено».
    assertTenantStill(tenantStill);
    if (await rowStillVisible(supabase, tableName, op.row_id)) {
      throw new Error("Сервер не дал изменить эту запись: нет прав на неё.");
    }
    return false;
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

/** Передать свежий сторож ждущим правкам строки и строке кэша. Сбой здесь
 *  правку не отменяет — она уже на сервере; худшее — прежний ложный
 *  «конфликт» у следующей. */
async function carrySentinel(op: QueuedOp, from: string, to: string): Promise<void> {
  try {
    await forwardQueuedSentinel(op.table, op.row_id, op.id, from, to);
    const cached = await cacheGetOne<CachedClientData | CachedAppointmentData>(
      op.table as CachedTable,
      op.row_id,
    );
    const stamp = (cached as { updated_at?: unknown } | null)?.updated_at;
    if (cached && stamp === from) {
      await cacheUpsert(op.table as CachedTable, { ...cached, updated_at: to });
    }
  } catch {
    /* см. выше */
  }
}
