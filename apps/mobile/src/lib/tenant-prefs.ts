import { getStorage } from "@babun/shared/storage";

// НАСТРОЙКИ ТЕЛЕФОНА, КОТОРЫЕ ПОМНЯТСЯ ПО КОМПАНИИ.
//
// Владелец 2026-09-12: переход в другую компанию сбрасывал вид календаря.
// Причина не в календаре, а в том, как устроена чистка.
//
// В продукте ДАВНО есть правило «ключ носит компанию в имени» — так устроены
// способы связи, блоки записи, карты, шаблоны SMS, справочники календаря.
// Комментарий над `enabled-prefs` даже объясняет зачем: «мастер работает на
// две фирмы с одного телефона, и выключенное в одной не должно пропадать в
// другой». Замысел верный — и он не работал: чистка при переходе сносила ВСЁ с
// префиксом `babun-`/`babun:`/`calendar.`, то есть и эти ключи тоже. Настройка
// одной компании не протекала в другую, но и не доживала до возвращения.
//
// Отсюда правило, которое этот файл объявляет и охраняет:
//
//   КЛЮЧ, КОТОРЫЙ НАЗЫВАЕТ КОМПАНИЮ, ПЕРЕХОД ПЕРЕЖИВАЕТ.
//   КЛЮЧ, КОТОРЫЙ ЕЁ НЕ НАЗЫВАЕТ, СНОСИТСЯ — иначе он протечёт.
//
// Реестр ниже — единственное место, где список таких ключей существует.
// Угадывать «в имени есть uuid, значит компанийный» нельзя: uuid в ключе может
// оказаться и клиентским, и тогда правило тихо оставило бы чужое.

/** Префикс всех ключей, которые заводит ЭТОТ помощник. */
const TENANT_PREF_PREFIX = "babun:pref:";

/** Префиксы ключей, у которых компания ВСЕГДА стоит в имени.
 *
 *  Строка добавляется сюда в том же коммите, в котором появляется новый
 *  такой ключ. Сторож `tenant-prefs.test.ts` не даст забыть: он ищет в коде
 *  сборщики ключей с `${tenantId}` и требует, чтобы их префикс был здесь. */
export const TENANT_SCOPED_KEY_PREFIXES: readonly string[] = [
  // Наборы «что предлагать и в каком порядке» (`createEnabledPrefs`).
  "babun-contact-ways",
  "babun-booking-blocks",
  "babun-map-services",
  // Справочники и снимки компании.
  "babun-sms-templates",
  "babun-equipment",
  "babun:accounts:snapshot",
  "babun2:settings:calendar:operational",
  "babun2:settings:location-labels",
  // Штамп «эта компания прошла онбординг» — он и так именной, и переживать
  // переход обязан: ради него переход и перестал показывать гейт.
  "babun:tenant:onboarded",
  // Привычки экранов, переведённые на этот механизм.
  TENANT_PREF_PREFIX,
];

/** Ключ настройки, помнящейся ПО КОМПАНИИ.
 *
 *  Компания — обязательный аргумент, и это сознательно: если её можно забыть,
 *  её забудут, и настройка одной фирмы молча всплывёт в другой. Настройка,
 *  общая на все компании, заводится через `devicePrefKey` — отдельным именем,
 *  чтобы «общая» была РЕШЕНИЕМ, а не пропущенным аргументом. */
export function tenantPrefKey(base: string, tenantId: string): string {
  return `${TENANT_PREF_PREFIX}${tenantId}:${base}`;
}

/** Ключ настройки, ОДНОЙ на все компании (язык, подсказки-однодневки).
 *  Отдельное имя вместо необязательного аргумента — см. `tenantPrefKey`. */
export function devicePrefKey(base: string): string {
  return `${TENANT_PREF_PREFIX}device:${base}`;
}

/** Чтение настройки компании. `null` — своего ещё нет.
 *
 *  `legacyKey` — ключ, под которым настройка лежала ДО переезда на компанию.
 *  Забирается ровно один раз: иначе у человека, который настроил вид
 *  календаря год назад, всё сбросилось бы в день этой правки. */
export function readTenantPref<T>(
  base: string,
  tenantId: string,
  legacyKey?: string,
): T | null {
  try {
    const storage = getStorage();
    const own = storage.get<T>(tenantPrefKey(base, tenantId));
    if (own != null) return own;
    if (!legacyKey) return null;
    const legacy = storage.get<T>(legacyKey);
    if (legacy == null) return null;
    // Перенос, а не копия: старый ключ компании не называет, поэтому в
    // следующей компании он же был бы прочитан как «её» настройка.
    storage.set(tenantPrefKey(base, tenantId), legacy);
    storage.remove(legacyKey);
    return legacy;
  } catch {
    // MMKV открывается лениво и умеет бросить, пока Keychain заперт (прогрев
    // iOS). Настройка — удобство, а не данные: молча отдаём умолчание.
    return null;
  }
}

/** Запись настройки компании. */
export function writeTenantPref<T>(
  base: string,
  tenantId: string,
  value: T,
): void {
  try {
    getStorage().set(tenantPrefKey(base, tenantId), value);
  } catch {
    // см. `readTenantPref`
  }
}

/** Переживает ли ключ переход в другую компанию. Зовёт чистка. */
export function isTenantScopedKey(key: string): boolean {
  return TENANT_SCOPED_KEY_PREFIXES.some((p) => key.startsWith(p));
}
