import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { getStorage } from "@babun/shared/storage";

// ШАПКА ЭКРАНОВ ЖИВЁТ И БЕЗ СЕРВЕРА (владелец 03.10, на зависшем сервере:
// «календарь, когда не грузится, показывает команды сверху, а клиенты —
// полностью пустая шапка; в финансах то же самое должно быть… перехожу между
// страницами — оно должно красиво показываться, то есть сохранение команды»).
//
// Из чего собрана шапка любой вкладки — роль, компании человека, его
// календари, карта прав, команды и профиль компании, — лежит здесь же, на
// устройстве. Удачный ответ этих запросов записывается, а при запуске
// поднимается в кэш запросов ДО первого экрана, помеченный протухшим: экран
// сразу рисует шапку и ленту команд, а запросы всё равно идут на сервер.
//
// Чего здесь НЕТ: денег, клиентов, записей. Без сервера в теле экрана —
// «Нет связи» с «Повторить», а не вчерашние цифры. Шапка — не данные: имена
// команд и роль, по которым экран решает, что рисовать вокруг.
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

export function isChromeKey(key: QueryKey): boolean {
  return typeof key[0] === "string" && CHROME_ROOTS.has(key[0]);
}

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

function readStore(): ChromeStore {
  try {
    const value = getStorage().get<ChromeStore>(CHROME_STORAGE_KEY);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/** Поднять запомненную шапку в кэш запросов. Запрос, у которого данные уже
 *  есть, не трогаем; поднятое — протухшее (`updatedAt: 0`) и перечитается. */
export function restoreChrome(qc: QueryClient): number {
  let restored = 0;
  for (const entry of Object.values(readStore())) {
    if (!Array.isArray(entry?.key) || !isChromeKey(entry.key)) continue;
    if (qc.getQueryData(entry.key) !== undefined) continue;
    qc.setQueryData(entry.key, entry.data, { updatedAt: 0 });
    restored += 1;
  }
  return restored;
}

/** Записывать каждый удачный ответ запросов шапки. */
export function watchChrome(qc: QueryClient): () => void {
  return qc.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    const { queryKey } = event.query;
    if (!isChromeKey(queryKey)) return;
    // Поднятое из хранилища — тоже «success», но с меткой 0: его и так знаем.
    if (event.query.state.dataUpdatedAt === 0) return;
    // Читаем каждый раз, а не держим копию: выход из аккаунта стирает ключ,
    // и копия в памяти воскресила бы чужую шапку следующей записью.
    const current = readStore();
    const next = nextChromeStore(current, queryKey, event.query.state.data, Date.now());
    if (next === current) return;
    try {
      getStorage().set(CHROME_STORAGE_KEY, next);
    } catch {
      // Хранилище недоступно — шапка просто не запомнится.
    }
  });
}
