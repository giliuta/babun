import type { CountryCode } from "libphonenumber-js";
import { countryOfZone } from "@babun/shared/local/zone-country";
import { normalizeCountry, SUPPORTED_COUNTRIES } from "./phone";

// Страна номера по часовому поясу команды — чистое правило (владелец 02.10).
// Живой слой — `default-country.ts`.

const SUPPORTED = new Set<string>(SUPPORTED_COUNTRIES);

/** Страна номера по поясу: команды → компании → страна компании. */
export function countryForTeam(input: {
  teamZone: string | null | undefined;
  companyZone: string | null | undefined;
  tenantCountry: string | null | undefined;
}): CountryCode {
  const zone = input.teamZone || input.companyZone || null;
  const byZone = countryOfZone(zone);
  if (byZone && SUPPORTED.has(byZone)) return byZone as CountryCode;
  return normalizeCountry(input.tenantCountry);
}

