import { Alert } from "react-native";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getStorage } from "@babun/shared/storage";
import { cacheClearAll } from "@babun/shared/db/cache/sql";
import { queryClient } from "@/lib/query-client";
import { supabase } from "@/lib/supabase";
import {
  clearAllBabunNotifications,
  suspendAllBabunNotifications,
} from "@/lib/notifications";

// Mobile port of apps/web/src/lib/sync/auth-clear.ts — wipe device-local data
// when this device must no longer see the previous account's data.
//
// The shared local stores persist under GLOBAL (non-tenant-scoped) MMKV keys
// («babun-chats», «babun-appointments», «babun:closed-day:*», …), so without
// a wipe Tenant B logging in on the same phone inherits Tenant A's chats,
// finances and reference books — the cross-tenant leak STORY-053a tracked on
// web.
//
// Web-parity semantics (v504 + STORY-072/078):
//   * intentional logout        → wipe after a SUCCESSFUL signOut
//     (signOutAndWipe below — a failed signOut must not destroy data);
//   * SIGNED_IN, different user → wipe (covers «register a new account
//     without logging out first»);
//   * bare SIGNED_OUT event     → NO data wipe. Supabase fires spurious
//     SIGNED_OUT pairs on refresh-token network blips; wiping there repeatedly
//     nuked real user data on web (v504). Native notifications ARE suspended
//     immediately so a revoked/expired session cannot keep exposing client PII.
//     Their logical queue survives and can be restored after a transient blip.

// Every Babun-owned key starts with one of these — a prefix sweep catches new
// modules automatically (no «we forgot to add the key» follow-ups).
const TENANT_PREFIXES = ["babun-", "babun2:", "babun:", "calendar."];

// Identity stamp — must SURVIVE the wipe so the next sign-in can detect a
// different account (mirrors LAST_USER_KEY / KEEP_KEYS on web).
const LAST_USER_KEY = "babun:auth:last-user-id";
const KEEP_KEYS = new Set<string>([LAST_USER_KEY]);

// Supabase publishes SIGNED_OUT before an awaiting UI handler necessarily
// finishes its local cleanup. SessionProvider waits on this barrier so the
// login tree cannot mount (and another account cannot sign in) while the old
// tenant's SQLite queue is still present.
let intentionalSignOutBarrier: Promise<void> | null = null;

function wipeFastStores(): void {
  const storage = getStorage();
  for (const key of storage.list()) {
    if (KEEP_KEYS.has(key)) continue;
    if (TENANT_PREFIXES.some((p) => key.startsWith(p))) storage.remove(key);
  }
  queryClient.clear();
}

/** Awaitable tenant wipe used by the invitation tenant-switch transaction.
 * Unlike logout, switching must not allow the next JWT to render until the
 * old tenant's MMKV, React Query and SQLite/offline queue are all gone. */
export async function wipeTenantScopedData(): Promise<void> {
  await queryClient.cancelQueries();
  await clearAllBabunNotifications();
  wipeFastStores();
  try {
    await cacheClearAll();
  } catch {
    // SQLite is not injected on Expo web/pre-bootstrap. MMKV + Query remain
    // cleared, and native bootstrap always injects before a user can switch.
  }
}

/** Drop every tenant-scoped local key + the in-memory query cache + the
 *  SQLite offline cache (clients / appointments / tags / sync_queue /
 *  sync_meta). Without the SQLite wipe, Tenant A's cached rows AND — worse
 *  — A's un-drained sync_queue ops survive a logout→login-B on the same
 *  device: those ops would replay onto the server under B's session
 *  (cross-tenant leak, offline-plan risk #1). This compatibility helper keeps
 *  the old fire-and-forget shape for post-deletion/global-signout call sites;
 *  normal logout and account-switch guards use wipeTenantScopedData() and
 *  await the SQLite clear before another session can render. */
export function wipeLocalData(): void {
  void clearAllBabunNotifications();
  wipeFastStores();
  void cacheClearAll().catch(() => {
    // Cache not injected yet (SqlAdapter set only on native bootstrap) or a
    // transient SQLite error — swallow. The cross-tenant leak this guards
    // only materialises once slice 4 wires mutations onto the wrappers; on
    // web / pre-bootstrap there is nothing to clear.
  });
}

/** Intentional «Выйти» — sign out FIRST, wipe only once the session is
 *  really gone. auth-js signOut() does NOT throw: on a network failure
 *  (offline is a normal mobile state) it returns { error } and KEEPS the
 *  local session — wiping before it would destroy device-only data
 *  (chats, closed-day records) while leaving the user logged in with
 *  empty screens. The wipe still runs before any next sign-in, so a
 *  shared device never leaks this account's cached data. */
export async function signOutAndWipe(): Promise<void> {
  try {
    await signOutScopeAndWipe("global");
  } catch {
    Alert.alert(
      "Не удалось выйти",
      "Проверьте соединение и попробуйте ещё раз.",
    );
  }
}

/** Intentional sign-out primitive for flows that own their own error UI. */
export async function signOutScopeAndWipe(
  scope: "global" | "local",
): Promise<void> {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  intentionalSignOutBarrier = barrier;
  try {
    const { error } = await supabase.auth.signOut({ scope });
    if (error) throw new Error(error.message);
    await wipeTenantScopedData();
  } finally {
    release();
    if (intentionalSignOutBarrier === barrier) {
      intentionalSignOutBarrier = null;
    }
  }
}

/** Called from the serialized SessionProvider transition on SIGNED_OUT. */
export async function waitForIntentionalSignOutWipe(): Promise<void> {
  await intentionalSignOutBarrier;
}

/** Fed every onAuthStateChange event by SessionProvider. On a concrete user
 *  mismatch the promise resolves only after MMKV, React Query, SQLite and the
 *  offline queue are empty. SessionProvider deliberately waits for it before
 *  exposing the next session to route/query trees. */
export async function handleAuthEvent(
  event: AuthChangeEvent,
  session: Session | null,
): Promise<void> {
  if (event === "SIGNED_OUT") {
    await suspendAllBabunNotifications();
    await waitForIntentionalSignOutWipe();
    return;
  }
  if (event === "INITIAL_SESSION" && !session) {
    await suspendAllBabunNotifications();
    return;
  }
  if (event !== "SIGNED_IN" && event !== "INITIAL_SESSION") return;
  const next = session?.user?.id;
  if (!next) return;
  const storage = getStorage();
  const prev = storage.getRaw(LAST_USER_KEY);
  if (prev && prev !== next) await wipeTenantScopedData();
  if (prev !== next) storage.setRaw(LAST_USER_KEY, next);
}
