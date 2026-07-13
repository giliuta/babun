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

/** Flag emoji: each ASCII letter → regional-indicator symbol. */
export function countryFlag(code: CountryCode): string {
  const base = 0x1f1e6 - "A".charCodeAt(0);
  return [...code]
    .map((c) => String.fromCodePoint(base + c.charCodeAt(0)))
    .join("");
}

/** «+357»-style dial code; never throws. */
export function countryDialCode(code: CountryCode): string {
  try {
    return `+${getCountryCallingCode(code)}`;
  } catch {
    return "+";
  }
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
export function toE164(
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

/** Страна по НАБРАННОМУ коду: «+35799…» → CY, «+7 999…» → RU. Живёт на
 *  каждый ввод (частичный номер ещё не парсится libphonenumber), поэтому
 *  матчим самый длинный dial-код из поддержанных стран. Не начинается с
 *  «+» → undefined (локальный формат, действует страна по умолчанию). */
export function countryFromDialPrefix(raw: string): CountryCode | undefined {
  const s = (raw ?? "").trim().replace(/[\s()\-]/g, "");
  if (!s.startsWith("+")) return undefined;
  let best: CountryCode | undefined;
  let bestLen = 0;
  for (const cc of SUPPORTED_COUNTRIES) {
    const code = countryDialCode(cc);
    if (code.length > bestLen && s.startsWith(code)) {
      best = cc;
      bestLen = code.length;
    }
  }
  return best;
}
