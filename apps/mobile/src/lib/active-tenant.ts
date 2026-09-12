import { getStorage } from "@babun/shared/storage";

// АКТИВНАЯ КОМПАНИЯ — СВОЙСТВО ЭТОГО УСТРОЙСТВА, А НЕ АККАУНТА.
//
// Раньше она лежала в токене (`app_metadata.tenant_id`), и из этого росли обе
// жалобы владельца сразу:
//   • переключение стоило двух поездок на сервер (`activate_tenant` +
//     `refreshSession`, 2.3 с + 2.5 с на боевой) — ускорить схему было нечем;
//   • переключившись на телефоне, человек переключался и на планшете, и в
//     вебе: компания-то была свойством АККАУНТА.
//
// Теперь компанию называет клиент заголовком `x-babun-tenant`, а сервер
// подтверждает членством (миграция `active_tenant_from_verified_header`).
// Заголовок — это ВОПРОС «покажи вот эту компанию», а не разрешение: чужую он
// не откроет, потому что ответ даёт `tenant_members`, а не заголовок.
//
// ЛЕЖИТ ЛИСТОМ БЕЗ ЗАВИСИМОСТЕЙ. Значение читает `lib/supabase.ts` на КАЖДЫЙ
// запрос, а `supabase` импортирует полпродукта — любой импорт отсюда наверх
// замкнул бы круг и уронил бандл.

/** Ключ помнит ЧЕЛОВЕКА: на одном устройстве сменился аккаунт — прежний выбор
 *  компании к нему не относится и открывать её нечем (сервер и не откроет). */
const activeTenantKey = (userId: string) => `babun:auth:active-tenant:${userId}`;

/** Выбор ПЕРЕЖИВАЕТ чистку при переходе — он и есть то, ради чего переход
 *  случился. Стирается вместе с аккаунтом: список ключей-исключений живёт в
 *  `auth-clear.ts`, и этот префикс там назван. */
export const ACTIVE_TENANT_KEY_PREFIX = "babun:auth:active-tenant:";

/** Активная компания в памяти. Заголовок ставится синхронно на каждый запрос:
 *  ходить за ним в MMKV из `fetch` нельзя — это сотни лишних чтений в минуту. */
let activeTenantId: string | null = null;
let activeUserId: string | null = null;

// ЗНАЧЕНИЕ ОБЯЗАНО БЫТЬ РЕАКТИВНЫМ, И ЭТО НЕ УКРАШЕНИЕ.
//
// Переменная модуля меняется молча: React о ней не знает и перерисовывать
// ничего не станет. Раньше перерисовку приносила смена токена — экран узнавал
// о новой компании оттуда. Теперь токена на этом пути нет вовсе, и без подписки
// переход выглядел бы так: сервер уже отвечает данными новой компании, а на
// экране висит прежняя, пока что-нибудь не перерисуется случайно.
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Подписка для `useSyncExternalStore`. */
export function subscribeActiveTenant(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Компания, которую клиент называет серверу. `null` — не называет вовсе, и
 *  тогда сервер отвечает по токену, как до переезда. */
export function getActiveTenantId(): string | null {
  return activeTenantId;
}

/** Ставит компанию на ЭТО устройство. Мгновенно: ни сети, ни ожидания —
 *  следующий же запрос уходит с новым заголовком. */
export function setActiveTenantId(
  userId: string,
  tenantId: string | null,
): void {
  const changed = activeTenantId !== tenantId || activeUserId !== userId;
  activeUserId = userId;
  activeTenantId = tenantId;
  if (changed) emit();
  try {
    const storage = getStorage();
    if (tenantId) storage.setRaw(activeTenantKey(userId), tenantId);
    else storage.remove(activeTenantKey(userId));
  } catch {
    // MMKV открывается лениво и умеет бросить, пока Keychain ещё заперт
    // (прогрев iOS). Память уже поставлена — сессия отработает верно, не
    // переживёт только перезапуск.
  }
}

/** Возвращает выбор с прошлого запуска. Зовётся, когда стала известна сессия:
 *  до неё непонятно, ЧЕЙ выбор читать. */
export function restoreActiveTenantId(userId: string): string | null {
  if (activeUserId === userId && activeTenantId) return activeTenantId;
  let stored: string | null = null;
  try {
    stored = getStorage().getRaw(activeTenantKey(userId));
  } catch {
    stored = null;
  }
  const changed = activeTenantId !== stored || activeUserId !== userId;
  activeUserId = userId;
  activeTenantId = stored;
  if (changed) emit();
  return stored;
}

/** Человек вышел из аккаунта. Память гасится сразу: следующий запрос не имеет
 *  права уйти с заголовком прежнего. */
export function forgetActiveTenantId(): void {
  const changed = activeTenantId !== null || activeUserId !== null;
  activeTenantId = null;
  activeUserId = null;
  if (changed) emit();
}
