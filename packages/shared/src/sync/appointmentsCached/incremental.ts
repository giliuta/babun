// СВЕРКА ЗАПИСЕЙ БЕЗ ПОЛНОГО ЧТЕНИЯ — ДЕЛЬТА + ОТПЕЧАТОК МЕСЯЦЕВ (035, П2).
//
// Полная сверка тянет `appointments select=*` всего аккаунта (≈1 кБ на
// строку) на каждый старт, возврат и сигнал. Здесь — три дешёвых шага:
//   1. отпечаток месяцев с сервера (`appointment_month_digest`) — ДО дельты:
//      правка между ними попадёт в дельту, месяц разойдётся и перечитается;
//   2. дельта — строки новее метки минус две минуты (длинная транзакция
//      коммитится позже соседней, чей `updated_at` уже прочитан);
//   3. месяцы, где отпечаток кэша после дельты разошёлся с сервером,
//      перечитываются целиком — так приходят удаления (любым путём) и
//      записи, ставшие невидимыми.
// Итог — полный список строк, и дальше всё как у полной сверки: замена кэша
// одной транзакцией с защитой от свежей локальной правки, неотправленные
// вставки остаются, событие `revalidated` — только при настоящем изменении.
//
// ЗА ВЫКЛЮЧАТЕЛЕМ, по умолчанию выключено (`babun:flags.appointmentDeltaSync`
// в хранилище устройства): без него и без функции на сервере (её ещё не
// накатили) — прежняя полная сверка. Любой сбой шага — тоже полная сверка.
//
// МЕТКА — ТОЛЬКО ПО СТРОКАМ СЕРВЕРА. Локальная правка ставит `updated_at`
// часами телефона; метка от неё могла бы убежать вперёд и пропустить чужие
// правки. Поэтому метка = максимум `updated_at` из ответов сервера.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../db/database.types";
import {
  listAppointmentsChangedSince,
  listAppointmentsInDateRange,
} from "../../db/repositories/appointments";
import type { Appointment } from "../../local/appointments";
import {
  hasAuthoritativeTenantSnapshot,
  readMeta,
  writeMeta,
  type CachedAppointmentData,
} from "../../db/cache/sql";
import { getStorage } from "../../storage";
import { getSql } from "../../storage/sql/provider";
import { NoCacheSqlAdapter } from "../../storage/sql/no-cache";
import { monthBounds, monthDigests, monthsToRefetch, updatedAtMicros } from "../appointment-digest";
import { makeCachedRow } from "./rows";

type DbSupabase = SupabaseClient<Database>;

/** Выключатель в хранилище устройства. QA включает его на симуляторе. */
export const APPOINTMENT_DELTA_FLAG = "babun:flags.appointmentDeltaSync";

/** Включено — и есть настоящий кэш. В браузере SQLite нет (`NoCacheSqlAdapter`
 *  ничего не хранит): окно первой загрузки вставало бы там при каждом
 *  чтении, а полная история так и не доходила бы до экрана. */
export function appointmentDeltaSyncOn(): boolean {
  try {
    if (getStorage().get<boolean>(APPOINTMENT_DELTA_FLAG) !== true) return false;
    return !(getSql() instanceof NoCacheSqlAdapter);
  } catch {
    return false;
  }
}

const OVERLAP_MS = 2 * 60_000;
const cursorKey = (tenantId: string) => `appointments-cursor:${tenantId}`;

/** Самый поздний `updated_at` среди строк — по микросекундам, не по тексту. */
export function newestUpdatedAt(
  rows: readonly { updated_at?: string | null }[],
  floor: string | null = null,
): string | null {
  let best = floor;
  let bestUs = floor ? updatedAtMicros(floor) : null;
  for (const row of rows) {
    const us = row.updated_at ? updatedAtMicros(row.updated_at) : null;
    if (us != null && (bestUs == null || us > bestUs)) {
      best = row.updated_at as string;
      bestUs = us;
    }
  }
  return best;
}

/** Нижняя граница дельты: метка минус перекрытие. */
export function deltaSince(cursor: string): string | null {
  const us = updatedAtMicros(cursor);
  if (us == null) return null;
  return new Date(Number(us / 1000n) - OVERLAP_MS).toISOString();
}

export async function readAppointmentCursor(tenantId: string): Promise<string | null> {
  return readMeta(cursorKey(tenantId)).catch(() => null);
}

export async function writeAppointmentCursor(tenantId: string, cursor: string | null): Promise<void> {
  if (cursor) await writeMeta(cursorKey(tenantId), cursor).catch(() => {});
}

type DigestRpc = {
  rpc: (
    name: "appointment_month_digest",
    args: { p_tenant: string },
  ) => PromiseLike<{
    data: { month: string; n: number; digest: number | string }[] | null;
    error: { message: string; code?: string } | null;
  }>;
};

/** Новый полный список строк кэша без полного чтения — или `null`: тогда
 *  зовущий делает полную сверку (нет снимка, нет метки, нет функции, сбой). */
export async function incrementalAppointmentRows(
  supabase: DbSupabase,
  tenantId: string,
  cachedRows: readonly CachedAppointmentData[],
): Promise<{ rows: CachedAppointmentData[]; cursor: string | null; refetchedMonths: string[] } | null> {
  const hasSnapshot = await hasAuthoritativeTenantSnapshot("appointments", tenantId).catch(() => false);
  if (!hasSnapshot) return null;
  const cursor = await readAppointmentCursor(tenantId);
  const since = cursor ? deltaSince(cursor) : null;
  if (!cursor || !since) return null;

  const digest = await (supabase as unknown as DigestRpc).rpc("appointment_month_digest", {
    p_tenant: tenantId,
  });
  if (digest.error || !digest.data) return null;

  const changed = await listAppointmentsChangedSince(supabase, tenantId, since);
  const byId = new Map<string, CachedAppointmentData>(cachedRows.map((row) => [row.id, row]));
  for (const appt of changed) byId.set(appt.id, makeCachedRow(appt, tenantId));

  const months = monthsToRefetch(monthDigests([...byId.values()]), digest.data);
  const fromServer: Appointment[] = [...changed];
  for (const month of months) {
    const { from, to } = monthBounds(month);
    const fresh = await listAppointmentsInDateRange(supabase, tenantId, from, to);
    for (const [id, row] of byId) if (row.date?.slice(0, 7) === month) byId.delete(id);
    for (const appt of fresh) byId.set(appt.id, makeCachedRow(appt, tenantId));
    fromServer.push(...fresh);
  }
  return {
    rows: [...byId.values()],
    cursor: newestUpdatedAt(fromServer, cursor),
    refetchedMonths: months,
  };
}

/** ПЕРВАЯ ЗАГРУЗКА — СНАЧАЛА ОКНО ВОКРУГ СЕГОДНЯ. ±2 месяца приходят первыми,
 *  календарь рисуется сразу; полная история — следом, фоновой сверкой, и
 *  только она пишет кэш (снимок «полный»). Окно в кэш не пишется: оффлайн
 *  за его границей экран показал бы «свободно» там, где записи есть. */
export function firstLoadWindow(today: Date = new Date()): { from: string; to: string } {
  const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 2, 1);
  return { from: `${ym(start)}-01`, to: `${ym(end)}-31` };
}

export async function listFirstLoadWindow(supabase: DbSupabase, tenantId: string): Promise<Appointment[]> {
  const { from, to } = firstLoadWindow();
  return listAppointmentsInDateRange(supabase, tenantId, from, to);
}
