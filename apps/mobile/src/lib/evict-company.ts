import { getStorage } from "@babun/shared/storage";
import {
  cacheClearTenant,
  dequeueAll,
  removeOp,
} from "@babun/shared/db/cache/sql";
import { queryClient } from "@/lib/query-client";
import { supabase } from "@/lib/supabase";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import {
  getActiveTenantId,
  getActiveUserId,
  readPendingClaim,
  settlePendingClaim,
} from "@/lib/active-tenant";
import { forgetWarmCompany } from "@/lib/tenant-prefetch";
import {
  companyToOpenAfterEviction,
  isConfirmedNotMember,
  queryBelongsToCompany,
  queuedOpIdsOfCompany,
  storageKeysToEvict,
} from "@/lib/evict-plan";
import {
  fetchMyCalendars,
  myCalendarsQueryKey,
  type MyCalendar,
} from "@/features/settings/workspaces";
import { switchTenant } from "@/features/settings/switch-tenant";
import { isUserRole } from "@/features/settings/role-policy";

// УВОЛЕННОГО ИЗ КОМПАНИИ — ЕЁ ДАННЫЕ УХОДЯТ С ТЕЛЕФОНА (этап 0(ж) плана доступа).
//
// Кто зовёт: сигнал `membership_removed` в приватном канале `access:<user_id>`
// (`AppProviders`, триггер на сервере при удалении членства) и граница прав,
// когда опрос роли активной компании вернул «не состоит» — это путь телефона,
// который в момент увольнения был выключен.
//
// ПОРЯДОК И ПОЧЕМУ ТАКОЙ
//   1. Подтвердить у сервера ПОД ЗАГОЛОВКОМ этой компании, что человек в ней не
//      состоит. Сигнал мог опоздать к быстрому «уволил и позвал снова», а сеть —
//      соврать ошибкой. Без подтверждения ничего не стираем.
//   2. Убрать компанию из ленты календарей и из памяти прогрева — иначе прогрев
//      через минуту нагреет её обратно.
//   3. Если она открыта — увести в другую компанию человека (переход сам
//      перерисует экран). Некуда — остаёмся: экран границы прав скажет «Вы
//      больше не состоите» и даст выйти.
//   4. Стереть запросы, ключи MMKV, строки локальной базы и операции очереди,
//      которые называют эту компанию; погасить долг смены компании в токене.
//
// ЧЕГО ПОКА НЕ ДЕЛАЕТ. Напоминания: в реестре уведомлений у записи нет компании,
// и надёжно отобрать напоминания уволенной компании нельзя. Это отдельный шаг
// (метка компании в ключе владельца напоминания).

const CACHED_TABLES = ["clients", "appointments", "tags"] as const;

const running = new Map<string, Promise<boolean>>();
/** Стёртые в этой сессии. После стирания запрос роли перечитывается, снова
 *  отвечает «не состоит» и снова зовёт стирание — без этой памяти круг. */
const evictedThisSession = new Set<string>();

/** Стереть компанию с телефона. `true` — стёрта (или уже была стёрта). */
export function evictCompanyFromDevice(tenantId: string): Promise<boolean> {
  if (evictedThisSession.has(tenantId)) return Promise.resolve(true);
  const existing = running.get(tenantId);
  if (existing) return existing;
  const work = evict(tenantId)
    .catch(() => false)
    .finally(() => running.delete(tenantId));
  running.set(tenantId, work);
  return work;
}

async function confirmNotMember(tenantId: string): Promise<boolean> {
  try {
    const answer = await tenantBoundClient(tenantId).rpc("current_user_role");
    return isConfirmedNotMember(answer);
  } catch {
    return false;
  }
}

async function evict(tenantId: string): Promise<boolean> {
  const userId = getActiveUserId();
  if (!userId) return false;
  if (!(await confirmNotMember(tenantId))) return false;
  evictedThisSession.add(tenantId);

  const feedKey = [...myCalendarsQueryKey, userId];
  let calendars = queryClient.getQueryData<MyCalendar[]>(feedKey) ?? [];
  try {
    calendars = await fetchMyCalendars(supabase);
  } catch {
    // Сети нет — берём ленту, какая была.
  }
  calendars = calendars.filter((calendar) => calendar.tenantId !== tenantId);
  queryClient.setQueryData(feedKey, calendars);
  forgetWarmCompany(tenantId);

  if (getActiveTenantId() === tenantId) {
    const next = companyToOpenAfterEviction(calendars, tenantId);
    if (next) {
      await switchTenant(next.tenantId, {
        onboarded: next.onboarded,
        role: isUserRole(next.role) ? next.role : undefined,
      }).catch(() => {});
    }
  }

  queryClient.removeQueries({
    predicate: (query) => queryBelongsToCompany(query.queryKey, tenantId),
  });

  try {
    const storage = getStorage();
    for (const key of storageKeysToEvict(storage.list(), tenantId)) {
      storage.remove(key);
    }
  } catch {
    // MMKV заперт (прогрев iOS) — ключи называют компанию и чужим не покажутся.
  }

  try {
    for (const table of CACHED_TABLES) await cacheClearTenant(table, tenantId);
    for (const id of queuedOpIdsOfCompany(await dequeueAll(), tenantId)) {
      await removeOp(id);
    }
  } catch {
    // Локальной базы нет (веб, до начальной загрузки) — стирать нечего.
  }

  if (readPendingClaim(userId) === tenantId) {
    settlePendingClaim(userId, tenantId);
  }
  return true;
}
