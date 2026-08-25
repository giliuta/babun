// STORY-062 slice 3 — cross-platform UUID v4 for the cached-wrappers.
//
// WHY THIS EXISTS (RN vs web divergence):
//   The web wrappers generate optimistic ids with
//   `typeof crypto !== "undefined" ? crypto.randomUUID() : \`tmp_${Date.now()}\``.
//   That is fine in a browser (crypto.randomUUID is a WHATWG standard) but
//   UNSAFE on React Native / Hermes: `react-native-get-random-values`
//   polyfills only `crypto.getRandomValues`, NOT `crypto.randomUUID`. So
//   `crypto.randomUUID()` throws «crypto.randomUUID is not a function» on
//   native, and the old fallback (`tmp_…` / `${Date.now()}`) produces a
//   NON-UUID id.
//
//   A non-UUID row_id is catastrophic for the sync layer: the replayer's
//   UUID-guard permanently-fails any queued op whose row_id isn't a uuid
//   (offline-plan risk #5) — every offline-created client/appointment/tag
//   would be stranded and never reach Supabase. So the fallback MUST also
//   yield a real uuid.
//
// STRATEGY (byte-identical to the repositories' guard):
//   1. If `crypto.randomUUID` exists — use it (web + any RN runtime that
//      grows the API). Matches repositories/finance-transactions.ts etc.
//   2. Else if `crypto.getRandomValues` exists (RN via the polyfill) —
//      derive a spec-compliant v4 uuid from 16 random bytes.
//   3. Else (no crypto at all — should never happen post-bootstrap) —
//      Math.random-derived v4 uuid. Still a VALID uuid, so the replayer
//      accepts it; only the entropy is weaker.

function bytesToUuidV4(bytes: Uint8Array): string {
  // Per RFC 4122 §4.4: set version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 256; i++) hex.push((i + 0x100).toString(16).slice(1));
  return (
    hex[bytes[0]] +
    hex[bytes[1]] +
    hex[bytes[2]] +
    hex[bytes[3]] +
    "-" +
    hex[bytes[4]] +
    hex[bytes[5]] +
    "-" +
    hex[bytes[6]] +
    hex[bytes[7]] +
    "-" +
    hex[bytes[8]] +
    hex[bytes[9]] +
    "-" +
    hex[bytes[10]] +
    hex[bytes[11]] +
    hex[bytes[12]] +
    hex[bytes[13]] +
    hex[bytes[14]] +
    hex[bytes[15]]
  );
}

/** Generate a RFC-4122 v4 UUID that works on web AND React Native. Always
 *  returns a valid uuid so the replayer's UUID-guard never strands an
 *  offline-created row. */
export function randomUuid(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  if (c && typeof c.getRandomValues === "function") {
    return bytesToUuidV4(c.getRandomValues(new Uint8Array(16)));
  }
  // Last-ditch: no crypto (should be unreachable — bootstrap polyfills it).
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytesToUuidV4(bytes);
}
