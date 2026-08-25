import "react-native-url-polyfill/auto";
import { AppState, Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@babun/shared/db/database.types";
import { LargeSecureStore } from "@/lib/secure-store";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    "[supabase] Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. " +
      "Copy apps/mobile/.env.example to .env.local and fill them in.",
  );
}

export const supabase = createClient<Database>(url, key, {
  auth: {
    // Web uses supabase-js default (localStorage); native uses the Keychain
    // adapter so tokens are encrypted at rest.
    storage: Platform.OS === "web" ? undefined : (LargeSecureStore as never),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Supabase RN guidance: drive token auto-refresh by foreground state so we
// don't refresh while backgrounded (and reconnect cleanly on resume).
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
