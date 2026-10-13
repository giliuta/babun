// Appointment create, update and delete: optimistic cache row, online
// write, and the queue on the offline / network-blip path.

// ЗАСОВ — ПЕРЕД ОПТИМИСТИЧНОЙ СТРОКОЙ, А НЕ ПЕРЕД ОТПРАВКОЙ.
//
// Эти обёртки офлайн-первые: строка ложится в SQLite СРАЗУ, а на сервер
// уезжает после. В режиме просмотра чужими глазами отправку отобьёт засов
// (`write-guard.ts`), но местная копия к тому времени уже записана, и откат
// у неё молчащий — не удался, и в кэше владельца остаётся призрак строки,
// которой на сервере никогда не было. Поэтому спрашиваем до всего.
import { assertWritesAllowed } from "../write-guard";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../db/database.types";
import {
  createAppointment as repoCreateAppointment,
  updateAppointment as repoUpdateAppointment,
  deleteAppointment as repoDeleteAppointment,
  GoneAppointmentError,
  StaleAppointmentError,
} from "../../db/repositories/appointments";
import type { Appointment } from "../../local/appointments";
import {
  cacheUpsert,
  cacheDelete,
  hasQueuedOps,
  hasStuckQueuedOps,
  type CachedAppointmentData,
} from "../../db/cache/sql";
import { isOnline } from "../network";
import {
  kickReplayer,
  MAX_ATTEMPTS,
  touchesGuardedAppointmentFields,
} from "../replayer";
import {
  enqueueOpAndEmit,
  enqueueOpWithCacheUpsertAndEmit,
  enqueueOpWithCacheDeleteAndEmit,
} from "../queue-events";
import { isUuid, randomUuid } from "../uuid";
import { isTransientNetworkError } from "../transient-error";
import { OnlineOnlyWriteError } from "../cache-errors";
import { readCachedAppointment } from "./read";
import { makeCachedRow, makeServerRow, patchToRow, toDomain } from "./rows";

type DbSupabase = SupabaseClient<Database>;

// ─── Write ────────────────────────────────────────────────────────

export async function createAppointment(
  supabase: DbSupabase,
  input: Appointment,
  tenantId: string,
): Promise<Appointment> {
  assertWritesAllowed("createAppointment");
  const id = input.id || randomUuid();
  const nowIso = new Date().toISOString();
  // Two projections (rule 4):
  //   cachedRow — full DOMAIN object for reads.
  //   serverRow — raw DB columns for the queue payload the replayer INSERTs.
  const cachedRow = makeCachedRow(
    { ...input, id, created_at: input.created_at || nowIso, updated_at: nowIso },
    tenantId,
  );
  const serverRow = makeServerRow(input, tenantId, id, nowIso);
  const insertOp = {
    table: "appointments" as const,
    op: "insert" as const,
    row_id: id,
    payload: serverRow as unknown as Record<string, unknown>,
    expected_updated_at: null,
  };

  if (isOnline()) {
    // Optimistic UI first (standalone online — no queued op to pair with).
    await cacheUpsert("appointments", cachedRow);
    try {
      const created = await repoCreateAppointment(
        supabase,
        { ...input, id },
        tenantId,
      );
      // v452 — rebind cache from the optimistic local-id row to the
      // canonical UUID Supabase allocated. Without this, the cache
      // accumulates orphan "apt-XXX" rows alongside the real ones,
      // and a later delete on the orphan poisons the sync queue.
      if (created.id !== id) {
        try {
          await cacheDelete("appointments", id);
        } catch {
          /* ignore — cache may not have stored the optimistic row */
        }
      }
      // Строка из ответа вставки — уже каноническая (`select("*")` после
      // всех BEFORE-триггеров; AFTER-триггеры записи её не переписывают).
      // Второй GET той же строки стоил лишней поездки на каждом создании.
      await cacheUpsert("appointments", makeCachedRow(created, tenantId));
      return created;
    } catch (err) {
      // Семантический отказ сервера (RLS/constraint) при живой сети —
      // НЕ в очередь (реплей гарантированно упадёт так же): откатываем
      // оптимистичную строку и пробрасываем в error-ветку мутации.
      if (isOnline() && !isTransientNetworkError(err)) {
        await cacheDelete("appointments", id).catch(() => {});
        throw err;
      }
      // Network blip — ATOMIC optimistic upsert + enqueue (risk #6).
      await enqueueOpWithCacheUpsertAndEmit(insertOp, "appointments", cachedRow);
      void kickReplayer({ supabase });
      return { ...input, id };
    }
  }

  // Offline — ATOMIC optimistic upsert + enqueue (risk #6).
  await enqueueOpWithCacheUpsertAndEmit(insertOp, "appointments", cachedRow);
  return { ...input, id };
}

export async function updateAppointment(
  supabase: DbSupabase,
  id: string,
  patch: Partial<Appointment>,
  tenantId: string,
): Promise<Appointment> {
  assertWritesAllowed("updateAppointment");
  const existing = await readCachedAppointment(id, tenantId);
  const expectedUpdatedAt = existing?.updated_at ?? null;

  // Optimistic cache merge is DOMAIN-shaped (patch applied to the full
  // domain object); the queue payload stays the raw-column projection.
  const merged: CachedAppointmentData | null = existing
    ? {
        ...existing,
        ...patch,
        // updated_at НЕ трогаем — это серверный сентинел, он же уезжает в
        // очередь как expected_updated_at (см. clientsCached: локальный
        // штамп давал ложные «конфликты синхронизации» на каждой второй
        // офлайн-правке).
      }
    : null;

  // v452 — non-UUID ids never made it to Supabase. Skip the network +
  // queue path entirely; the optimistic cache write IS the full story, so
  // it stays a standalone upsert (there is no queued op to pair with).
  if (!isUuid(id)) {
    if (merged) await cacheUpsert("appointments", merged);
    return { ...toDomain(existing), ...patch, id } as Appointment;
  }

  await refuseBehindStuckEdit(id, "updateAppointment");

  // ОТМЕНА ВИЗИТА С ДЕНЬГАМИ — ТОЛЬКО В СЕТИ (аудит работы без сети 03.10).
  // Сервер превращает её в возврат (`protect_paid_appointment_finance`):
  // из очереди она долетела бы часами позже, и возврат лёг бы в кассу
  // другого дня, хотя тост уже сказал «Визит отменён». Деньги — онлайн,
  // как вся касса (ТЗ §8).
  const cancelsMoney = cancelsPaidVisit(existing, patch);
  if (cancelsMoney && !isOnline()) {
    throw new OnlineOnlyWriteError(PAID_CANCEL_OFFLINE);
  }

  const updateOp = {
    table: "appointments" as const,
    op: "update" as const,
    row_id: id,
    // Компания — для гейта очереди (`replayer.ts`), на сервер она не уходит.
    payload: { ...patchToRow(patch), tenant_id: tenantId } as Record<string, unknown>,
    expected_updated_at: expectedUpdatedAt,
  };

  // ПОРЯДОК ПРАВОК ОДНОЙ ЗАПИСИ — ПОРЯДОК ЖЕСТОВ. Если по записи уже
  // лежат неотправленные правки (прошлая упала на сбое сети), новая встаёт
  // В ОЧЕРЕДЬ за ними, а не идёт в сеть напрямую: иначе очередь дошлёт
  // старую правку ПОСЛЕ свежей и перезапишет её.
  if (isOnline() && !(await hasQueuedOps("appointments", id))) {
    // Online: standalone optimistic upsert (no queued op to pair with).
    if (merged) await cacheUpsert("appointments", merged);
    try {
      // СТАТУС И ДЕНЬГИ — ТОЛЬКО ПОВЕРХ ТОЙ ЖЕ СТРОКИ, ЧТО ВИДЕЛ ТЕЛЕФОН (аудит
      // 03.10). Отмена записи с оплатой — это возврат всех её денег; отмена по
      // устаревшей копии (оплату принял другой телефон, а realtime её ещё не
      // донёс) молча оформила бы клиенту возврат.
      const updated = await repoUpdateAppointment(
        supabase,
        id,
        patch,
        tenantId,
        touchesGuardedAppointmentFields("appointments", patch as Record<string, unknown>)
          ? { expectedUpdatedAt }
          : {},
      );
      // Ответ правки — каноническая строка (`update().select("*")`): второй
      // GET той же записи был второй поездкой на каждом переносе блока, и
      // перенос «подлагивал, как будто сервер тормозит» (владелец 30.09).
      await cacheUpsert("appointments", makeCachedRow(updated, tenantId));
      return updated;
    } catch (err) {
      // RLS/constraint/business-rule failures will never succeed on replay.
      // Put the canonical cached row back and surface the error instead of
      // leaving a false optimistic edit plus a permanently poisoned queue.
      if (!isTransientNetworkError(err)) {
        // Записи нет на сервере — из кэша она уходит тоже.
        if (err instanceof GoneAppointmentError) {
          await cacheDelete("appointments", id).catch(() => {});
          throw err;
        }
        // Строку правили на другом устройстве — в кэш ложится строка
        // сервера, а не наша прежняя копия: экран должен показать правду.
        const restore =
          err instanceof StaleAppointmentError && err.fresh
            ? makeCachedRow(err.fresh, tenantId)
            : existing;
        if (restore) await cacheUpsert("appointments", restore).catch(() => {});
        throw err;
      }
      // Отмена с деньгами в очередь не встаёт и на обрыве: см. выше.
      if (cancelsMoney) {
        if (existing) await cacheUpsert("appointments", existing).catch(() => {});
        throw new OnlineOnlyWriteError(PAID_CANCEL_OFFLINE);
      }
      await enqueueUpdate(updateOp, merged);
      void kickReplayer({ supabase });
      return { ...toDomain(existing), ...patch, id } as Appointment;
    }
  }

  // Offline — или в сети, но за старыми правками этой записи: ATOMIC with
  // the optimistic row when cached (risk #6). В сети очередь пинаем сразу.
  await enqueueUpdate(updateOp, merged);
  if (isOnline()) void kickReplayer({ supabase });
  return { ...toDomain(existing), ...patch, id } as Appointment;
}

export const PAID_CANCEL_OFFLINE =
  "Визит с оплатой отменяется только при связи с сервером: отмена оформляет возврат денег.";

/** Отменяет ли правка визит, по которому уже есть деньги. Строки нет в
 *  кэше — не знаем, и решает сервер, как раньше. */
export function cancelsPaidVisit(
  existing: CachedAppointmentData | null,
  patch: Partial<Appointment>,
): boolean {
  if (patch.status !== "cancelled" || !existing) return false;
  const row = existing as unknown as {
    status?: unknown;
    prepaid_amount?: unknown;
    paid_amount?: unknown;
    payment_status?: unknown;
  };
  if (row.status === "cancelled" || row.payment_status === "refunded") return false;
  return Number(row.prepaid_amount ?? 0) > 0 || Number(row.paid_amount ?? 0) > 0;
}

/** Enqueue an update op, pairing it in one exclusive transaction with the
 *  optimistic merged row when there is one (risk #6). merged === null (row
 *  not cached) → plain emit-enqueue, matching the prior `if (existing)`. */
async function enqueueUpdate(
  op: Parameters<typeof enqueueOpAndEmit>[0],
  merged: CachedAppointmentData | null,
): Promise<void> {
  if (merged) {
    await enqueueOpWithCacheUpsertAndEmit(op, "appointments", merged);
  } else {
    await enqueueOpAndEmit(op);
  }
}

export async function deleteAppointment(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
): Promise<void> {
  assertWritesAllowed("deleteAppointment");
  // v452 — non-UUID ids are local orphans (the row never made it to
  // Supabase because an earlier insert failed). Skip the network + queue
  // entirely so we don't keep re-enqueueing dead ops — a standalone
  // cacheDelete is the full story (no queued op to pair with).
  if (!isUuid(id)) {
    await cacheDelete("appointments", id);
    return;
  }

  const existing = await readCachedAppointment(id, tenantId);
  await refuseBehindStuckEdit(id, "deleteAppointment");

  const deleteOp = {
    table: "appointments" as const,
    op: "delete" as const,
    row_id: id,
    payload: { id, tenant_id: tenantId },
    expected_updated_at: null,
  };

  // Удаление тоже встаёт за неотправленными правками этой записи: иначе
  // поздняя правка догонит уже удалённую запись.
  if (isOnline() && !(await hasQueuedOps("appointments", id))) {
    await cacheDelete("appointments", id); // optimistic (standalone online)
    try {
      await repoDeleteAppointment(supabase, id, tenantId);
      return;
    } catch (err) {
      if (!isTransientNetworkError(err)) {
        if (existing) await cacheUpsert("appointments", existing).catch(() => {});
        throw err;
      }
      // Fall through — ATOMIC optimistic delete + enqueue (risk #6).
      await enqueueOpWithCacheDeleteAndEmit(deleteOp, "appointments", id);
      void kickReplayer({ supabase });
      return;
    }
  }

  // Offline — или за старыми правками: ATOMIC optimistic delete + enqueue.
  await enqueueOpWithCacheDeleteAndEmit(deleteOp, "appointments", id);
  if (isOnline()) void kickReplayer({ supabase });
}

// ─── Helpers ──────────────────────────────────────────────────────

/** ЗА НАВСЕГДА УПАВШЕЙ ПРАВКОЙ НОВАЯ НЕ ПРЯЧЕТСЯ (аудит 03.10). Правки одной
 *  записи уходят по порядку, и за правкой, которую сервер окончательно
 *  отклонил (её ждут «Повторить» или «Удалить» в «Синхронизации»), новая
 *  ложилась в очередь и не уходила никогда — а экран говорил «Перенесено», и
 *  следующая перечитка возвращала запись назад. Теперь — отказ словами. */
async function refuseBehindStuckEdit(id: string, op: string): Promise<void> {
  if (await hasStuckQueuedOps("appointments", id, MAX_ATTEMPTS).catch(() => false)) {
    throw new Error(
      `${op}: Прошлая правка этой записи не дошла до сервера — откройте Кабинет → Синхронизация и повторите её или удалите`,
    );
  }
}
