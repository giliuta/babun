import { Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { isLocationRequestToken } from "@/features/clients/location-request-link";
import {
  parseLookup,
  parseSubmit,
  partsFromNominatim,
  type Coords,
  type LocationRequestLookup,
  type SubmitResult,
} from "@/features/clients/location-request-form";

// ПУБЛИЧНАЯ СТРАНИЦА /l/<токен> — сеть (STORY-077). Клиент без входа: обе
// RPC отданы роли anon и знают только токен. Здесь же браузерные вещи —
// геопозиция и обратный геокодер, — которых на нативе нет: страницу
// открывают в браузере телефона, приложение её лишь умеет показать.

export function useLocationRequestLookup(token: string | null) {
  return useQuery({
    queryKey: ["location-request-lookup", token],
    enabled: !!token,
    retry: 1,
    staleTime: 60_000,
    queryFn: async (): Promise<LocationRequestLookup> => {
      if (!isLocationRequestToken(token)) throw new Error("Некорректная ссылка");
      const { data, error } = await supabase.rpc("location_request_lookup", {
        p_token: token,
      });
      if (error) throw new Error(friendlyNetworkError(error.message));
      return parseLookup(data);
    },
  });
}

export async function submitLocationRequest(
  token: string,
  payload: Record<string, string>,
): Promise<SubmitResult> {
  const { data, error } = await supabase.rpc("location_request_submit", {
    p_token: token,
    p_payload: payload,
  });
  if (error) {
    if (/Нужен адрес/.test(error.message)) {
      throw new Error("Нужен адрес, точка на карте или ссылка.");
    }
    throw new Error(friendlyNetworkError(error.message));
  }
  return parseSubmit(data);
}

function friendlyNetworkError(message: string): string {
  return /fetch|network|failed to/i.test(message)
    ? "Нет связи. Проверьте интернет и повторите."
    : message;
}

/** «Я сейчас здесь» есть только в браузере: expo-location в сборке нет, а
 *  клиент открывает страницу телефоном. */
export function canLocate(): boolean {
  return (
    Platform.OS === "web" &&
    typeof navigator !== "undefined" &&
    !!navigator.geolocation
  );
}

export function locateMe(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!canLocate()) {
      reject(new Error("Геопозиция недоступна — напишите адрес."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) =>
        reject(
          new Error(
            error.code === 1
              ? "Доступ к геопозиции закрыт. Разрешите его в браузере или напишите адрес."
              : "Не удалось определить место. Напишите адрес.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    );
  });
}

/** Точка → улица, город, индекс (Nominatim, без ключа). Лучшее усилие: без
 *  ответа за 5 секунд форма остаётся с одной точкой — маршрут по пину всё
 *  равно точнее текста. */
export async function reverseGeocode(
  c: Coords,
): Promise<{ street?: string; city?: string; zip?: string }> {
  if (typeof fetch !== "function") return {};
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 5_000) : null;
  try {
    const url =
      "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=ru,en" +
      `&lat=${encodeURIComponent(c.lat)}&lon=${encodeURIComponent(c.lng)}`;
    const response = await fetch(url, {
      signal: controller?.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return {};
    return partsFromNominatim(await response.json());
  } catch {
    return {};
  } finally {
    if (timer) clearTimeout(timer);
  }
}
