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
