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
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

/** Tenant default country — Cyprus today (mirrors the web default). */
export const DEFAULT_COUNTRY: CountryCode = "CY";

// Country-picker data — web parity (apps/web/src/lib/phone/normalize.ts,
// clients-99 F2.7 «drop the hardcoded +357»).
export const SUPPORTED_COUNTRIES: readonly CountryCode[] = [
  "CY", "GR", "RU", "UA", "GB", "DE", "FR", "IT", "ES", "PT",
  "PL", "RO", "BG", "TR", "IL", "CZ", "SK", "HU", "NL", "BE",
  "AT", "CH", "DK", "SE", "NO", "FI", "LV", "LT", "EE",
] as const;

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
  return digits === countryDialCode(code).replace(/\D/g, "");
}

/** Human-readable country name (RU); falls back to the ISO code. */
export const COUNTRY_NAMES_RU: Partial<Record<CountryCode, string>> = {
  CY: "Кипр", GR: "Греция", RU: "Россия", UA: "Украина",
  GB: "Великобритания", DE: "Германия", FR: "Франция", IT: "Италия",
  ES: "Испания", PT: "Португалия", PL: "Польша", RO: "Румыния",
  BG: "Болгария", TR: "Турция", IL: "Израиль", CZ: "Чехия",
  SK: "Словакия", HU: "Венгрия", NL: "Нидерланды", BE: "Бельгия",
  AT: "Австрия", CH: "Швейцария", DK: "Дания", SE: "Швеция",
  NO: "Норвегия", FI: "Финляндия", LV: "Латвия", LT: "Литва", EE: "Эстония",
};

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

// КИПР ГРУППАМИ «2 · 3 · 3» (аудит владельца 29.09: «ввожу 99000001 —
// поле показывает „99 000001“»). Маска libphonenumber для Кипра — «99
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

/** Страна номера ДЛЯ ФЛАГА: по набранному «+коду», а для локального
 *  формата (без «+») — страна по умолчанию, которой его и разбирают.
 *  Пустой номер → undefined (флагу нечего показывать). Один хелпер на
 *  оба режима карточки клиента: черновик и сохранённая строка. */

/** НОМЕР ДЛЯ ГЛАЗ — ВСЕГДА С КОДОМ СТРАНЫ (владелец 01.10: «обязательно
 *  код страны, он вставляется везде… под именем начинается +357 — тот код
 *  страны, который выбран в самом клиенте»). До 01.10 номер своей страны
 *  печатался без кода («99 000 101»), теперь — «+357 99 000 101»; чужой —
 *  как и раньше, «+7 916 123 45 67». `home` нужен только номеру, записанному
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

// ─── ВВОД НОМЕРА: СТРАНА ОТДЕЛЬНО, ЦИФРЫ ОТДЕЛЬНО (владелец 22.09: «сделать
// удобное вписывание номера, выбор кода страны»). Поле держит только цифры
// номера, код страны — в подписи над ним, тапом меняется. В данные уходит
// полный номер «+357 99887766»: так его разбирает любой дальнейший код, и
// номер чужой страны не зависит от страны компании.

/** Флаг страны из ISO-кода: «CY» → 🇨🇾. */
export function countryFlag(code: CountryCode): string {
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

/** Страна набранного номера: с «+» — по коду (среди стран списка, самый
 *  длинный совпавший код), без «+» — страна по умолчанию. */
export function phoneCountryOf(
  raw: string,
  home: CountryCode = DEFAULT_COUNTRY,
): CountryCode {
  const s = (raw ?? "").replace(/[^\d+]/g, "");
  if (!s.startsWith("+")) return home;
  const digits = s.slice(1);
  const byCode = [...SUPPORTED_COUNTRIES]
    .filter((c) => digits.startsWith(countryDialCode(c).slice(1)))
    .sort((a, b) => countryDialCode(b).length - countryDialCode(a).length);
  // Один код на несколько стран (+7, +44…) — берём ту, что назовёт сам
  // номер, иначе первую из списка.
  const told = new AsYouType();
  told.input(s);
  const named = told.getCountry();
  if (named && (SUPPORTED_COUNTRIES as readonly string[]).includes(named)) return named;
  return byCode[0] ?? home;
}

/** Цифры номера без кода страны, группами по маске страны. */
export function nationalPart(raw: string, country: CountryCode): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const dial = countryDialCode(country).slice(1);
  const digits = s.replace(/\D/g, "");
  const rest = s.startsWith("+") && digits.startsWith(dial)
    ? digits.slice(dial.length)
    : digits;
  if (!rest) return "";
  if (country === "CY") {
    const grouped = groupCyprusDigits(rest);
    if (grouped !== null) return grouped;
  }
  return new AsYouType(country).input(rest);
}

/** Полный номер из страны и набранных цифр; пусто — пусто. Набрали сами
 *  «+…» — уважаем как есть. */
export function composePhone(typed: string, country: CountryCode): string {
  const s = (typed ?? "").trim();
  if (!s) return "";
  if (s.startsWith("+")) return s;
  return `${countryDialCode(country)} ${s}`;
}

/** КОД СТРАНЫ ОТДЕЛЬНО, ЦИФРЫ ОТДЕЛЬНО — для показа (владелец 30.09: «код
 *  страны сдержанно, стильно, без флагов»). Блок «Клиент» печатает код тихим
 *  серым перед номером: «+357 97 469 998», «+44 7700 900123». Код берётся у
 *  самого номера; номер без «+» — страны компании. Пусто — код компании и
 *  пустые цифры (строка нового номера). */
export function phoneParts(
  raw: string,
  home: CountryCode = DEFAULT_COUNTRY,
): { code: string; rest: string } {
  const s = (raw ?? "").trim();
  if (!s) return { code: countryDialCode(home), rest: "" };
  const parsed = parsePhoneNumberFromString(s, home);
  const country =
    parsed?.country ?? (s.startsWith("+") ? phoneCountryOf(s, home) : home);
  const code = parsed ? `+${parsed.countryCallingCode}` : countryDialCode(country);
  const digits = s.replace(/\D/g, "");
  const dial = code.slice(1);
  const own = s.startsWith("+") && digits.startsWith(dial) ? digits.slice(dial.length) : digits;
  if (country === "CY") {
    const grouped = groupCyprusDigits(own);
    if (grouped) return { code, rest: grouped };
  }
  // Международный вид без кода: с кодом впереди национальный «0» лишний
  // («+44 7700 900123», а не «+44 07700…»).
  const rest = parsed?.isPossible()
    ? parsed.formatInternational().replace(/^\+\d+\s*/, "")
    : new AsYouType(country).input(own);
  return { code, rest };
}
