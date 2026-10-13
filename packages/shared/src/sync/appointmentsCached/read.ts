// Appointment reads: SWR list, authoritative cache refresh and the
// single-row cache helpers.

import { sameJson } from "../same-json";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../db/database.types";
import { listAppointments as repoListAppointments } from "../../db/repositories/appointments";
import type { Appointment } from "../../local/appointments";
import {
  cacheRead,
  cacheUpsert,
  cacheReplaceTenant,
  cacheGetOne,
  hasAuthoritativeTenantSnapshot,
  cacheLocalWriteSeq,
  dequeueAll,
  type CachedAppointmentData,
} from "../../db/cache/sql";
import { isOnline } from "../network";
import { kickReplayer, tenantRefreshHeld } from "../replayer";
import { cacheSignature } from "../revalidate-events";
import { createRevalidator } from "../revalidator";
import { ColdOfflineCacheMissError } from "../cache-errors";
import { makeCachedRow, rowToAppointment } from "./rows";

type DbSupabase = SupabaseClient<Database>;

// ─── Read ─────────────────────────────────────────────────────────

export async function listAppointments(
  supabase: DbSupabase,
  tenantId: string,
): Promise<Appointment[]> {
  const cached = await safeCacheReadAppointments(tenantId);
  if (cached.length > 0) {
    void revalidateAppointments(supabase, tenantId);
    return cached.map(rowToAppointment);
  }
  // An empty row set is ambiguous: it can be a real server snapshot or a
  // device that has never synced appointments. The authoritative marker
  // written by cacheReplaceTenant disambiguates those states below.
  try {
    // Счётчик — ДО запроса: правка, легшая в кэш, пока список ехал, старше
    // снимка не бывает (`cacheLocalWriteSeq`).
    const writeSeq = cacheLocalWriteSeq("appointments");
    const fresh = await repoListAppointments(supabase, tenantId);
    await refreshCacheFromSupabase(supabase, tenantId, fresh, writeSeq).catch(() => {});
    return fresh;
  } catch (err) {
    // Online/server errors always reach the UI. Offline may return [] only
    // when this device previously stored an authoritative empty snapshot;
    // otherwise the calendar must render a blocked unknown state, never a
    // false «free day» that invites double-booking.
    if (isOnline()) throw err;
    const hasSnapshot = await hasAuthoritativeTenantSnapshot(
      "appointments",
      tenantId,
    ).catch(() => false);
    if (hasSnapshot) return [];
    throw new ColdOfflineCacheMissError("appointments");
  }
}

const appointmentsRevalidator = createRevalidator<DbSupabase>("appointments", (sb, tenantId) =>
  refreshCacheFromSupabase(sb, tenantId),
);
const revalidateAppointments = appointmentsRevalidator.revalidate;

/** Кэш уже совпадает с сервером строка в строку? Тогда перезаписывать его
 *  незачем: `cacheReplaceTenant` — эксклюзивная транзакция на весь список
 *  (удалить всё и вставить по строке), и на каждой сверке без изменений она
 *  держала SQLite, пока правки записей ждали. Сравнение — полным JSON строки,
 *  а не только версией: новая сборка может разложить ту же версию строки
 *  иначе (новое поле), и такой кэш обязан обновиться. Порядок ключей другой —
 *  считаем «отличается» и перезаписываем: ошибка только в сторону записи. */
function sameRows(
  cached: readonly CachedAppointmentData[],
  fresh: readonly CachedAppointmentData[],
): boolean {
  if (cached.length !== fresh.length || fresh.length === 0) return false;
  const byId = new Map(cached.map((r) => [r.id, r]));
  for (const row of fresh) {
    const old = byId.get(row.id);
    if (!old || !sameJson(old, row)) return false;
  }
  return true;
}

/** Refill the cache with the canonical DOMAIN list. `repoListAppointments`
 *  already maps every jsonb column into its domain shape; we only decorate
 *  each with `tenant_id` (the one bookkeeping key the domain drops — `date`
 *  + `updated_at` are already on the Appointment). Callers on the cold path
 *  pass the already-fetched list to avoid a second round-trip.
 *
 *  Slice 5 — AUTHORITATIVE + REVALIDATE-BRIDGE. `cacheReplaceTenant` prunes
 *  appointments deleted on another device; the signature diff drives the
 *  bridge emit (returns whether anything changed). */
async function refreshCacheFromSupabase(
  supabase: DbSupabase,
  tenantId: string,
  domain?: Appointment[],
  /** Счётчик локальных записей, снятый до запроса `domain` (холодный путь). */
  writeSeqAtFetch?: number,
): Promise<boolean> {
  const writeSeq = writeSeqAtFetch ?? cacheLocalWriteSeq("appointments");
  // Гонка выхода в онлайн: пока в очереди висят ещё реплеящиеся
  // appointment-опы, авторитарный cacheReplaceTenant стёр бы
  // офлайн-созданную запись раньше, чем реплеер долил её на сервер
  // (запись «мигает» в календаре). Пропускаем замену — после дренажа
  // очереди onChanged/realtime ревалидирует заново, уже полным
  // снапшотом. Навсегда-упавшие опы (attempts ≥ MAX_ATTEMPTS) не
  // блокируют: их реплей не воскресит, сервер — истина.
  const pending = await dequeueAll();
  if (
    tenantRefreshHeld(pending, "appointments", tenantId)
  ) {
    // Пропуск обязан сам подтолкнуть дренаж: кроме флипа сети, старта
    // приложения и следующей мутации очередь никто не разгребает — один
    // ранний транзиентный сбой иначе замораживал ревалидацию календаря
    // навсегда (guard вечно видел бы pending-оп).
    void kickReplayer({ supabase });
    return false;
  }
  const appts = domain ?? (await repoListAppointments(supabase, tenantId));
  const rows = appts.map((a) => makeCachedRow(a, tenantId));
  const cachedRows = await safeCacheReadAppointments(tenantId);
  // ЗАПИСЬ, НЕ ДОШЕДШАЯ ДО СЕРВЕРА, С СЕТКИ НЕ ПРОПАДАЕТ (аудит 03.10). Её
  // вставка, отклонённая навсегда (например, клиента с этим номером успели
  // завести с другого телефона, и вставка записи упала на его отсутствии),
  // перечитку не держит — и замена кэша снимком сервера стирала запись с
  // экрана: слот выглядел свободным, на него записывали второго клиента.
  // Пока вставка лежит в очереди (в «Синхронизации» — повторить или
  // удалить), запись остаётся на сетке.
  const serverIds = new Set(rows.map((r) => r.id));
  const unsentIds = new Set(
    pending
      .filter(
        (op) =>
          op.table === "appointments" &&
          op.op === "insert" &&
          (op.payload as { tenant_id?: unknown }).tenant_id === tenantId,
      )
      .map((op) => op.row_id),
  );
  for (const cached of cachedRows) {
    if (unsentIds.has(cached.id) && !serverIds.has(cached.id)) rows.push(cached);
  }
  if (sameRows(cachedRows, rows)) return false;
  const before = cacheSignature(cachedRows);
  const replaced = await cacheReplaceTenant("appointments", tenantId, rows, {
    unlessLocalWriteSince: writeSeq,
  });
  if (!replaced) {
    appointmentsRevalidator.markStale(tenantId);
    return false;
  }
  const after = cacheSignature(rows);
  return before !== after;
}

async function safeCacheReadAppointments(
  tenantId: string,
): Promise<CachedAppointmentData[]> {
  try {
    return await cacheRead<CachedAppointmentData>("appointments", tenantId);
  } catch {
    return [];
  }
}

export async function readCachedAppointment(
  id: string,
  tenantId?: string,
): Promise<CachedAppointmentData | null> {
  try {
    // Tenant-scope the single-row read to the active tenant (minor: avoids
    // reading a row of another of the user's tenants on an id collision).
    return await cacheGetOne<CachedAppointmentData>("appointments", id, tenantId);
  } catch {
    return null;
  }
}

/** СТРОКА С СЕРВЕРА — В КЭШ ТЕЛЕФОНА. Для записей, которые меняет RPC
 *  (оплата, снятие оплаты): RPC кэш SQLite не трогает, и следующее чтение
 *  списка возвращало прежнюю строку — плитка «оплачено» мигала обратно в
 *  «не оплачено», пока фоновая сверка не приносила новую. */
export async function cacheServerAppointment(
  appointment: Appointment,
  tenantId: string,
): Promise<void> {
  await cacheUpsert("appointments", makeCachedRow(appointment, tenantId));
}
