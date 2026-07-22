import type { CalendarSettings } from "@babun/shared/local/calendar-settings";
import type { SheetOption } from "@/components/ui/OptionSheet";

// Наборы вариантов для настроек календаря. Один дом на оба экрана (общий
// /calendar и календарь команды /calendar/[teamId]) — иначе списки часов и
// буфера разъедутся ровно так же, как разъехались степперы и чипы, которые
// они заменили.

export function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

/**
 * Действующие рабочие часы компании. Один дом на всю фичу.
 *
 * work_start_hour / work_end_hour добавлены миграцией позже start_hour /
 * end_hour и БЕЗ default, а путь чтения из Supabase не санитайзится — у живых
 * тенантов они запросто null (проверено в проде). Фолбэк обязан совпадать с
 * тем, что реально красит сетку (DayView: `workStartHour ?? startHour`), иначе
 * экран настроек покажет часы, которых никто не задавал.
 */
export function effectiveWorkHours(g: CalendarSettings): {
  start: number;
  end: number;
} {
  return {
    start: g.workStartHour ?? g.startHour ?? 0,
    end: g.workEndHour ?? g.endHour ?? 24,
  };
}

/**
 * Гарантирует, что действующее значение есть в списке. Иначе лист открывается
 * без единой галочки при непустой строке: в колонке может лежать значение,
 * которого нет в наборе (например длительность 45 мин, записанная вебом).
 */
export function withCurrent(
  options: SheetOption<string>[],
  value: string,
  label: string,
): SheetOption<string>[] {
  if (options.some((o) => o.value === value)) return options;
  return [...options, { value, label }].sort(
    (a, b) => Number(a.value) - Number(b.value),
  );
}

/** Буфер после записи. */
export const BUFFER_CHOICES: SheetOption<string>[] = [
  { value: "0", label: "Нет" },
  { value: "5", label: "5 мин" },
  { value: "10", label: "10 мин" },
  { value: "15", label: "15 мин" },
  { value: "30", label: "30 мин" },
  { value: "60", label: "1 час" },
];

export function bufferLabel(min: number): string {
  return BUFFER_CHOICES.find((o) => o.value === String(min))?.label ?? `${min} мин`;
}

/** Длительность новой записи. */
export const SLOT_CHOICES: SheetOption<string>[] = [
  { value: "15", label: "15 мин" },
  { value: "30", label: "30 мин" },
  { value: "45", label: "45 мин" },
  { value: "60", label: "1 час" },
  { value: "90", label: "1 ч 30 мин" },
  { value: "120", label: "2 часа" },
];

export function slotLabel(min: number): string {
  return SLOT_CHOICES.find((o) => o.value === String(min))?.label ?? `${min} мин`;
}

/** Город из «Europe/Nicosia» — в списке и в строке значения. */
export function tzLabel(tz: string): string {
  return tz.replace(/^.*\//, "").replace(/_/g, " ");
}
