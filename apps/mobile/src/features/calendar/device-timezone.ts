// ЧАСОВОЙ ПОЯС: СМЕЩЕНИЕ И ЧАСЫ.
//
// Смещение и часы зоны — то, что печатается человеку в списке поясов.
// Считается через `formatToParts`: готового API у `Intl` нет, а
// `getTimezoneOffset` знает только зону самого устройства.

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
