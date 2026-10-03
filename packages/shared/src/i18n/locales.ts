// UI LANGUAGES — the one list of languages the app speaks.
//
// `name` is how the language calls itself, so a person who cannot read the
// current UI still finds their own. This directory is outside the build-time
// translation (see apps/mobile/scripts/i18n/babel-plugin.js): these names must
// never be translated.
//
// Russian is the source language: its "dictionary" is the source text itself.
// Adding a language = a row here + `dict/<code>.json` + a case in runtime.ts.

export type UiLocale = "ru" | "en" | "bg" | "el" | "uk" | "de" | "es";

/** How a count picks its noun form: Slavic one/few/many or one/other. */
export type PluralRule = "slavic" | "one-other";

export type UiLocaleInfo = {
  code: UiLocale;
  /** The language in its own words: «English», «Български». */
  name: string;
  /** Flag shown as the row tile on the language page. */
  flag: string;
  /** BCP 47 tag for Intl dates and numbers. */
  intl: string;
  plural: PluralRule;
};

export const UI_LOCALES: readonly UiLocaleInfo[] = [
  { code: "ru", name: "Русский", flag: "🇷🇺", intl: "ru-RU", plural: "slavic" },
  { code: "en", name: "English", flag: "🇬🇧", intl: "en-GB", plural: "one-other" },
  { code: "bg", name: "Български", flag: "🇧🇬", intl: "bg-BG", plural: "one-other" },
  { code: "el", name: "Ελληνικά", flag: "🇬🇷", intl: "el-GR", plural: "one-other" },
  { code: "uk", name: "Українська", flag: "🇺🇦", intl: "uk-UA", plural: "slavic" },
  { code: "de", name: "Deutsch", flag: "🇩🇪", intl: "de-DE", plural: "one-other" },
  { code: "es", name: "Español", flag: "🇪🇸", intl: "es-ES", plural: "one-other" },
];

export const SOURCE_LOCALE: UiLocale = "ru";

export function isUiLocale(value: unknown): value is UiLocale {
  return UI_LOCALES.some((l) => l.code === value);
}

export function localeInfo(code: UiLocale): UiLocaleInfo {
  return UI_LOCALES.find((l) => l.code === code) ?? UI_LOCALES[0]!;
}
