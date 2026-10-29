import "react-native-url-polyfill/auto";
import { AppState, Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@babun/shared/db/database.types";
import { LargeSecureStore } from "@/lib/secure-store";
import { getActiveTenantId, getSignedInUserId } from "@/lib/active-tenant";
import { anonymousRequestError, isAnonymousDataRequest } from "@/lib/anon-guard";
import { applyTenantHeader } from "@/lib/tenant-header";
import { isWriteRequest } from "@/lib/write-requests";
import { isAuthRequest, retryableAuthResponse } from "@/lib/auth-fetch";
import { WritesBlockedError, writesBlocked } from "@babun/shared/sync/write-guard";

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
  // ПРОСМОТР ЧУЖИМИ ГЛАЗАМИ НИЧЕГО НЕ ПИШЕТ. Пока идёт зеркало, запросы
  // уходят токеном владельца, и кнопка, которую видно «его глазами», создала
  // бы настоящие данные. Отбиваем здесь: это единственное место, через
  // которое проходит КАЖДЫЙ запрос — строки, функции, файлы
  // (`@babun/shared/sync/write-guard`).
  if (writesBlocked() && isWriteRequest(init?.method ?? "GET", requestUrl(input))) {
    return Promise.reject(new WritesBlockedError(requestUrl(input)));
  }

  // Явный заголовок вызывающего побеждает фоновый — так прогрев чужой
  // компании называет её сам (`bind-tenant.ts`). Правило и его тест — в
  // `tenant-header.ts`.
  const headers = applyTenantHeader(
    new Headers(init?.headers ?? {}),
    getActiveTenantId(),
  );

  // ВОШЁЛ — ЗНАЧИТ, ЗАПРОС К ДАННЫМ НЕСЁТ ЕГО ТОКЕН. Минуту
  // после неудачного обновления токена supabase-js шлёт запросы публичным
  // ключом, и RLS отвечает анониму «200, пусто» — это стирало кэш календаря и
  // снимало напоминания. Такой запрос падает как обрыв связи (`anon-guard.ts`).
  if (
    isAnonymousDataRequest({
      url: requestUrl(input),
      authorization: headers.get("Authorization"),
      publishableKey: key ?? "",
      signedInUserId: getSignedInUserId(),
    })
  ) {
    return Promise.reject(anonymousRequestError());
  }

  // ВХОД ПОТОЛКА НЕ ИМЕЕТ, А ЕГО 409 — ВРЕМЕННЫЙ ОТКАЗ (`auth-fetch.ts`).
  // Оборванное обновление токена оставалось в очереди лежащего сервера, и
  // после подъёма очередь выкинула людей из аккаунта.
  if (isAuthRequest(requestUrl(input))) {
    const target = requestUrl(input);
    return fetch(input, { ...init, headers }).then((response) =>
      retryableAuthResponse(target, response),
    );
  }

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

// ОДИН КЛИЕНТ НА ПРОЦЕСС — В DEV ЭТО НЕ ДАНО.
//
// Fast Refresh исполняет этот модуль заново при каждой правке в цепочке его
// импортов (`active-tenant`, `anon-guard`, …), и каждое исполнение заводило
// НОВЫЙ клиент со своим таймером обновления токена и своим слушателем
// AppState, а прежние продолжали жить. Все они обновляли один и тот же токен:
// BabunDev слал по 20–40 `POST /auth/v1/token` за раз, ловил 429, и
// проигравший терял сессию — дальше запросы уходили анонимом («permission
// denied for table change_log»). Поэтому в dev
// клиент живёт на `globalThis` и переживает перезапуск модуля, а свежая
// обёртка fetch подставляется в него по ссылке. В боевой сборке модуль
// исполняется один раз, и ветка `__DEV__` вырезается сборщиком.
type DevSlot = {
  client?: ReturnType<typeof createBabunClient>;
  fetch?: typeof fetchWithActiveTenant;
};
const devSlot: DevSlot | null =
  typeof __DEV__ !== "undefined" && __DEV__
    ? ((globalThis as { __babunSupabase?: DevSlot }).__babunSupabase ??= {})
    : null;
if (devSlot) devSlot.fetch = fetchWithActiveTenant;

function createBabunClient() {
  return createClient<Database>(url as string, key as string, {
    global: {
      fetch: devSlot
        ? (input: RequestInfo | URL, init?: RequestInit) =>
            (devSlot.fetch ?? fetchWithActiveTenant)(input, init)
        : fetchWithActiveTenant,
    },
    auth: {
      // Web uses supabase-js default (localStorage); native uses the Keychain
      // adapter so tokens are encrypted at rest.
      storage: Platform.OS === "web" ? undefined : (LargeSecureStore as never),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

const reused = devSlot?.client;
export const supabase = reused ?? createBabunClient();
if (devSlot) devSlot.client = supabase;

// Supabase RN guidance: drive token auto-refresh by foreground state so we
// don't refresh while backgrounded (and reconnect cleanly on resume). One
// listener per client: a reused dev client already has its own.
if (Platform.OS !== "web" && !reused) {
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
