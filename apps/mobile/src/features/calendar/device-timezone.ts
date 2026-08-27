// ЗОНА ТЕЛЕФОНА И ЧТО С НЕЙ МОЖНО ДЕЛАТЬ.
//
// Главное правило файла: сравнивать зоны ПО СМЕЩЕНИЮ, а не по строке.
// Симулятор отдаёт `Asia/Nicosia`, в списке лежит `Europe/Nicosia` — строки
// разные, сутки одни и те же. Сравнение строк заставило бы продукт
// переписывать зону при каждом запуске и «дрейфовать», стоя на месте.

export const FALLBACK_ZONE = "Europe/Nicosia";

/** Зона устройства. До 2026-08-27 не спрашивалась НИ РАЗУ: в дефолтах лежала
 *  Никосия, и мастер в Варшаве жил по кипрским суткам, ни разу не открыв
 *  экран настроек. */
export function deviceZone(): string {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return z && z.length > 2 ? z : FALLBACK_ZONE;
  } catch {
    return FALLBACK_ZONE;
  }
}

/** Смещение зоны в минутах на момент `at`. Через `formatToParts`, потому что
 *  готового API у `Intl` нет, а `getTimezoneOffset` знает только зону
 *  устройства. */
export function zoneOffsetMinutes(zone: string, at: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    // `% 24` НЕ УКРАШЕНИЕ: при hour12:false часть сборок ICU печатает полночь
    // как «24», и Date.UTC уезжает на сутки вперёд — ровно ошибка ценой в день.
    const asUTC = Date.UTC(
      g("year"),
      g("month") - 1,
      g("day"),
      g("hour") % 24,
      g("minute"),
      g("second"),
    );
    return Math.round((asUTC - at.getTime()) / 60000);
  } catch {
    return 0;
  }
}

const HALF_YEAR_MS = 183 * 24 * 60 * 60 * 1000;

/** Две зоны дают ОДНУ И ТУ ЖЕ границу суток — сейчас и через полгода.
 *
 *  Полугодовая проба и есть проверка на перевод часов: `Asia/Nicosia` и
 *  `Europe/Nicosia` совпадут в обеих точках, а `Europe/Warsaw` и `Etc/GMT-2`
 *  разойдутся в последнее воскресенье октября. Без второй пробы продукт
 *  считал бы фиксированную зону равной живой — и 25 октября всё, что
 *  происходит после 23:00, уехало бы в другие сутки: в кассе, в закрытии
 *  дня, в отчётах. */
export function sameDayBoundary(a: string, b: string, at: Date = new Date()): boolean {
  const later = new Date(at.getTime() + HALF_YEAR_MS);
  return (
    zoneOffsetMinutes(a, at) === zoneOffsetMinutes(b, at) &&
    zoneOffsetMinutes(a, later) === zoneOffsetMinutes(b, later)
  );
}

/** «UTC+3», «UTC−5:30», «UTC». Печатается человеку, поэтому минус — типографский. */
export function utcLabel(zone: string, at: Date = new Date()): string {
  const m = zoneOffsetMinutes(zone, at);
  if (m === 0) return "UTC";
  const h = Math.floor(Math.abs(m) / 60);
  const mm = Math.abs(m) % 60;
  return `UTC${m < 0 ? "−" : "+"}${h}${mm ? ":" + String(mm).padStart(2, "0") : ""}`;
}

/** Который час в этой зоне прямо сейчас. Строка списка показывает ЧАСЫ, а не
 *  имя зоны: человек не обязан помнить, как называется его пояс, но он точно
 *  знает, сколько сейчас на его часах. */
export function zoneClock(zone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at);
  } catch {
    return "--:--";
  }
}
