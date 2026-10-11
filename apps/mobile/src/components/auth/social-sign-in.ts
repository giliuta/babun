import { Platform } from "react-native";
import * as Linking from "expo-linking";
import { requireOptionalNativeModule } from "expo";

import { parseRecoveryLink } from "@/lib/recovery-link";
import { supabase } from "@/lib/supabase";

// ВХОД ЧЕРЕЗ APPLE И GOOGLE (владелец 09.10: «регистрироваться сразу через
// Apple, напрямую одной кнопкой, и то же самое Google»). Одна кнопка и входит,
// и заводит аккаунт: есть он у этой почты — вход, нет — Supabase создаёт его,
// а пароль человек придумывает следом на «Почти готово» (`signup-finish.ts`).
//
// • Apple на iPhone — родным окном (`expo-apple-authentication`): так требует
//   Apple, и это один тап Face ID. Токен Apple меняется на сессию Supabase.
// • Google везде и Apple в Android — страницей входа провайдера в системном
//   окне (`expo-web-browser`, ASWebAuthenticationSession / Custom Tabs): она
//   возвращает в приложение адрес с сессией, его разбирает тот же
//   `parseRecoveryLink`, что и ссылки из писем.
// • На сайте — обычный переход на страницу провайдера и обратно на /login,
//   сессию из адреса забирает экран входа (`useSessionFromEmailLink`).
//
// РОДНЫЕ МОДУЛИ ГРУЗЯТСЯ ЛЕНИВО. Старые сборки (TestFlight, Babun Dev) их не
// содержат, и обычный import ронял бы весь экран входа; там кнопок просто нет.

export type SocialProvider = "apple" | "google";

export type SocialResult = { ok: true } | { ok: false; cancelled: boolean; message?: string };

const hasNative = (name: string) => {
  try {
    return requireOptionalNativeModule(name) != null;
  } catch {
    return false;
  }
};

/** Родной Apple есть только на iPhone новой сборки. */
const NATIVE_APPLE = Platform.OS === "ios" && hasNative("ExpoAppleAuthentication");
const WEB_BROWSER = Platform.OS !== "web" && hasNative("ExpoWebBrowser");

/** Какие кнопки умеет это устройство. */
export function availableProviders(): SocialProvider[] {
  if (Platform.OS === "web") return ["apple", "google"];
  if (Platform.OS === "ios") return [...(NATIVE_APPLE ? (["apple"] as const) : []), ...(WEB_BROWSER ? (["google"] as const) : [])];
  return WEB_BROWSER ? ["google", "apple"] : [];
}

/** КАКИЕ ВХОДЫ ВКЛЮЧЕНЫ НА СЕРВЕРЕ (`/auth/v1/settings`, публичный ответ
 *  GoTrue). Кнопка без включённого провайдера отвечала бы «provider is not
 *  enabled»; так кнопка появляется сама, когда вход включили в Supabase. */
export async function fetchEnabledProviders(): Promise<SocialProvider[]> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return [];
  const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
  if (!response.ok) return [];
  const body = (await response.json()) as { external?: Record<string, unknown> };
  return (["apple", "google"] as const).filter((p) => body.external?.[p] === true);
}

function redirectTarget(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return `${window.location.origin}/login`;
  }
  // babun://login в магазинной сборке, babundev://login в дев-сборке.
  return Linking.createURL("login");
}

export async function signInWith(provider: SocialProvider): Promise<SocialResult> {
  try {
    if (provider === "apple" && NATIVE_APPLE) return await nativeApple();
    return await browserOAuth(provider);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "ERR_REQUEST_CANCELED" || code === "ERR_CANCELED") return { ok: false, cancelled: true };
    return { ok: false, cancelled: false, message: (e as Error)?.message };
  }
}

async function nativeApple(): Promise<SocialResult> {
  const Apple = await import("expo-apple-authentication");
  const credential = await Apple.signInAsync({
    requestedScopes: [
      Apple.AppleAuthenticationScope.FULL_NAME,
      Apple.AppleAuthenticationScope.EMAIL,
    ],
  });
  if (!credential.identityToken) return { ok: false, cancelled: false };
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
  });
  if (error) return { ok: false, cancelled: false, message: error.message };
  // ИМЯ APPLE ОТДАЁТ ОДИН РАЗ — при самом первом входе, и не в токене. Кладём
  // его в метаданные, иначе «Почти готово» встретит пустым полем.
  const given = credential.fullName?.givenName?.trim() ?? "";
  const family = credential.fullName?.familyName?.trim() ?? "";
  const fullName = `${given} ${family}`.trim();
  if (fullName && !data.user?.user_metadata?.full_name) {
    await supabase.auth.updateUser({ data: { full_name: fullName } });
  }
  return { ok: true };
}

async function browserOAuth(provider: SocialProvider): Promise<SocialResult> {
  const redirectTo = redirectTarget();
  const web = Platform.OS === "web";
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: !web },
  });
  if (error) return { ok: false, cancelled: false, message: error.message };
  // На сайте браузер уже уходит на страницу провайдера.
  if (web) return { ok: true };
  if (!data?.url) return { ok: false, cancelled: false };

  const WebBrowser = await import("expo-web-browser");
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== "success") return { ok: false, cancelled: true };
  const credential = parseRecoveryLink(result.url);
  if (credential?.kind !== "session") {
    const reason = errorFromRedirect(result.url);
    return { ok: false, cancelled: false, message: reason ?? undefined };
  }
  const { error: sessionError } = await supabase.auth.setSession({
    access_token: credential.accessToken,
    refresh_token: credential.refreshToken,
  });
  if (sessionError) return { ok: false, cancelled: false, message: sessionError.message };
  return { ok: true };
}

/** Провайдер вернул отказ: `#error=…&error_description=…`. */
function errorFromRedirect(url: string): string | null {
  try {
    const parsed = new URL(url);
    const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    return parsed.searchParams.get("error_description") ?? fragment.get("error_description");
  } catch {
    return null;
  }
}
