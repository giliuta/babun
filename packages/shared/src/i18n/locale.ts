// THE UI LANGUAGE OF THIS DEVICE.
//
// A property of the phone, like the active company: two people on one account
// can read the app in two languages. Stored in its own tiny key-value store,
// because the first translated literal runs while modules are still being
// evaluated — before bootstrap binds the shared storage (`setStorage`) and long
// before React. Read once per launch: switching the language reloads the app
// (see the language page), so constants built at import time are never stale.
//
// Anywhere a store cannot be opened — `bun test`, a server — the answer is the
// source language, so tests keep reading Russian.
import { isUiLocale, localeInfo, SOURCE_LOCALE, type PluralRule, type UiLocale } from "./locales";

const STORAGE_KEY = "babun.ui-locale";
const STORE_ID = "babun-ui";

type LocaleStore = {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
};

let store: LocaleStore | null | undefined;
let current: UiLocale | null = null;

function openStore(): LocaleStore | null {
  if (store !== undefined) return store;
  store = null;
  try {
    if (typeof navigator !== "undefined" && navigator.product === "ReactNative") {
      // Native-only module: required lazily so the web bundle never runs it.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MMKV } = require("react-native-mmkv") as typeof import("react-native-mmkv");
      store = new MMKV({ id: STORE_ID });
    } else if (typeof localStorage !== "undefined") {
      store = {
        getString: (key) => localStorage.getItem(key) ?? undefined,
        set: (key, value) => localStorage.setItem(key, value),
      };
    }
  } catch {
    store = null;
  }
  return store;
}

/** The language this launch speaks.
 *
 *  ПЕРВЫЙ ЗАПУСК ГОВОРИТ НА ЯЗЫКЕ ЧЕЛОВЕКА (владелец 04.10: «не все говорят на
 *  русском… как он зарегистрируется»). Ничего не выбрано — берём первый из
 *  языков телефона или браузера, который приложение знает, иначе английский,
 *  и запоминаем: дальше язык меняют кнопкой на входе или в Кабинете.
 *  Установка, жившая до языков, уже говорила по-русски — её не переключаем. */
export function uiLocale(): UiLocale {
  if (current) return current;
  const target = openStore();
  let saved: string | undefined;
  try {
    saved = target?.getString(STORAGE_KEY);
  } catch {
    saved = undefined;
  }
  if (isUiLocale(saved)) {
    current = saved;
    return current;
  }
  if (!target) {
    current = SOURCE_LOCALE;
    return current;
  }
  current = usedBefore() ? SOURCE_LOCALE : pickDeviceLocale(deviceLanguages());
  try {
    target.set(STORAGE_KEY, current);
  } catch {
    // Not remembered — the next launch decides the same way again.
  }
  return current;
}

/** The first of the person's own languages the app speaks; English when none
 *  is — a stranger to all seven reads English likelier than Russian. */
export function pickDeviceLocale(preferred: readonly string[]): UiLocale {
  for (const tag of preferred) {
    const code = tag.toLowerCase().split(/[-_]/)[0];
    if (isUiLocale(code)) return code;
  }
  return "en";
}

/** Phone settings or browser languages, most wanted first. */
function deviceLanguages(): string[] {
  try {
    if (typeof navigator !== "undefined" && navigator.product !== "ReactNative") {
      const list = navigator.languages?.length ? navigator.languages : [navigator.language];
      return list.filter((tag): tag is string => typeof tag === "string" && tag.length > 0);
    }
    // Hermes answers with the phone's language and region («el-GR»).
    return [Intl.DateTimeFormat().resolvedOptions().locale];
  } catch {
    return [];
  }
}

/** The app's own storage, kept since an earlier launch: this device read Babun
 *  in Russian before languages existed. Ids — apps/mobile/src/storage/mmkv.ts
 *  (PLAIN_ID, META_ID); bootstrap asks for the language BEFORE it opens them,
 *  so a fresh install finds them empty. */
export const APP_STORE_IDS = ["babun", "babun-meta"] as const;

function usedBefore(): boolean {
  try {
    if (typeof navigator !== "undefined" && navigator.product === "ReactNative") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MMKV } = require("react-native-mmkv") as typeof import("react-native-mmkv");
      return APP_STORE_IDS.some((id) => new MMKV({ id }).getAllKeys().length > 0);
    }
    if (typeof localStorage !== "undefined") {
      for (let i = 0; i < localStorage.length; i++) {
        if (localStorage.key(i) !== STORAGE_KEY) return true;
      }
    }
  } catch {
    // Unknown — keep the language this device had.
    return true;
  }
  return false;
}

/** Pins the language of THIS process without touching storage — `bun test`
 *  checks other languages with it. Null returns to the stored choice. */
export function overrideUiLocale(code: UiLocale | null): void {
  current = code;
}

/** Remembers the choice for the next launch. The running app keeps its
 *  language until it reloads — the caller reloads right after. */
export function saveUiLocale(code: UiLocale): boolean {
  try {
    const target = openStore();
    if (!target) return false;
    target.set(STORAGE_KEY, code);
    return true;
  } catch {
    return false;
  }
}

/** BCP 47 tag for `Intl` and `toLocale*String` in the UI language. */
export function uiIntlTag(): string {
  return localeInfo(uiLocale()).intl;
}

export function uiPluralRule(): PluralRule {
  return localeInfo(uiLocale()).plural;
}
