import type { CalendarSettings } from "@babun/shared/local/calendar-settings";
import type { SheetOption } from "@/components/ui/OptionSheet";

// Наборы вариантов для настроек календаря. Один дом на оба экрана (общий
// /calendar и календарь команды /calendar/[teamId]) — иначе списки часов и
// буфера разъедутся ровно так же, как разъехались степперы и чипы, которые
// они заменили.

/** Часы суток для листов «начало/конец рабочего дня». */
export const HOUR_CHOICES: SheetOption<string>[] = Array.from(
  { length: 25 },
  (_, h) => ({ value: String(h), label: hourLabel(h) }),
);

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

/** Город из «Europe/Nicosia» — в списке и в строке значения. */
export function tzLabel(tz: string): string {
  return tz.replace(/^.*\//, "").replace(/_/g, " ");
}
