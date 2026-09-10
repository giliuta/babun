import type { Coords } from "@/features/clients/location-request-form";

// АДРЕС СЛОВАМИ → ТОЧКА НА КАРТЕ (владелец 2026-09-10: «когда я вписываю
// точный адрес, хочу, чтобы он ещё отображался на этой мини-карте — убедиться,
// что это точный адрес»).
//
// NOMINATIM (OpenStreetMap): без ключей, без аккаунта и одинаково работает и в
// приложении, и в вебе — та же служба, что рисует наши тайлы. Платный геокодер
// Google потребовал бы ключа в клиенте, а `expo-location` — ещё одной нативной
// пересборки у всех сессий ради одной строчки.
//
// ВЕЖЛИВОСТЬ К ЧУЖОЙ БЕСПЛАТНОЙ СЛУЖБЕ — часть контракта, а не наша щедрость:
// запрос уходит только когда карта раскрыта, не чаще раза в 800 мс после
// последней буквы, повторы берутся из памяти, а прошлый запрос отменяется.
// Не ответила или ответила «не нашёл» — просто ничего не двигаем: карта
// остаётся там, куда её поставили рукой.

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
/** Один и тот же адрес во время правки набирают десятки раз — второй раз в сеть
 *  не ходим. Память живёт столько же, сколько сессия приложения. */
const cache = new Map<string, Coords | null>();

export async function geocodeAddress(
  query: string,
  signal?: AbortSignal,
): Promise<Coords | null> {
  const q = query.replace(/\s+/g, " ").trim();
  // Три буквы — ещё не адрес: до них геокодер отвечает мусором.
  if (q.length < 4) return null;
  const hit = cache.get(q);
  if (hit !== undefined) return hit;

  const url = `${ENDPOINT}?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { lat?: string; lon?: string }[];
    const first = rows?.[0];
    const lat = Number(first?.lat);
    const lng = Number(first?.lon);
    const found =
      Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    cache.set(q, found);
    return found;
  } catch {
    // Отмена или сеть — не ошибка сценария: карту просто не двигаем.
    return null;
  }
}
