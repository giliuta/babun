import { isTenantScopedKey } from "./tenant-prefs";
import { keyNamesKnownTenant } from "./tenant-query-keys";

// ЧТО УХОДИТ С ТЕЛЕФОНА, КОГДА ЧЕЛОВЕКА УВОЛИЛИ ИЗ КОМПАНИИ — ЧИСТЫЕ РЕШЕНИЯ.
//
// Этап 0(ж) плана доступа (docs/PLAN-ACCESS-BLOCKS-2026-09-14.md). Решение
// владельца: без права чтения данные компании на телефоне не лежат. Сервер
// закрывает доступ сразу (`current_tenant_id()` проверяет членство), но
// скачанное раньше оставалось в памяти запросов, в MMKV, в локальной базе и
// в очереди выгрузки — до выхода из аккаунта.
//
// Исполнитель — `evict-company.ts` (тянет react-native и supabase, под раннером
// не поднимается). Здесь — всё, что можно проверить тестом.

/** Ключи MMKV этой компании: только именные ключи компании (реестр
 *  `tenant-prefs`), и только те, что называют ИМЕННО её. Ключи человека
 *  (реестр напоминаний, сортировки, подсказки) и других компаний остаются. */
export function storageKeysToEvict(
  keys: readonly string[],
  tenantId: string,
): string[] {
  return keys.filter((key) => key.includes(tenantId) && isTenantScopedKey(key));
}

/** Запрос принадлежит компании, если его ключ её называет. */
export function queryBelongsToCompany(
  queryKey: readonly unknown[],
  tenantId: string,
): boolean {
  return keyNamesKnownTenant(queryKey, [tenantId]);
}

/** Операции очереди выгрузки этой компании. Операцию без компании очередь и так
 *  не выгружает (`replayer.ts`), её здесь не трогаем. */
export function queuedOpIdsOfCompany(
  ops: readonly { id: number; payload: Record<string, unknown> }[],
  tenantId: string,
): number[] {
  return ops.filter((op) => op.payload?.tenant_id === tenantId).map((op) => op.id);
}

export interface CompanyCalendar {
  tenantId: string;
  role: string;
  onboarded: boolean;
}

/** Куда увести человека, если уволили из открытой компании: сперва своя
 *  компания (где он владелец), иначе любая другая, иначе — никуда. */
export function companyToOpenAfterEviction<T extends CompanyCalendar>(
  calendars: readonly T[],
  evicted: string,
): T | null {
  const rest = calendars.filter((calendar) => calendar.tenantId !== evicted);
  return rest.find((calendar) => calendar.role === "owner") ?? rest[0] ?? null;
}

/** Стирать можно только по ПОДТВЕРЖДЁННОМУ «не состоит»: сервер ответил без
 *  ошибки и роль пустая. Сеть, таймаут или ошибка — не повод стирать работу. */
export function isConfirmedNotMember(answer: {
  data: unknown;
  error: unknown;
}): boolean {
  return !answer.error && answer.data === null;
}
