// Время записи → момент UTC для iCalendar.
//
// Запись хранит «настенное» время компании (дата + «ЧЧ:ММ») без зоны. Раньше
// лента отдавала его «плавающим» (без Z) с подсказкой X-WR-TIMEZONE — её
// понимают не все календари, и у подписчика в другой зоне (или в календаре,
// который подсказку игнорирует) визит съезжал на разницу зон. Теперь каждое
// время переводится в настоящий момент в зоне компании и пишется в UTC
// (`YYYYMMDDTHHMMSSZ`) — его одинаково читает любой календарь.
//
// Перенос `zonedWallTimeToInstant` из packages/shared: функция Edge не
// импортирует пакет рабочей области. Семантика та же: в осеннем повторе
// часа — более ранний момент, в весеннем пропуске — сдвиг вперёд на пропуск.

export const DEFAULT_TIME_ZONE = "Europe/Nicosia";

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function epochOf(p: WallClock): number {
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function wallClockAt(epoch: number, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(new Date(epoch));
  const read = (type: string): number => {
    const value = Number(parts.find((p) => p.type === type)?.value);
    if (!Number.isFinite(value)) {
      throw new RangeError(`Не удалось вычислить время в зоне ${timeZone}`);
    }
    return value;
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

/** Зона IANA, которую понимает движок, иначе зона по умолчанию. */
export function resolveTimeZone(zone: string | null | undefined): string {
  const candidate = (zone ?? "").trim();
  if (!candidate) return DEFAULT_TIME_ZONE;
  try {
    formatterFor(candidate);
    return candidate;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/**
 * «Настенное» время в зоне → момент. «24:00» — полночь следующего дня (так
 * хранится конец записи до конца суток). Мусор → RangeError.
 */
export function wallTimeToInstant(
  dateKey: string,
  time: string,
  timeZone: string,
): Date {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!d || !t) {
    throw new RangeError(`Некорректные дата или время: ${dateKey} ${time}`);
  }
  const hour = Number(t[1]);
  const minute = Number(t[2]);
  const second = Number(t[3] ?? 0);
  const endOfDay = hour === 24 && minute === 0 && second === 0;
  if ((!endOfDay && hour > 23) || minute > 59 || second > 59) {
    throw new RangeError(`Некорректное время: ${time}`);
  }
  const base: WallClock = {
    year: Number(d[1]),
    month: Number(d[2]),
    day: Number(d[3]),
    hour: 0,
    minute: 0,
    second: 0,
  };
  const dayProof = new Date(epochOf(base));
  if (
    dayProof.getUTCFullYear() !== base.year ||
    dayProof.getUTCMonth() + 1 !== base.month ||
    dayProof.getUTCDate() !== base.day
  ) {
    throw new RangeError(`Некорректная дата: ${dateKey}`);
  }
  // «24:00» — та же арифметика, что и 00:00 следующего дня.
  const desiredEpoch = epochOf(base) + ((hour * 60 + minute) * 60 + second) * 1000;

  // Смещений у зоны вокруг одной даты немного: берём обе стороны, чтобы день
  // перехода дал и летнее, и зимнее.
  const offsets = new Set<number>();
  for (let h = -48; h <= 48; h += 6) {
    const sampled = desiredEpoch + h * 3_600_000;
    offsets.add(epochOf(wallClockAt(sampled, timeZone)) - sampled);
  }
  const exact: number[] = [];
  const forward: { epoch: number; delta: number }[] = [];
  for (const offset of offsets) {
    const candidate = desiredEpoch - offset;
    const delta = epochOf(wallClockAt(candidate, timeZone)) - desiredEpoch;
    if (delta === 0) exact.push(candidate);
    else if (delta > 0) forward.push({ epoch: candidate, delta });
  }
  if (exact.length > 0) return new Date(Math.min(...exact));
  if (forward.length > 0) {
    forward.sort((a, b) => a.delta - b.delta || a.epoch - b.epoch);
    return new Date(forward[0].epoch);
  }
  throw new RangeError(`Не удалось сопоставить ${dateKey} ${time} с зоной ${timeZone}`);
}

/** Момент → «YYYYMMDDTHHMMSSZ» (форма DATE-TIME в UTC из RFC 5545). */
export function utcStamp(instant: Date): string {
  return (
    instant.getUTCFullYear().toString().padStart(4, "0") +
    String(instant.getUTCMonth() + 1).padStart(2, "0") +
    String(instant.getUTCDate()).padStart(2, "0") +
    "T" +
    String(instant.getUTCHours()).padStart(2, "0") +
    String(instant.getUTCMinutes()).padStart(2, "0") +
    String(instant.getUTCSeconds()).padStart(2, "0") +
    "Z"
  );
}

/**
 * Начало и конец записи в UTC. Конец раньше начала (запись через полночь)
 * — конец переносится на следующие сутки; равный началу остаётся как есть.
 * Мусор во времени → null: такую запись лента пропускает, а не ломается
 * целиком.
 */
export function eventSpan(
  dateKey: string,
  timeStart: string,
  timeEnd: string,
  timeZone: string,
): { start: string; end: string } | null {
  try {
    const start = wallTimeToInstant(dateKey, timeStart, timeZone);
    let end = wallTimeToInstant(dateKey, timeEnd, timeZone);
    if (end.getTime() < start.getTime()) {
      const next = new Date(Date.parse(`${dateKey}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
      end = wallTimeToInstant(next, timeEnd, timeZone);
      if (end.getTime() <= start.getTime()) return null;
    }
    return { start: utcStamp(start), end: utcStamp(end) };
  } catch {
    return null;
  }
}
