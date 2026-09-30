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

/** Человек, чей выбор сейчас держится в памяти. Нужен переходу: спрашивать
 *  `getSession()` ради одного id нельзя — после часа офлайна токен истёк,
 *  обновить его нечем, и `getSession` отвечает пустой сессией. Переход же сети
 *  не требует вовсе. */
export function getActiveUserId(): string | null {
  return activeUserId;
}

// ДОЛГ ПО ТОКЕНУ: компания, которую claim в токене ещё не догнал.
//
// Переход мгновенен потому, что не ждёт `activate_tenant` + `refreshSession`.
// Но realtime, storage и edge-функции заголовка не видят и живут по claim'у.
// Если фоновый догон сорвался (сети нет, приложение свернули), claim остаётся
// на прежней компании — и загрузка фото в новой отбивается, а realtime слушает
// не ту. Долг записывается ДО попытки и гасится только успехом; кто его гасит
// и когда — `lib/claim-catch-up.ts`.
const pendingClaimKey = (userId: string) => `babun:auth:pending-claim:${userId}`;
export const PENDING_CLAIM_KEY_PREFIX = "babun:auth:pending-claim:";

export function rememberPendingClaim(userId: string, tenantId: string): void {
  try {
    getStorage().setRaw(pendingClaimKey(userId), tenantId);
  } catch {
    // см. setActiveTenantId
  }
}

export function readPendingClaim(userId: string): string | null {
  try {
    return getStorage().getRaw(pendingClaimKey(userId));
  } catch {
    return null;
  }
}

export function settlePendingClaim(userId: string, tenantId: string): void {
  try {
    const storage = getStorage();
    // Гасится только ТОТ долг, который оплачен: если человек успел уйти дальше,
    // новый долг стоит уже на другую компанию.
    if (storage.getRaw(pendingClaimKey(userId)) === tenantId) {
      storage.remove(pendingClaimKey(userId));
    }
  } catch {
    // см. setActiveTenantId
  }
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
 *  до неё непонятно, ЧЕЙ выбор читать.
 *
 *  `readable: false` — хранилище НЕ ОТВЕТИЛО (MMKV открывается лениво и бросает,
 *  пока Keychain заперт на прогреве iOS). Это не «выбора нет», и засевать
 *  устройство из токена в этот момент нельзя: токен называет компанию,
 *  выбранную на ДРУГОМ устройстве, и один такой засев закрепил бы её здесь
 *  поверх настоящего выбора, который просто ещё не прочитался. */
export function restoreActiveTenantId(userId: string): {
  tenantId: string | null;
  readable: boolean;
} {
  if (activeUserId === userId && activeTenantId) {
    return { tenantId: activeTenantId, readable: true };
  }
  let stored: string | null = null;
  let readable = true;
  try {
    stored = getStorage().getRaw(activeTenantKey(userId));
  } catch {
    stored = null;
    readable = false;
  }
  const changed = activeTenantId !== stored || activeUserId !== userId;
  activeUserId = userId;
  activeTenantId = stored;
  if (changed) emit();
  return { tenantId: stored, readable };
}

/** Человек вышел из аккаунта. Память гасится сразу: следующий запрос не имеет
 *  права уйти с заголовком прежнего. */
export function forgetActiveTenantId(): void {
  const changed = activeTenantId !== null || activeUserId !== null;
  activeTenantId = null;
  activeUserId = null;
  if (changed) emit();
}
