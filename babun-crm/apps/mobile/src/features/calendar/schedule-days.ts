import {
  getDaySchedule,
  WEEKDAY_KEYS,
  WEEKDAY_NAMES,
  type DaySchedule,
  type TeamSchedule,
  type WeekdayKey,
} from "@babun/shared/local/schedule";

// Рабочий график по дням. TeamSchedule НЕ имеет поля «дни»: рабочий день
// живёт в overrides[key].is_working, а schedule.start/end помечены как
// legacy и перекрываются любым weekday-override. Поэтому UI обязан читать
// ДЕЙСТВУЮЩЕЕ значение через getDaySchedule — плоский редактор «Начало /
// Конец смены» врал бы по построению.

export const JS_DAY: Record<WeekdayKey, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export const WEEKDAY_FULL: Record<WeekdayKey, string> = {
  mon: "Понедельник",
  tue: "Вторник",
  wed: "Среда",
  thu: "Четверг",
  fri: "Пятница",
  sat: "Суббота",
  sun: "Воскресенье",
};

export function isWeekdayKey(v: string): v is WeekdayKey {
  return (WEEKDAY_KEYS as string[]).includes(v);
}

/** Действующий график дня недели. */
export function dayOf(schedule: TeamSchedule, key: WeekdayKey): DaySchedule {
  return getDaySchedule(schedule, JS_DAY[key]);
}

/** Все семь дней в порядке Пн…Вс с действующими значениями. */
export function allDays(
  schedule: TeamSchedule,
): { key: WeekdayKey; day: DaySchedule }[] {
  return WEEKDAY_KEYS.map((key) => ({ key, day: dayOf(schedule, key) }));
}

/** Записать день: первая правка материализует override из general. */
export function withDay(
  schedule: TeamSchedule,
  key: WeekdayKey,
  patch: Partial<DaySchedule>,
): TeamSchedule {
  return {
    ...schedule,
    overrides: {
      ...(schedule.overrides ?? {}),
      [key]: { ...dayOf(schedule, key), ...patch },
    },
  };
}

/**
 * Раздать часы одного дня всем остальным. Часы уезжают в general, а из
 * override'ов вычищаются — но is_working каждого дня СОХРАНЯЕТСЯ: «те же
 * часы» не значит «работаем и в воскресенье».
 */
export function withHoursEverywhere(
  schedule: TeamSchedule,
  start: string,
  end: string,
): TeamSchedule {
  const overrides: Partial<Record<WeekdayKey, DaySchedule>> = {};
  for (const key of WEEKDAY_KEYS) {
    const cur = dayOf(schedule, key);
    // Ключ оставляем выходным — и рабочим дням со своими ПЕРЕРЫВАМИ: breaks
    // это самостоятельные данные (обед), getDaySchedule отдаёт их только из
    // override, и удаление ключа ради «часы теперь из general» стёрло бы обед
    // вместе с ним. Рабочий день без перерывов ключа не требует — он и так
    // возьмёт новые общие часы.
    if (!cur.is_working || cur.breaks.length > 0) {
      overrides[key] = { ...cur, start, end };
    }
  }
  return { ...schedule, start, end, overrides };
}

// Сдвиг «HH:MM» на час в пределах суток — минимальная починка пары
// начало/конец, когда правка одной границы перескочила другую.
function shiftHourHM(hm: string, delta: number): string {
  const [h, m] = hm.split(":").map(Number);
  const next = Math.max(0, Math.min(23, (Number.isFinite(h) ? h : 0) + delta));
  return `${String(next).padStart(2, "0")}:${String(
    Number.isFinite(m) ? m : 0,
  ).padStart(2, "0")}`;
}

export const addHourHM = (hm: string) => shiftHourHM(hm, 1);
export const subHourHM = (hm: string) => shiftHourHM(hm, -1);

/** Есть ли хоть один день со своими часами (для подписи «Разный по дням»). */
export function hasMixedHours(schedule: TeamSchedule): boolean {
  const working = allDays(schedule)
    .map(({ day }) => day)
    .filter((d) => d.is_working);
  if (working.length === 0) return false;
  return !working.every(
    (d) => d.start === working[0].start && d.end === working[0].end,
  );
}

/**
 * График одной строкой: «Пн–Пт · 10:00–20:00» / «Разный по дням» / «Ни одного
 * рабочего дня». Единственная подпись, которой календари отличаются друг от
 * друга, поэтому нужна и в списке календарей, и на экране команды.
 *
 * Читаем ДЕЙСТВУЮЩИЕ значения (allDays → getDaySchedule): legacy
 * schedule.start/end показывать нельзя — их перекрывает любой weekday-override,
 * и плоское «10:00–20:00» соврало бы про субботу до 15:00.
 */
export function schedulePreview(schedule: TeamSchedule): string {
  const days = allDays(schedule);
  const working = days.filter(({ day }) => day.is_working);
  if (working.length === 0) return "Ни одного рабочего дня";
  if (hasMixedHours(schedule)) return "Разный по дням";

  const hours = `${working[0].day.start}–${working[0].day.end}`;
  if (working.length === 7) return `Пн–Вс · ${hours}`;
  // Подряд идущие рабочие дни — диапазоном, вразнобой — перечислением.
  const idx = days
    .map(({ day }, i) => (day.is_working ? i : -1))
    .filter((i) => i >= 0);
  const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  const names = WEEKDAY_KEYS.map((k) => WEEKDAY_NAMES[k]);
  const label = contiguous
    ? idx.length === 1
      ? names[idx[0]]
      : `${names[idx[0]]}–${names[idx[idx.length - 1]]}`
    : idx.map((i) => names[i]).join(", ");
  return `${label} · ${hours}`;
}
