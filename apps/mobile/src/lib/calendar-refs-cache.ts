import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
  restoreDeviceStore,
  watchDeviceStore,
  type DeviceQueryStore,
} from "./chrome-cache";

// КАЛЕНДАРЬ С ПЕРВОЙ СЕКУНДЫ — И БЕЗ СЕТИ.
//
// Записи и клиенты лежат в SQLite и отдаются сразу. Но сетка рисуется только
// вместе со справочниками — услуги (имя и цвет записи), настройки календаря
// (окно часов, правило цвета), метки (города) и метки дня, график команды. Без
// них холодный старт ждал сервер под заставкой, а без сети вместо недели было
// «Не удалось загрузить календарь».
//
// Поэтому удачный ответ этих запросов записывается здесь, а при запуске
// поднимается в кэш запросов ДО первого экрана, помеченный протухшим: сетка
// рисуется сразу, сервер дочитывает тихо и подменяет данные без скелета.
//
// Чего здесь НЕТ: денег — операций дня, долгов, остатков. Цена услуги — часть
// справочника, без неё запись без сети заводилась бы с нулём.
//
// Ключи — из реестра компании (`company-query-keys.ts`): компания стоит в
// каждом, и под другой компанией запас просто не читается. Ключ хранилища
// начинается с `babun2:` — выход и вход другим человеком стирают его вместе со
// всем остальным (`auth-clear/wipe.ts`); переход между компаниями его бережёт
// (`tenant-prefs.ts`), как и шапку.

export const CALENDAR_REFS_STORAGE_KEY = "babun2:calendar-refs:v1";

/** Компаний у человека единицы, на компанию — шесть-семь ключей. */
export const CALENDAR_REFS_MAX_ENTRIES = 40;

const hasTenant = (part: unknown): boolean => typeof part === "string" && part.length > 0;

/** Ключ справочника календаря, и только с названной компанией. Формы — ровно
 *  те, что строит реестр: другие ключи под теми же корнями (страница
 *  «Услуги» с экономикой) сюда не попадают. */
export function isCalendarRefKey(key: QueryKey): boolean {
  switch (key[0]) {
    case "services":
      return key[1] === "with-archived" && hasTenant(key[2]);
    case "calendar-settings":
    case "cities":
    case "day-cities":
    case "team-schedules":
      return hasTenant(key[1]);
    default:
      return false;
  }
}

const CALENDAR_REFS_STORE: DeviceQueryStore = {
  storageKey: CALENDAR_REFS_STORAGE_KEY,
  holds: isCalendarRefKey,
  max: CALENDAR_REFS_MAX_ENTRIES,
};

/** Поднять запомненные справочники календаря в кэш запросов. */
export function restoreCalendarRefs(qc: QueryClient): number {
  return restoreDeviceStore(qc, CALENDAR_REFS_STORE);
}

/** Записывать каждый удачный ответ справочников календаря. */
export function watchCalendarRefs(qc: QueryClient): () => void {
  return watchDeviceStore(qc, CALENDAR_REFS_STORE);
}
