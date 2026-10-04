// STORY-035 G1 — Singleton accessor for the active KVStorage.
//
// Lazy default with a platform guard:
//   * Web / SSR — resolves to WebKVStorage on first use (WebKVStorage
//     no-ops safely when `window` is undefined, matching the prior
//     import-time default behaviour exactly).
//   * React Native — there is NO safe default.  The app entry MUST call
//     setStorage(new MMKVStorage()) before importing any store.  If a
//     store runs first, getStorage() THROWS rather than silently
//     dropping the write.  Babun's #1 data invariant is: nothing is
//     ever lost — a loud crash beats invisible data loss.
//
// We deliberately do NOT support per-namespace storages — one-impl-
// per-process keeps the API simple and matches Babun's actual
// product shape (single tenant, single device, single user).

import type { KVStorage } from "./types";
import { WebKVStorage } from "./web";

let _impl: KVStorage | null = null;

function isReactNative(): boolean {
  // RN sets `navigator.product === "ReactNative"`; absent in browsers
  // (where it is "Gecko") and undefined under Node SSR / edge.
  return (
    typeof navigator !== "undefined" && navigator.product === "ReactNative"
  );
}

/** Read the active storage backend.  Stores call this on every load/save. */
export function getStorage(): KVStorage {
  if (_impl) return _impl;
  if (isReactNative()) {
    throw new Error(
      "[@babun/shared/storage] No KVStorage configured. Call " +
        "setStorage(new MMKVStorage()) in the React Native app entry " +
        "BEFORE importing any store. Refusing to silently drop writes.",
    );
  }
  // Web (browser) or SSR / edge — WebKVStorage is the safe default.
  _impl = new WebKVStorage();
  return _impl;
}

/** Replace the storage backend.  Tests / RN bootstrap call this once before
 *  any store function fires.  No teardown required — the new impl owns its
 *  own state. */
export function setStorage(impl: KVStorage): void {
  _impl = impl;
  for (const fn of _onReady.splice(0)) fn();
}

// МОДУЛЬ, ЧИТАЮЩИЙ ХРАНИЛИЩЕ ПРИ ЗАГРУЗКЕ, ГРУЗИТСЯ РАНЬШЕ ХРАНИЛИЩА.
// Expo Router при старте вычисляет файлы маршрутов по алфавиту, и
// `app/(auth)/_layout.tsx` идёт раньше корневого `app/_layout.tsx`, который
// подключает хранилище (`bootstrap.ts`). Всё, что тянется из `(auth)` —
// сессия, чистка, кэш запросов, — вычисляется ДО `setStorage`, и чтение
// при загрузке модуля бросало. Так шапка вкладок без сервера (`chrome-cache`)
// при холодном старте не поднималась ни разу: чтение глоталось, «поднято 0».
const _onReady: Array<() => void> = [];

/** Run `fn` once the storage backend exists — now, if it already does. For
 *  work a module wants to do at load time: on native the backend is bound
 *  only after the route files have been evaluated. */
export function onStorageReady(fn: () => void): void {
  if (_impl || !isReactNative()) fn();
  else _onReady.push(fn);
}
