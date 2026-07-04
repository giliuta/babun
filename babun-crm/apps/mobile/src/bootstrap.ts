// Entry-time side effects. MUST be the FIRST import in app/_layout.tsx, before
// any @babun/shared store or supabase usage runs.
//
//   1. crypto.getRandomValues polyfill (uuid generation in repositories).
//   2. URL / URLSearchParams polyfill (required by @supabase/supabase-js).
//   3. Bind the synchronous KV backend for all shared local/* stores.
//      Until this runs, getStorage() THROWS on native (no silent data loss).
//   4. Bind the async SQLite backend + NetInfo network detector for the
//      offline cache / sync layer. Until setSql() runs, getSql() THROWS on
//      native (same no-silent-data-loss guarantee as storage).
//   5. Sentry (no-op without a DSN).
import "react-native-get-random-values";
import "react-native-url-polyfill/auto";
import { Appearance, Platform } from "react-native";
import { setStorage, WebKVStorage } from "@babun/shared/storage";
import { setSql, setNetwork } from "@babun/shared/storage/sql";
import { initSentry } from "@/lib/sentry";

// The app is light-only. Lock the scheme at runtime so native chrome (system
// alerts, keyboard, date pickers) never follows the device into dark mode —
// the JS palette is already light-only (src/theme/colors.ts). Belt-and-braces
// with app.json «userInterfaceStyle: light» (which applies on native rebuild).
Appearance.setColorScheme("light");

// Storage backend is platform-split. The `@/` alias goes through tsconfig
// paths, which Expo's Metro resolver does NOT widen with platform extensions
// (`.web.ts`), so we branch explicitly here instead of relying on file
// resolution. react-native-mmkv v3 is JSI/native-only and its `new MMKV()`
// runs at module-eval — requiring it lazily keeps that off the web code path
// (Expo web / Preview), where we back the same sync KVStorage with
// localStorage via WebKVStorage.
if (Platform.OS === "web") {
  setStorage(new WebKVStorage());
  // Web (Expo web / Preview) has no expo-sqlite native module and no
  // NetInfo native module, and the mobile web target never imports the
  // SQLite cache. Leave the SQL backend un-injected (getSql() only fires
  // on native code paths) and let getNetwork() fall back to its
  // navigator.onLine default. Behaviour on web is unchanged.
} else {
  const { MMKVStorage } = require("@/storage/mmkv") as typeof import("@/storage/mmkv");
  setStorage(new MMKVStorage());

  // expo-sqlite (JSI/native) + NetInfo are native-only. Lazy-require so
  // their module-eval stays off the web bundle path, matching the MMKV
  // treatment above. Injected right after setStorage so the offline cache
  // has a backend before any store/sync call can run.
  const { ExpoSqliteAdapter } =
    require("@/storage/sqlite") as typeof import("@/storage/sqlite");
  const { NetInfoNetwork } =
    require("@/storage/netinfo") as typeof import("@/storage/netinfo");
  setSql(new ExpoSqliteAdapter());
  setNetwork(new NetInfoNetwork());
}

initSentry();
