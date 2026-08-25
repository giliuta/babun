// STORY-062 slice 3 — bun unit test for the RN-safe uuid generator.
//
// The replayer's UUID-guard permanently-fails any queued op whose row_id is
// not a valid uuid. So randomUuid() MUST return a valid v4 uuid on EVERY
// runtime — including RN/Hermes where `crypto.randomUUID` is absent and only
// `crypto.getRandomValues` (from react-native-get-random-values) exists.
// This test forces both fallback branches.

import { afterEach, describe, expect, test } from "bun:test";
import { randomUuid } from "./uuid";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const realCrypto = globalThis.crypto;
afterEach(() => {
  // Restore whatever the runtime had.
  Object.defineProperty(globalThis, "crypto", {
    value: realCrypto,
    configurable: true,
    writable: true,
  });
});

function setCrypto(value: unknown) {
  Object.defineProperty(globalThis, "crypto", {
    value,
    configurable: true,
    writable: true,
  });
}

describe("randomUuid", () => {
  test("uses crypto.randomUUID when available (web path)", () => {
    const id = randomUuid();
    expect(id).toMatch(UUID_V4_RE);
  });

  test("falls back to getRandomValues when randomUUID is absent (RN path)", () => {
    // Simulate RN + react-native-get-random-values: getRandomValues only.
    setCrypto({
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = (i * 37 + 11) & 0xff;
        return arr;
      },
    });
    const id = randomUuid();
    expect(id).toMatch(UUID_V4_RE);
    // version nibble is 4, variant nibble is 8/9/a/b — enforced by the impl.
    expect(id[14]).toBe("4");
    expect("89ab").toContain(id[19].toLowerCase());
  });

  test("last-ditch Math.random path still yields a valid uuid", () => {
    setCrypto(undefined);
    const id = randomUuid();
    expect(id).toMatch(UUID_V4_RE);
  });

  test("produces distinct ids", () => {
    const a = randomUuid();
    const b = randomUuid();
    expect(a).not.toBe(b);
  });
});
