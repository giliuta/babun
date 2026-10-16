import { Pressable } from "react-native";
import { DateCell } from "@/features/calendar/date-header";
import { dayMonthLabel } from "../day-month-label";

// Sticky date header above the day grid — web parity (DayColumn header):
// the user must always see WHICH day is open. Same visual grammar as the
// WeekView days-row («Маршрут»): дата всегда в круге (кобальт = сегодня,
// ink = остальные), город — пилл с полным именем.
export function DayHeader({
  dateYmd,
  isToday,
  dayOff = false,
  label,
  onLabelTap,
}: {
  dateYmd: string;
  isToday: boolean;
  /** У команды на эту дату выходной — на месте метки встанет слово. */
  dayOff?: boolean;
  /** Метка дня (город команды). null при отсутствии — шапка чистая,
   *  никакого «+ метка» (Phase I38). */
  label?: { name: string; color: string } | null;
  /** Тап по ВСЕЙ шапке открывает пикер метки (web onCityTap). undefined,
   *  когда у команды нет меток — шапка не интерактивна. */
  onLabelTap?: () => void;
}) {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return (
    <Pressable
      onPress={onLabelTap}
      disabled={!onLabelTap}
      accessibilityRole={onLabelTap ? "button" : undefined}
      accessibilityLabel={
        onLabelTap
          ? `${dayMonthLabel(date)}, ${label ? `метка: ${label.name}` : "без метки"} — сменить метку`
          : undefined
      }
      className="active:opacity-70"
      style={{ flex: 1 }}
    >
      <DateCell
        date={date}
        size="lg"
        isToday={isToday}
        label={label}
        dayOff={dayOff}
      />
    </Pressable>
  );
}
