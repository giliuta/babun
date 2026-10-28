// Phone normalization for the clients feature — mobile port of
// apps/web/src/lib/phone/normalize.ts (clients-99 F1.4), trimmed to the
// pieces mobile needs. One source of truth for turning whatever the user
// typed (spaces, brackets, missing country code) into the canonical
// E.164 string the duplicate guard (findClientByPhoneE164) and the DB
// unique index key on. Divergent normalization here would silently break
// dedup for the whole product, so this delegates to the same
// libphonenumber-js the web uses.
//
// libphonenumber-js is declared in apps/mobile/package.json (same ^1.13.2
// range the web workspace uses), so the import no longer depends on
// hoisting accidents.

import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import COUNTRY_NAMES from "./country-names.json";

/** Tenant default country — Cyprus today (mirrors the web default). */
export const DEFAULT_COUNTRY: CountryCode = "CY";

// Частые страны — первыми в списке и в выборе страны компании.
export const POPULAR_COUNTRIES: readonly CountryCode[] = [
  "CY", "GR", "RU", "UA", "BY", "GB", "DE", "FR", "IT", "ES", "PT",
  "PL", "RO", "BG", "TR", "IL", "CZ", "SK", "HU", "NL", "BE",
  "AT", "CH", "DK", "SE", "NO", "FI", "LV", "LT", "EE",
] as const;

/** Названия стран на языках приложения (сняты с Intl.DisplayNames):
 *  `{ ru: { BY: "Беларусь" }, en: { … } … }`. Данные, а не фразы — плагин
 *  перевода их не трогает: у каждого языка своя таблица. */
const COUNTRY_NAMES_BY_LOCALE = COUNTRY_NAMES as Record<string, Record<string, string>>;

/** Название страны на языке `locale`; нет — по-русски, нет и там — ISO. */
export function countryNameIn(code: CountryCode, locale: string): string {
  return COUNTRY_NAMES_BY_LOCALE[locale]?.[code] ?? COUNTRY_NAMES_BY_LOCALE.ru?.[code] ?? code;
}

// ВСЕ СТРАНЫ МИРА: каждая страна, которую знает libphonenumber (245) —
// частые первыми, остальные по алфавиту.
export const SUPPORTED_COUNTRIES: readonly CountryCode[] = [
  ...POPULAR_COUNTRIES,
  ...getCountries()
    .filter((c) => !(POPULAR_COUNTRIES as readonly string[]).includes(c))
    .sort((a, b) => countryNameIn(a, "ru").localeCompare(countryNameIn(b, "ru"), "ru")),
];

/** «+357»-style dial code; never throws. */
export function countryDialCode(code: CountryCode): string {
  try {
    return `+${getCountryCallingCode(code)}`;
  } catch {
    return "+";
  }
}

/** «+357 » — то, с чего начинается ПУСТОЕ поле номера. Пробел намеренный:
 *  курсор встаёт сразу за кодом, и человек печатает свои цифры, не думая. */
export function dialPrefix(code: CountryCode): string {
  return `${countryDialCode(code)} `;
}

/** В поле только код страны и ничего больше — значит номера НЕТ.
 *  Подставленный «+357» не должен превращаться в запись: иначе у клиента
 *  появлялся бы номер-призрак из одной подсказки. */
export function isDialOnly(value: string, code: CountryCode): boolean {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return true;
  if (digits === countryDialCode(code).replace(/\D/g, "")) return true;
  return isBareDialCode(value);
}

/** Коды всех стран — без номера. */
const ALL_DIAL_CODES = new Set(getCountries().map((c) => getCountryCallingCode(c)));

/** В поле только «+N», где N — код какой-либо страны: человек стёр номер до
 *  кода чужой страны («+30»). Это не номер, а то же пустое поле, что «+357» у
 *  кипрской команды. */
export function isBareDialCode(value: string): boolean {
  const v = (value ?? "").trim();
  if (!v.startsWith("+")) return false;
  const digits = v.replace(/\D/g, "");
  return digits.length > 0 && ALL_DIAL_CODES.has(digits);
}

/**
 * Returns the canonical E.164 form of `raw` or `null` if the number
 * couldn't be parsed into something valid. Empty input → `null`.
 */
function toE164(
  raw: string,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  try {
    const p = parsePhoneNumberFromString(trimmed, defaultCountry);
    if (!p || !p.isValid()) return null;
    return p.number; // already E.164
  } catch {
    return null;
  }
}

/**
 * Soft version of {@link toE164} — returns `null` when invalid but never
 * throws, and strips obviously bogus inputs (fewer than 3 digits) before
 * calling libphonenumber. Same semantics as the web tryToE164.
 */
export function tryToE164(
  raw: string,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
): string | null {
  const trimmed = (raw ?? "").replace(/\s+/g, "");
  if (!trimmed) return null;
  if ((trimmed.match(/\d/g) ?? []).length < 3) return null;
  return toE164(trimmed, defaultCountry);
}

/** Валидный код страны компании; неизвестное значение → дефолт продукта.
 *  Живёт здесь, а не рядом с хуком: чистая функция без React и без
 *  react-native, поэтому её можно и тестировать, и звать из веб-сборки. */
export function normalizeCountry(
  value: string | null | undefined,
): CountryCode {
  const code = (value ?? "").trim().toUpperCase();
  return (SUPPORTED_COUNTRIES as readonly string[]).includes(code)
    ? (code as CountryCode)
    : DEFAULT_COUNTRY;
}

// КИПР ГРУППАМИ «2 · 3 · 3» (иначе ввод 99000001 показывается как „99 000001“).
// Маска libphonenumber для Кипра — «99
// 000001», а номер там диктуют «99 000 001». Своя маска — только Кипру и
// только восьми цифрам национального номера; остальное — по libphonenumber.
const CY_GROUPS = [2, 3, 3] as const;

/** Цифры кипрского номера группами «99 000 001»; по мере ввода — сколько
 *  набрано («99 00»). Больше восьми цифр — не кипрский национальный, `null`. */
export function groupCyprusDigits(digits: string): string | null {
  if (!/^\d*$/.test(digits) || digits.length > 8) return null;
  const parts: string[] = [];
  let at = 0;
  for (const size of CY_GROUPS) {
    if (at >= digits.length) break;
    parts.push(digits.slice(at, at + size));
    at += size;
  }
  return parts.join(" ");
}

/** Живое форматирование по мере ввода (libphonenumber AsYouType):
 *  «+35799123456» → «+357 99 123 456», локальный «99123456» → по маске
 *  страны по умолчанию. Ведущий «+» сохраняется даже до кода страны,
 *  чтобы пользователь мог стереть код и набрать свой. Пустая строка —
 *  как есть (не навязываем «+»). */
export function formatPhoneAsYouType(
  raw: string,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
): string {
  const s = raw ?? "";
  if (s.trim() === "") return s;
  // Международный (с «+») форматируем без страны — код в самом номере;
  // локальный (без «+») — по маске defaultCountry.
  const intl = s.trimStart().startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (!intl && defaultCountry === "CY") {
    const grouped = groupCyprusDigits(digits);
    if (grouped !== null) return grouped;
  }
  if (intl && digits.startsWith("357")) {
    const grouped = groupCyprusDigits(digits.slice(3));
    if (grouped !== null) return grouped ? `+357 ${grouped}` : "+357";
  }
  const formatted = new AsYouType(intl ? undefined : defaultCountry).input(s);
  // AsYouType может «съесть» одинокий «+» в начале — вернём его, иначе
  // поле дёргается при наборе кода страны с нуля.
  if (intl && !formatted.startsWith("+")) return `+${formatted}`;
  return formatted;
}

/** НОМЕР ДЛЯ ГЛАЗ — ВСЕГДА С КОДОМ СТРАНЫ: у номера своей страны код тот, что
 *  выбран у клиента («+357 99 000 101», не «99 000 101»); чужой —
 *  «+7 916 123 45 67». `home` нужен только номеру, записанному
 *  без «+»: им такой номер и разбирается. Неразбираемое — как ввели. */
export function formatPhoneForDisplay(
  raw: string,
  home: CountryCode = DEFAULT_COUNTRY,
): string {
  const s = (raw ?? "").trim();
  if (!s) return s;
  const parsed = parsePhoneNumberFromString(s, home);
  if (!parsed || !parsed.isPossible()) return s;
  if (parsed.country === "CY") {
    const grouped = groupCyprusDigits(String(parsed.nationalNumber));
    if (grouped) return `+357 ${grouped}`;
  }
  return parsed.formatInternational();
}
