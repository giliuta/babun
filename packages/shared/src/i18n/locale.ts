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

/** The language this launch speaks. */
export function uiLocale(): UiLocale {
  if (current) return current;
  let saved: string | undefined;
  try {
    saved = openStore()?.getString(STORAGE_KEY);
  } catch {
    saved = undefined;
  }
  current = isUiLocale(saved) ? saved : SOURCE_LOCALE;
  return current;
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
