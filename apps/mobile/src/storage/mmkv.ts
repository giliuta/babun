import { MMKV } from "react-native-mmkv";
import * as SecureStore from "expo-secure-store";
import type { KVStorage } from "@babun/shared/storage";

// The MMKV encryption key lives in the iOS Keychain / Android Keystore via
// expo-secure-store — same vault the Supabase session already sits in.
const ENCRYPTION_KEY_NAME = "babun.mmkv-encryption-key";

// AFTER_FIRST_UNLOCK instead of the expo-secure-store default
// (WHEN_UNLOCKED): iOS prewarm / background launches can run while the
// device is still locked, and reading a WHEN_UNLOCKED entry then THROWS
// (KeyChainException) instead of returning null. After the first unlock
// post-boot the key stays readable even when the device re-locks.
const KEYCHAIN_OPTS = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
} as const;

// react-native-mmkv caps the AES key at 16 bytes → 16 chars from a 62-char
// alphabet (~95 bits of entropy). crypto.getRandomValues is polyfilled in
// bootstrap.ts (react-native-get-random-values) BEFORE this module loads.
function generateKey(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

// Store ids. "babun" is the original (plaintext) store; "babun-secure" is
// its encrypted successor. "babun-meta" holds ONLY migration flags — no
// user data — and stays plaintext so every cold start can tell the store
// state WITHOUT the Keychain: MMKV silently WIPES a store opened with a
// wrong/missing key, so the open path must never guess.
const PLAIN_ID = "babun";
const SECURE_ID = "babun-secure";
const META_ID = "babun-meta";
// Set BEFORE the new key is written to the Keychain: «key exists but the
// copy may be incomplete, "babun" is still plaintext» must be
// distinguishable from the legacy in-place recrypt() builds (whose key
// write came strictly AFTER a successful recrypt).
const MIGRATION_STARTED = "babun.secure-migration-started";
// Commit point — set ONLY after every record landed in the secure store.
const SECURE_READY = "babun.secure-store-ready";

// Open the app store ENCRYPTED at rest. Client PII (chats: names, phones,
// message texts) and finance records persist here — a plaintext MMKV file
// leaks into device backups and jailbroken reads.
//
// Migration is a two-phase COPY into a fresh encrypted store, never an
// in-place recrypt(): recrypt rewrites the file where it stands, and a
// process death between the rewrite and the Keychain write leaves an
// encrypted file with no key — the next start would open it plaintext and
// MMKV would treat it as corrupt and WIPE every record. With the copy +
// sentinel scheme each step is retryable and no crash window can strand
// (or destroy) user data:
//   * SECURE_READY set   → "babun-secure" is complete; open it with the key.
//   * key, no flags      → legacy build encrypted "babun" IN PLACE; open it
//                          with the key and move it into the copy scheme.
//   * anything else      → "babun" is plaintext; (re)run the copy.
function openStore(): MMKV {
  const meta = new MMKV({ id: META_ID });

  // FAIL-CLOSED Keychain read. A throw here (locked prewarm, transient
  // Keychain error) means we can't tell «no key» from «key unreadable»:
  // guessing «no key» would either open an encrypted store plaintext
  // (MMKV wipes it) or start a bogus migration. The ONLY state provably
  // plaintext WITHOUT the Keychain is an uncommitted copy-migration
  // (MIGRATION_STARTED is set before the key write; the source is
  // cleared only after SECURE_READY commits). Everything else defers:
  // the error propagates and the lazy getStore() retries on the next
  // storage access, which succeeds once the device unlocks.
  let keyRead: string | null;
  try {
    keyRead = SecureStore.getItem(ENCRYPTION_KEY_NAME, KEYCHAIN_OPTS);
  } catch (err) {
    if (
      meta.getBoolean(MIGRATION_STARTED) &&
      !meta.getBoolean(SECURE_READY)
    ) {
      console.warn("[mmkv] keychain unavailable, staying plaintext", err);
      return new MMKV({ id: PLAIN_ID });
    }
    throw new Error(`[mmkv] Keychain unavailable, open deferred: ${String(err)}`);
  }
  // const re-bind — keeps TS aliased-condition narrowing working below.
  const key = keyRead;
  if (key) {
    // Best-effort accessibility upgrade for keys written by older builds
    // with the WHEN_UNLOCKED default — otherwise the next prewarm read
    // throws forever. The successfully-read key above keeps this launch
    // working even if the rewrite fails.
    try {
      SecureStore.setItem(ENCRYPTION_KEY_NAME, key, KEYCHAIN_OPTS);
    } catch {
      // upgrade only — never block the open on it
    }
  }

  if (meta.getBoolean(SECURE_READY)) {
    if (key) return new MMKV({ id: SECURE_ID, encryptionKey: key });
    // Keychain read WORKED but the entry vanished — the encrypted data is
    // unreadable with or without us; re-key so the app keeps working
    // (MMKV resets the store).
    try {
      const fresh = generateKey();
      SecureStore.setItem(ENCRYPTION_KEY_NAME, fresh, KEYCHAIN_OPTS);
      return new MMKV({ id: SECURE_ID, encryptionKey: fresh });
    } catch (err) {
      console.warn("[mmkv] keychain unavailable, plaintext fallback", err);
      return new MMKV({ id: PLAIN_ID });
    }
  }

  // A key WITHOUT the migration-started flag = a legacy in-place-recrypt
  // build encrypted "babun" itself (it persisted the key only after a
  // successful recrypt). In every other case "babun" is plaintext —
  // including the crash window where the flag and key were written but the
  // copy never finished.
  const legacyEncrypted = !!key && !meta.getBoolean(MIGRATION_STARTED);
  const source = legacyEncrypted
    ? new MMKV({ id: PLAIN_ID, encryptionKey: key })
    : new MMKV({ id: PLAIN_ID });

  try {
    let k = key;
    if (!k) {
      // Flag FIRST: if the process dies right after the Keychain write,
      // the next start must not mistake the still-plaintext "babun" for a
      // legacy encrypted store (opening plaintext with a key wipes it).
      meta.set(MIGRATION_STARTED, true);
      k = generateKey();
      SecureStore.setItem(ENCRYPTION_KEY_NAME, k, KEYCHAIN_OPTS);
    }
    const secure = new MMKV({ id: SECURE_ID, encryptionKey: k });
    secure.clearAll(); // drop half-copied leftovers of an interrupted run
    for (const record of source.getAllKeys()) {
      const value = source.getString(record); // KVStorage only writes strings
      if (value != null) secure.set(record, value);
    }
    meta.set(SECURE_READY, true); // commit — everything above is retryable
    source.clearAll(); // best-effort plaintext cleanup (post-commit)
    return secure;
  } catch (err) {
    // Locked Keychain / storage hiccup — keep running on the source store
    // rather than risking anything; the next cold start retries the
    // migration. Nothing is ever wiped on this path.
    console.warn("[mmkv] encryption unavailable, staying plaintext", err);
    return source;
  }
}

// LAZY open — bootstrap.ts imports this module before first render, and
// during an iOS prewarm the Keychain may still be locked: an openStore()
// throw at module scope would crash the launch. Opening on first access
// keeps module eval Keychain-free, and a failed (deferred) open simply
// retries on the next storage call.
let store: MMKV | null = null;
function getStore(): MMKV {
  store ??= openStore();
  return store;
}

// Synchronous KV backed by react-native-mmkv — satisfies the shared
// KVStorage contract (packages/shared/src/storage/types.ts requires SYNC).
// Mirrors MemoryKVStorage's JSON round-trip so behaviour matches the web
// WebKVStorage byte-for-byte.
export class MMKVStorage implements KVStorage {
  get<T>(key: string): T | null {
    const raw = getStore().getString(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T): void {
    getStore().set(key, JSON.stringify(value));
  }

  getRaw(key: string): string | null {
    return getStore().getString(key) ?? null;
  }

  setRaw(key: string, value: string): void {
    getStore().set(key, value);
  }

  remove(key: string): void {
    getStore().delete(key);
  }

  list(prefix = ""): string[] {
    const keys = getStore().getAllKeys();
    return prefix === "" ? keys : keys.filter((k) => k.startsWith(prefix));
  }
}
