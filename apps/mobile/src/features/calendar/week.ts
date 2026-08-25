// Первый день недели. Настройка живёт в calendar_settings.week_start и
// давно есть в вебе; на мобиле понедельник был зашит тремя независимыми
// константами — в Неделе (mondayOf), в Месяце и в мини-календаре. Здесь
// один дом на все три, иначе следующая правка снова разъедется.

export type WeekStart = "monday" | "sunday";

const WD_MON = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WD_SUN = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

/** Подписи колонок в порядке недели. */
export function weekdayLabels(weekStart: WeekStart): string[] {
  return weekStart === "sunday" ? WD_SUN : WD_MON;
}

/** Номер колонки для JS-дня недели (0=Вс … 6=Сб) при данном первом дне. */
export function weekdayIndex(jsDay: number, weekStart: WeekStart): number {
  return weekStart === "sunday" ? jsDay : (jsDay + 6) % 7;
}

/** Обратное к weekdayIndex: JS-день недели (0=Вс) для колонки i. */
export function jsDayOfColumn(i: number, weekStart: WeekStart): number {
  return weekStart === "sunday" ? i : (i + 1) % 7;
}

/** Выходной ли столбец — считается по реальному дню, а не по номеру
 *  колонки: при воскресенье-первым выходные стоят по краям (0 и 6). */
export function isWeekendColumn(i: number, weekStart: WeekStart): boolean {
  const jsDay = jsDayOfColumn(i, weekStart);
  return jsDay === 0 || jsDay === 6;
}

/** Начало недели, в которую попадает дата (локальная полночь). */
export function startOfWeek(d: Date, weekStart: WeekStart): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - weekdayIndex(x.getDay(), weekStart));
  return x;
}
