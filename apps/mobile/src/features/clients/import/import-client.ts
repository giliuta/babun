import { createBlankClient, type Client } from "@babun/shared/local/clients";
import { randomUuid } from "@babun/shared/sync/uuid";
import type { CountryCode } from "libphonenumber-js";

import { tryToE164 } from "../phone";
import type { MappedRow } from "./csv-validate";

export function rowToClient(
  row: MappedRow,
  defaultCountry: CountryCode,
  tagId?: string | null,
  id = randomUuid(),
): Client {
  const e164 = tryToE164(row.rawPhone, defaultCountry);
  return createBlankClient({
    // Hermes does not implement crypto.randomUUID. Stamp the same RN-safe
    // UUID used by normal client creation instead of the legacy `cli-*` id.
    id,
    full_name: row.full_name || (e164 ?? ""),
    phone: row.rawPhone || (e164 ?? ""),
    phone_e164: e164,
    email: row.email,
    city: row.city,
    address: row.address,
    comment: row.comment,
    tag_ids: tagId ? [tagId] : [],
  });
}

function hash32(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
    hash ^= hash >>> 13;
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  return (hash ^ (hash >>> 13)) >>> 0;
}

/** Stable UUID for one source row. A retry after iOS closes mid-chunk targets
 * the same primary key and therefore cannot duplicate a committed row. */
export function importClientId(
  tenantId: string,
  fileHash: string,
  source: number,
): string {
  const seed = `${tenantId}:${fileHash}:${source}`;
  const words = [
    hash32(seed, 0x811c9dc5),
    hash32(seed, 0x9e3779b9),
    hash32(seed, 0x85ebca6b),
    hash32(seed, 0xc2b2ae35),
  ];
  const bytes = words.flatMap((word) => [
    (word >>> 24) & 0xff,
    (word >>> 16) & 0xff,
    (word >>> 8) & 0xff,
    word & 0xff,
  ]);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}
