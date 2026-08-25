// Date utility functions for the calendar

const DAY_NAMES_SHORT = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const MONTH_NAMES_GENITIVE = [
  "Января", "Февраля", "Марта", "Апреля", "Мая", "Июня",
  "Июля", "Августа", "Сентября", "Октября", "Ноября", "Декабря",
];
// Prepositional case ("в …"). Needed for hero strips like
// «1 новый в мае» — toLocaleDateString("ru-RU", {month:"long"})
// returns nominative ("май"), which reads as «1 новый в май».
const MONTH_NAMES_PREPOSITIONAL = [
  "январе", "феврале", "марте", "апреле", "мае", "июне",
  "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
];
const MONTH_NAMES_SHORT = [
  "янв", "фев", "мар", "апр", "май", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

export function getMonthNameShort(monthIndex: number): string {
  return MONTH_NAMES_SHORT[monthIndex];
}

export function getDayNameShort(date: Date): string {
  return DAY_NAMES_SHORT[date.getDay()];
}

export function getMonthName(monthIndex: number): string {
  return MONTH_NAMES[monthIndex];
}

export function getMonthNameGenitive(monthIndex: number): string {
  return MONTH_NAMES_GENITIVE[monthIndex];
}

export function getMonthNamePrepositional(monthIndex: number): string {
  return MONTH_NAMES_PREPOSITIONAL[monthIndex];
}

// Formats "2026-04-12" as "12 апреля 2026 г."
export function formatDateLongRu(dateKey: string): string {
  const d = new Date(dateKey + "T00:00:00");
  if (isNaN(d.getTime())) return dateKey;
  const months = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} г.`;
}

// v687 / Audit-2026-05-21 P1-47 — short RU date for small chips:
// "2026-08-19" → "19 авг". No year because the badge is always
// implied to be relative to the current year ± 12 months. Bigger
// surfaces use formatDateLongRu (which includes the year).
export function formatDateShortRu(dateKey: string): string {
  const d = new Date(dateKey + "T00:00:00");
  if (isNaN(d.getTime())) return dateKey;
  return `${d.getDate()} ${MONTH_NAMES_SHORT[d.getMonth()]}`;
}

export function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getWeekDates(mondayDate: Date): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayDate);
    d.setDate(mondayDate.getDate() + i);
    dates.push(d);
  }
  return dates;
}

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function addWeeks(date: Date, weeks: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function getFirstDayOfMonth(year: number, month: number): number {
  // Returns 0=Sunday ... 6=Saturday
  return new Date(year, month, 1).getDay();
}

export function getCurrentCyprusTime(): Date {
  // Кипр — EET (UTC+2) зимой / EEST (UTC+3) летом. Жёсткий +3 зимой
  // врал на час (линия «сейчас», todayYmd); Intl по IANA-зоне считает
  // переход EET/EEST сам.
  return getCurrentTimeInZone("Europe/Nicosia");
}

// Current wall-clock time in an IANA timezone (e.g. "Europe/Nicosia"),
// returned as a local Date whose getHours()/getMinutes() read that zone's
// clock. Used so a brigade calendar can place its "now" line in the
// brigade's own timezone. Falls back to device-local time on a bad zone id.
export function getCurrentTimeInZone(timeZone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date());
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value);
    const hour = get("hour") % 24; // Intl can emit "24" at midnight
    return new Date(
      get("year"),
      get("month") - 1,
      get("day"),
      hour,
      get("minute"),
      get("second"),
    );
  } catch {
    // Самый последний фолбэк — локальное время устройства: любой
    // «кипрский» суррогат без IANA-данных снова зашил бы смещение.
    return new Date();
  }
}

type WallClockParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatterByTimeZone = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterByTimeZone.get(timeZone);
  if (cached) return cached;
  // h23 keeps midnight at 00 instead of the locale-dependent 24. The
  // explicit numeric fields make formatToParts safe to interpret as a
  // timezone-free UTC tuple below.
  const formatter = new Intl.DateTimeFormat("en-CA-u-hc-h23", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  // Force validation now: some Intl implementations defer an invalid IANA
  // identifier error until the first format call.
  formatter.formatToParts(new Date(0));
  formatterByTimeZone.set(timeZone, formatter);
  return formatter;
}

function wallClockPartsAt(epochMs: number, timeZone: string): WallClockParts {
  const parts = wallClockFormatter(timeZone).formatToParts(new Date(epochMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = Number(parts.find((part) => part.type === type)?.value);
    if (!Number.isFinite(value)) {
      throw new RangeError(`Не удалось вычислить время в зоне ${timeZone}`);
    }
    return value;
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // Defensive modulo for older engines that ignore the h23 extension.
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

function wallClockEpoch(parts: WallClockParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

function parseWallClock(dateKey: string, time: string): WallClockParts {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) {
    throw new RangeError(`Некорректные дата или время: ${dateKey} ${time}`);
  }
  const parts: WallClockParts = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: 0,
  };
  const proof = new Date(wallClockEpoch(parts));
  if (
    proof.getUTCFullYear() !== parts.year ||
    proof.getUTCMonth() + 1 !== parts.month ||
    proof.getUTCDate() !== parts.day ||
    proof.getUTCHours() !== parts.hour ||
    proof.getUTCMinutes() !== parts.minute
  ) {
    throw new RangeError(`Некорректные дата или время: ${dateKey} ${time}`);
  }
  return parts;
}

/**
 * Convert business wall-clock fields into the real instant for an IANA zone.
 *
 * This deliberately never constructs a device-local Date. Around a fall DST
 * overlap the earlier occurrence is selected; inside a spring DST gap the
 * clock is shifted forward by the gap (Temporal's "compatible" behaviour).
 * Those semantics keep reminders deterministic on devices whose own timezone
 * differs from the brigade timezone.
 */
export function zonedWallTimeToInstant(
  dateKey: string,
  time: string,
  timeZone: string,
): Date {
  const desired = parseWallClock(dateKey, time);
  const desiredEpoch = wallClockEpoch(desired);

  // A timezone has only a small number of UTC offsets around a given date.
  // Sample both sides of the target so a transition day contributes the
  // pre- and post-DST offsets, including half/quarter-hour IANA zones.
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const sampledEpoch = desiredEpoch + hours * 60 * 60 * 1000;
    offsets.add(
      wallClockEpoch(wallClockPartsAt(sampledEpoch, timeZone)) - sampledEpoch,
    );
  }

  const exact: number[] = [];
  const shiftedForward: { epoch: number; wallDelta: number }[] = [];
  for (const offset of offsets) {
    const candidateEpoch = desiredEpoch - offset;
    const renderedEpoch = wallClockEpoch(
      wallClockPartsAt(candidateEpoch, timeZone),
    );
    const wallDelta = renderedEpoch - desiredEpoch;
    if (wallDelta === 0) exact.push(candidateEpoch);
    else if (wallDelta > 0) shiftedForward.push({ epoch: candidateEpoch, wallDelta });
  }

  if (exact.length > 0) {
    // Fall-back overlap: the same wall time occurs twice. "Compatible"
    // disambiguation chooses the earlier real instant.
    return new Date(Math.min(...exact));
  }
  if (shiftedForward.length > 0) {
    // Spring-forward gap: choose the candidate whose rendered wall time is
    // the nearest valid time after the requested one (02:30 -> 03:30).
    shiftedForward.sort(
      (a, b) => a.wallDelta - b.wallDelta || a.epoch - b.epoch,
    );
    return new Date(shiftedForward[0].epoch);
  }
  throw new RangeError(
    `Не удалось сопоставить ${dateKey} ${time} с зоной ${timeZone}`,
  );
}
