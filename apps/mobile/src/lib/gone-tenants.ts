// КОМПАНИИ, ГДЕ ЧЕЛОВЕКА БОЛЬШЕ НЕТ (аудит 04.10).
//
// Партнёр открыл календарь чужого аккаунта, вышел, владелец убрал его из
// партнёров (или аккаунт удалён) — и при следующем входе устройство
// возвращало прежний выбор, токен называл ту же компанию, сервер отвечал на
// её профиль пусто, а гейт ставил «Аккаунт не настроен». «Повторить» и
// новый вход вели туда же: свой аккаунт на телефоне был недоступен до
// переустановки.
//
// Гейт, получив подтверждённо пустой профиль, отмечает компанию здесь, и
// резолв компании пропускает её у токена и у кэша (выбор устройства гейт
// снимает сам). Память — на запуск: после перезапуска токен, если он всё ещё
// называет ту компанию, проверится одним запросом профиля заново. Ключ —
// человек и компания: чужая отметка не действует.

const gone = new Set<string>();
const keyOf = (userId: string, tenantId: string) => `${userId}:${tenantId}`;

export function markTenantGone(userId: string, tenantId: string): void {
  gone.add(keyOf(userId, tenantId));
}

/** Компания, если она не отмечена ушедшей для этого человека; иначе null. */
export function liveTenantId(
  userId: string | null,
  tenantId: string | null | undefined,
): string | null {
  if (!userId || !tenantId) return null;
  return gone.has(keyOf(userId, tenantId)) ? null : tenantId;
}

/** ТОЛЬКО ДЛЯ ТЕСТОВ. */
export function __resetGoneTenantsForTests(): void {
  gone.clear();
}
