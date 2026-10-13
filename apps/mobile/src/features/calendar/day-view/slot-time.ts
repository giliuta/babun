import { minToHM } from "@/features/calendar/grid-units";

// ТАП ПО ПУСТОМУ МЕСТУ ВСЕГДА ЛОЖИТСЯ НА ПОЛЧАСА (владелец 2026-08-27: «оно
// должно выбираться по тридцатиминутный, то есть оно не может выбрать 45
// минут: либо 13:00, либо 13:30, либо 14:00»).
//
// Это НЕ то же самое, что шаг драга. Драг двигает существующую запись и живёт
// по `stepMinutes` (15): там человек метится в конкретную щель между двумя
// записями, и четверть часа — рабочая точность. Тап же назначает время
// с нуля, и попасть пальцем в 13:45 он не хотел — просто так лёг палец.
// Раньше обе операции делили одно число, и тап наследовал чужую точность.
//
// Пятиминутная точность никуда не делась: она в поле времени самой записи
// (`UnifiedTimePopup`), где её выставляют осознанно, а не пальцем по сетке.
export const TAP_STEP = 30;

/** Время под пальцем в ячейке часа, с шагом TAP_STEP. */
export function slotTimeAt(hour: number, locationY: number, hourH: number): string {
  // Sub-hour snap by touch position (web handleColumnClick parity):
  // floor to multiples of TAP_STEP, so a tap at 11:27 creates 11:00, at
  // 11:40 → 11:30. Screen-reader activation has no coordinates → whole
  // hour, matching the accessibilityLabel.
  const step = TAP_STEP;
  const offset = Math.min(
    60 - step,
    Math.floor(((locationY / hourH) * 60) / step) * step,
  );
  return minToHM(hour * 60 + Math.max(0, offset));
}
