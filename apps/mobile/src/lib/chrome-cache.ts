import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { getStorage } from "@babun/shared/storage";

// ШАПКА ЭКРАНОВ ЖИВЁТ И БЕЗ СЕРВЕРА: календарь, когда не грузится, показывает
// команды сверху, а клиенты и финансы — тоже, а не пустую шапку; переходы между
// страницами показываются красиво, то есть команды сохраняются.
//
// Из чего собрана шапка любой вкладки — роль, компании человека, его
// календари, карта прав, команды и профиль компании, — лежит здесь же, на
// устройстве. Удачный ответ этих запросов записывается, а при запуске
// поднимается в кэш запросов ДО первого экрана, помеченный протухшим: экран
// сразу рисует шапку и ленту команд, а запросы всё равно идут на сервер.
//
// Чего здесь НЕТ: денег, клиентов, записей. Без сервера в теле экрана —
// «Нет связи» с «Повторить», а не вчерашние цифры. Шапка — не данные: имена
// команд и роль, по которым экран решает, что рисовать вокруг. Справочники
// календаря лежат в соседнем запасе той же механики (`calendar-refs-cache.ts`),
// записи и клиенты — в SQLite.
//
// Ключ хранилища начинается с `babun2:` — выход из аккаунта стирает его
// вместе со всем остальным (`auth-clear.ts`), на общем телефоне чужая шапка
// не остаётся.

export const CHROME_STORAGE_KEY = "babun2:chrome-cache:v1";

/** Корни ключей, из которых собрана шапка. */
const CHROME_ROOTS = new Set([
  "current-role",
  "my-memberships",
  "my-calendars",
  "my-access",
  "teams",
  "tenant",
]);

/** Больше записей не держим: свежие вытесняют старые (компаний у человека
 *  единицы, но ключи ролей и команд множатся переходами). */
export const CHROME_MAX_ENTRIES = 40;

export interface ChromeEntry {
  key: QueryKey;
  data: unknown;
  /** Когда записано — для вытеснения старых. */
  at: number;
}

export type ChromeStore = Record<string, ChromeEntry>;

/** Запас ответов на устройстве: где лежит, какие ключи в него идут и сколько
 *  записей держать. Шапка — одно такое хранилище, справочники календаря
 *  (`calendar-refs-cache.ts`) — второе; механика у них общая. */
export interface DeviceQueryStore {
  storageKey: string;
  holds: (key: QueryKey) => boolean;
  max: number;
}

export function isChromeKey(key: QueryKey): boolean {
  return typeof key[0] === "string" && CHROME_ROOTS.has(key[0]);
}

const CHROME_STORE: DeviceQueryStore = {
  storageKey: CHROME_STORAGE_KEY,
  holds: isChromeKey,
  max: CHROME_MAX_ENTRIES,
};

/** Следующее состояние хранилища после удачного ответа. Тот же ответ —
 *  тот же объект (записывать нечего); сверх предела — уходят самые старые. */
export function nextChromeStore(
  store: ChromeStore,
  key: QueryKey,
  data: unknown,
  now: number,
  max = CHROME_MAX_ENTRIES,
): ChromeStore {
  const id = JSON.stringify(key);
  const prev = store[id];
  if (prev && JSON.stringify(prev.data) === JSON.stringify(data)) return store;
  const next: ChromeStore = { ...store, [id]: { key, data, at: now } };
  const ids = Object.keys(next);
  if (ids.length <= max) return next;
  const keep = new Set(
    ids.sort((a, b) => next[b]!.at - next[a]!.at).slice(0, max),
  );
  return Object.fromEntries(Object.entries(next).filter(([k]) => keep.has(k)));
}

function readStore(storageKey: string): ChromeStore {
  try {
    const value = getStorage().get<ChromeStore>(storageKey);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/** Поднять запас в кэш запросов. Запрос, у которого данные уже есть, не
 *  трогаем; поднятое — протухшее (`updatedAt: 0`) и перечитается. */
export function restoreDeviceStore(qc: QueryClient, spec: DeviceQueryStore): number {
  let restored = 0;
  for (const entry of Object.values(readStore(spec.storageKey))) {
    if (!Array.isArray(entry?.key) || !spec.holds(entry.key)) continue;
    if (qc.getQueryData(entry.key) !== undefined) continue;
    qc.setQueryData(entry.key, entry.data, { updatedAt: 0 });
    restored += 1;
  }
  return restored;
}

/** Записывать каждый удачный ответ запросов этого запаса. */
export function watchDeviceStore(qc: QueryClient, spec: DeviceQueryStore): () => void {
  return qc.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    const { queryKey } = event.query;
    if (!spec.holds(queryKey)) return;
    // Поднятое из хранилища — тоже «success», но с меткой 0: его и так знаем.
    if (event.query.state.dataUpdatedAt === 0) return;
    // Читаем каждый раз, а не держим копию: выход из аккаунта стирает ключ,
    // и копия в памяти воскресила бы чужой запас следующей записью.
    const current = readStore(spec.storageKey);
    const next = nextChromeStore(current, queryKey, event.query.state.data, Date.now(), spec.max);
    if (next === current) return;
    try {
      getStorage().set(spec.storageKey, next);
    } catch {
      // Хранилище недоступно — запас просто не запомнится.
    }
  });
}

/** Поднять запомненную шапку в кэш запросов. */
export function restoreChrome(qc: QueryClient): number {
  return restoreDeviceStore(qc, CHROME_STORE);
}

/** Записывать каждый удачный ответ запросов шапки. */
export function watchChrome(qc: QueryClient): () => void {
  return watchDeviceStore(qc, CHROME_STORE);
}
