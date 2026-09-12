import "react-native-url-polyfill/auto";
import { AppState, Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@babun/shared/db/database.types";
import { LargeSecureStore } from "@/lib/secure-store";
import { getActiveTenantId } from "@/lib/active-tenant";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    "[supabase] Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. " +
      "Copy apps/mobile/.env.example to .env.local and fill them in.",
  );
}

// КАЖДЫЙ ЗАПРОС НАЗЫВАЕТ СВОЮ КОМПАНИЮ.
//
// Заголовок ставится в обёртке `fetch`, а не в `global.headers`: заголовки
// клиента фиксируются в момент `createClient`, и поменять их потом нельзя — а
// компания меняется на ходу, ради этого всё и затевалось.
//
// Сервер заголовку НЕ ВЕРИТ: `current_tenant_id()` подтверждает членство по
// `tenant_members`, и подделка на чужую компанию отвечает `NULL` (ноль строк),
// а не проваливается в предыдущую. Заголовка нет — поведение ровно прежнее,
// компания берётся из токена.
// У ЗАПРОСА ЕСТЬ ПОТОЛОК ОЖИДАНИЯ, И ЭТО ВТОРАЯ ПОЛОВИНА ТОЙ ЖЕ ПРОБЛЕМЫ.
//
// supabase-js на React Native не ставит таймаут вообще: зависший сокет висит,
// пока его не уронит система, а react-query поверх повторяет дважды
// (`retry: 2`). Одна мёртвая поездка превращалась в минуты крутилки — ровно
// тот случай, когда «переключение зависло» на самом деле означает «первый
// запрос новой компании не вернулся и никто его не торопит».
const REQUEST_TIMEOUT_MS = 12_000;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function fetchWithActiveTenant(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const tenantId = getActiveTenantId();
  const headers = new Headers(init?.headers ?? {});
  if (tenantId) headers.set("x-babun-tenant", tenantId);

  // Свой сигнал НЕ отменяет чужой: если вызывающий уже дал `signal`
  // (react-query умеет отменять запросы), оставляем его хозяином — два
  // контроллера на один запрос гасили бы друг друга.
  if (init?.signal) return fetch(input, { ...init, headers });

  // ФАЙЛЫ ПОТОЛКА НЕ ИМЕЮТ. Двенадцать секунд — мера для запроса строк, а не
  // для фото с объекта по мобильной связи: пять мегабайт на слабой сети идут
  // дольше, и потолок превращал бы каждую такую загрузку в «не удалось».
  // Storage ходит своим путём (`/storage/v1/`), и там ждём столько, сколько
  // идёт файл.
  if (requestUrl(input).includes("/storage/v1/")) {
    return fetch(input, { ...init, headers });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, headers, signal: controller.signal }).finally(
    () => clearTimeout(timer),
  );
}

export const supabase = createClient<Database>(url, key, {
  global: { fetch: fetchWithActiveTenant },
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
