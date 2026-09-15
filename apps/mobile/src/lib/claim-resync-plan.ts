import type { QueryClient } from "@tanstack/react-query";
import { keyNamesKnownTenant } from "./tenant-query-keys";

// ПОСЛЕ ДОГОНА CLAIM'А — ПЕРЕЧИТАТЬ ТО, ЧЕГО REALTIME НЕ ВИДЕЛ.
//
// Мост realtime открывает каналы новой компании сразу при переходе, а claim
// в токене ещё называет прежнюю. У realtime нет заголовка `x-babun-tenant`,
// `current_tenant_id()` берёт компанию из токена, и политики чтения молча
// отбрасывают каждое событие новой компании. Догон claim'а ждёт 3 с и тишины
// очереди — это десятки секунд на бесплатном плане.
//
// Когда claim догнал, realtime-js лишь подсовывает каналам новый токен и НЕ
// переподключает их: перехода CLOSED → SUBSCRIBED нет, `onResync` не зовётся,
// а чтения очереди были ДО claim'а. Запись или правка клиента с другого
// устройства в это окно не доходила до открытого календаря вовсе — до
// перемонтирования, фокуса или «потянуть».
//
// Поэтому догон сообщает об успехе, и мост перечитывает ключи ИМЕННО этой
// компании. Не голым `invalidate(["appointments"])`: он пометил бы протухшими
// и тёплые ключи другой компании, и возврат в неё снова пошёл бы в сеть.
//
// Лист без react-native: правила проверяет тест с настоящим `QueryClient`.

/** Головы ключей, которые кормит realtime — те же, что в `sync-bridge.ts`,
 *  включая карточку клиента. Все эти ключи называют компанию. */
export const CLAIM_RESYNC_HEADS: readonly string[] = [
  "appointments",
  "clients",
  "client-tags",
  "client",
];

/** Ключ с этой головой и он называет ИМЕННО эту компанию. */
export function claimResyncMatches(
  key: readonly unknown[],
  head: string,
  tenantId: string,
): boolean {
  return key[0] === head && keyNamesKnownTenant(key, [tenantId]);
}

/** Перечитать после догона. Только если claim догнал ту компанию, чей мост
 *  открыт, и устройство всё ещё в ней: в это мгновение заголовок, claim и
 *  каналы моста называют одну компанию. `true` — перечитывание запрошено. */
export function resyncAfterClaim(
  qc: QueryClient,
  input: {
    settledTenantId: string;
    bridgeTenantId: string | null;
    activeTenantId: string | null;
  },
): boolean {
  const { settledTenantId, bridgeTenantId, activeTenantId } = input;
  if (!bridgeTenantId) return false;
  if (settledTenantId !== bridgeTenantId) return false;
  if (activeTenantId !== bridgeTenantId) return false;
  void qc.invalidateQueries({
    predicate: (query) =>
      CLAIM_RESYNC_HEADS.some((head) =>
        claimResyncMatches(query.queryKey, head, bridgeTenantId),
      ),
    // Сеть — только за тем, что сейчас рисуют: они всегда компании устройства.
    refetchType: "active",
  });
  return true;
}

// Слушатели успеха догона. Реестр — здесь, а не в `claim-catch-up.ts`: тот
// тянет react-native, а мост и тест подписываются без него.
const claimSettledListeners = new Set<(tenantId: string) => void>();

export function subscribeClaimSettled(
  listener: (tenantId: string) => void,
): () => void {
  claimSettledListeners.add(listener);
  return () => {
    claimSettledListeners.delete(listener);
  };
}

/** Зовёт догон сразу после того, как погасил долг. Упавший слушатель не
 *  мешает остальным и не превращает удачный догон в неудачный. */
export function notifyClaimSettled(tenantId: string): void {
  for (const listener of [...claimSettledListeners]) {
    try {
      listener(tenantId);
    } catch {
      // Долг уже погашен; перечитывание — забота следующего повода.
    }
  }
}
