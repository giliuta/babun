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
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

/** Tenant default country — Cyprus today (mirrors the web default). */
export const DEFAULT_COUNTRY: CountryCode = "CY";

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
