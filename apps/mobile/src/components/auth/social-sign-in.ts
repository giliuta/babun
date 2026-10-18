import { Platform, TurboModuleRegistry } from "react-native";
import { requireOptionalNativeModule } from "expo";

import GOOGLE_OAUTH from "../../../google-oauth.json";

import { supabase } from "@/lib/supabase";

// ВХОД ЧЕРЕЗ APPLE И GOOGLE — напрямую, одной кнопкой. Одна кнопка и входит,
// и заводит аккаунт: есть он у этой почты — вход, нет — Supabase создаёт его,
// а пароль человек придумывает следом на «Почти готово» (`signup-finish.ts`).
//
// БЕЗ ЧУЖОГО АДРЕСА: страница Google в браузере писала бы «продолжить на
// rdtokosbqvgemicqeqwz.supabase.co» — туда она возвращает, а должно быть
// babun.app. Поэтому:
// • Apple — только на iPhone, родным окном (`expo-apple-authentication`):
//   один тап Face ID, токен Apple меняется на сессию Supabase.
// • Google на телефоне — родным окном выбора аккаунта
//   (`@react-native-google-signin`), в нём имя приложения «Babun»; на сайте —
//   кнопкой Google Identity Services прямо на babun.app (`GoogleWebButton`),
//   в ней «Войти в babun.app». Оба отдают id-токен → signInWithIdToken.
// • Старая дорога через страницу Google в браузере снята совсем: в сборке
//   без родного модуля кнопки Google просто нет, пока она не обновится.
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
/** Родной Google: модуль в сборке и, на iPhone, свой iOS-клиент Google. */
const NATIVE_GOOGLE =
  Platform.OS !== "web" &&
  (() => {
    try {
      return TurboModuleRegistry.get("RNGoogleSignin") != null;
    } catch {
      return false;
    }
  })() &&
  (Platform.OS === "android" || !!GOOGLE_OAUTH.ios);

/** Публичный id веб-клиента Google: им подписаны id-токены для Supabase. */
export const GOOGLE_WEB_CLIENT_ID = GOOGLE_OAUTH.web;

/** Какие кнопки умеет это устройство. Apple — только iPhone: правило Apple
 *  4.8 про него, а на сайте и в Android вход Apple требовал бы чужой
 *  страницы и ключа, который истекает раз в полгода. */
export function availableProviders(): SocialProvider[] {
  if (Platform.OS === "web") return ["google"];
  const google = NATIVE_GOOGLE ? (["google"] as const) : [];
  if (Platform.OS === "ios") return [...(NATIVE_APPLE ? (["apple"] as const) : []), ...google];
  return [...google];
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

export async function signInWith(provider: SocialProvider): Promise<SocialResult> {
  try {
    if (provider === "apple" && NATIVE_APPLE) return await nativeApple();
    if (provider === "google" && NATIVE_GOOGLE) return await nativeGoogle();
    return { ok: false, cancelled: false };
  } catch (e) {
    const code = String((e as { code?: string })?.code ?? "");
    // Отмена окна: Apple — ERR_REQUEST_CANCELED, Google — SIGN_IN_CANCELLED
    // (на Android — «12501»).
    if (/CANCEL/i.test(code) || code === "12501") return { ok: false, cancelled: true };
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

async function nativeGoogle(): Promise<SocialResult> {
  const Google = await import("@react-native-google-signin/google-signin");
  const { GoogleSignin } = Google;
  GoogleSignin.configure({
    webClientId: GOOGLE_OAUTH.web,
    iosClientId: GOOGLE_OAUTH.ios || undefined,
  });
  if (Platform.OS === "android") await GoogleSignin.hasPlayServices();
  const response = await GoogleSignin.signIn();
  if (!Google.isSuccessResponse(response)) return { ok: false, cancelled: true };
  const token = response.data.idToken;
  // Аккаунт Google в приложении не запоминаем: следующий вход снова
  // предложит выбор — на общем телефоне бригады это важно.
  await GoogleSignin.signOut().catch(() => undefined);
  if (!token) return { ok: false, cancelled: false };
  const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token });
  if (error) return { ok: false, cancelled: false, message: error.message };
  return { ok: true };
}

/** Вход по id-токену, который выдала кнопка Google на сайте. `nonce` —
 *  исходная строка; Google получил её хэш. */
export async function signInWithGoogleIdToken(token: string, nonce: string): Promise<SocialResult> {
  const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token, nonce });
  if (error) return { ok: false, cancelled: false, message: error.message };
  return { ok: true };
}
