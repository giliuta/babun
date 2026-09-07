import {
  getDaySchedule,
  WEEKDAY_KEYS,
  WEEKDAY_NAMES,
  type DaySchedule,
  type TeamSchedule,
  type WeekdayKey,
} from "@babun/shared/local/schedule";
import { formatYMD, humanDay, parseYMD } from "@/features/appointments/helpers";

// Рабочий график по дням. TeamSchedule НЕ имеет поля «дни»: рабочий день
// живёт в overrides[key].is_working, а schedule.start/end помечены как
// legacy и перекрываются любым weekday-override. Поэтому UI обязан читать
// ДЕЙСТВУЮЩЕЕ значение через getDaySchedule — плоский редактор «Начало /
// Конец смены» врал бы по построению.

const JS_DAY: Record<WeekdayKey, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/** Ключ дня → ISO-номер (1=Пн…7=Вс). В этой нумерации живут расписание
 *  меток (`cities.weekdays`) и рабочие дни услуги, а график команды —
 *  в своих ключах; без явной таблицы их легко перепутать, и неделя уехала
 *  бы на день. */
export const ISO_BY_KEY: Record<WeekdayKey, number> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 7,
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
function hasMixedHours(schedule: TeamSchedule): boolean {
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

// ─── Особые дни (date_overrides) ─────────────────────────────────────

/** Настоящий ли это ключ даты «YYYY-MM-DD». Round-trip через parseYMD
 *  отвергает и мусор из адресной строки, и несуществующие даты вроде
 *  «2026-02-31»: setFullYear молча перекатил бы их в март. */
export function isDateKey(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && formatYMD(parseYMD(v)) === v;
}

/** «Сб, 22 августа» — подпись особого дня (заголовок экрана и строка
 *  списка). Год дописывается только чужой: особые дни живут вблизи
 *  сегодняшнего, и вечное «2026» в каждой строке было бы шумом. */
export function specialDayLabel(dateKey: string): string {
  const s = humanDay(dateKey);
  const label = s.charAt(0).toUpperCase() + s.slice(1);
  const year = Number(dateKey.slice(0, 4));
  return year === new Date().getFullYear() ? label : `${label} ${year}`;
}

