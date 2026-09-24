// ДАТЫ СТРАНИЦ КАБИНЕТА — ПО-РУССКИ И ПО ЧАСАМ ТЕЛЕФОНА. Напоминание звенит по
// часам этого iPhone, обновление по воздуху пришло в момент по ним же, поэтому
// здесь местное время устройства, а не часовой пояс календаря.

const WEEKDAYS = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
] as const;

const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

const pad2 = (value: number) => String(value).padStart(2, "0");

/** «2026-09-19» — местный день телефона. */
export function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** «09:30». */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** «19 сентября»; год пишется, только если он не текущий. */
export function dayMonth(ms: number, now: number): string {
  const d = new Date(ms);
  const year =
    d.getFullYear() === new Date(now).getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}${year}`;
}

/** «Пятница». */
export function weekdayName(ms: number): string {
  return WEEKDAYS[new Date(ms).getDay()] ?? "";
}
