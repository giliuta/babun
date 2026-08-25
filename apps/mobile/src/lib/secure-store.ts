import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Supabase auth-storage adapter.
//
//   * Native — persists the session in the iOS Keychain / Android Keystore
//     via expo-secure-store, CHUNKED to stay under the per-item size limit
//     (Supabase sessions exceed ~2 KB, which SecureStore does not guarantee
//     to store in a single item).
//   * Web (Expo web target / future RN-web) — falls back to localStorage so
//     the same client boots in the browser.
//
// Interface matches @supabase/supabase-js SupportedStorage (async).
const CHUNK_SIZE = 2000;

function web(): Storage | null {
  return typeof localStorage !== "undefined" ? localStorage : null;
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") return web()?.getItem(key) ?? null;

  const countRaw = await SecureStore.getItemAsync(`${key}.chunks`);
  if (countRaw == null) {
    // Small / legacy value stored under the bare key.
    return SecureStore.getItemAsync(key);
  }
  const count = parseInt(countRaw, 10);
  let out = "";
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(`${key}.${i}`);
    if (part == null) return null; // corrupt — treat as absent
    out += part;
  }
  return out;
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    web()?.setItem(key, value);
    return;
  }
  // Always clear the previous representation to avoid stale chunks.
  await removeItem(key);

  if (value.length <= CHUNK_SIZE) {
    await SecureStore.setItemAsync(key, value);
    return;
  }
  const count = Math.ceil(value.length / CHUNK_SIZE);
  await SecureStore.setItemAsync(`${key}.chunks`, String(count));
  for (let i = 0; i < count; i++) {
    await SecureStore.setItemAsync(
      `${key}.${i}`,
      value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
    );
  }
}

async function removeItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    web()?.removeItem(key);
    return;
  }
  const countRaw = await SecureStore.getItemAsync(`${key}.chunks`);
  if (countRaw != null) {
    const count = parseInt(countRaw, 10);
    for (let i = 0; i < count; i++) {
      await SecureStore.deleteItemAsync(`${key}.${i}`);
    }
    await SecureStore.deleteItemAsync(`${key}.chunks`);
  }
  await SecureStore.deleteItemAsync(key);
}

export const LargeSecureStore = { getItem, setItem, removeItem };
