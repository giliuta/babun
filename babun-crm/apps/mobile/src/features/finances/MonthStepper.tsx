import { Pressable, Text, View } from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";

const RU_MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
] as const;

export interface MonthValue {
  year: number;
  /** 1–12. */
  month: number;
}

export function monthRange(v: MonthValue): { from: string; to: string } {
  const mm = String(v.month).padStart(2, "0");
  const last = new Date(Date.UTC(v.year, v.month, 0)).getUTCDate();
  return {
    from: `${v.year}-${mm}-01`,
    to: `${v.year}-${mm}-${String(last).padStart(2, "0")}`,
  };
}

export function monthOfYmd(ymd: string): MonthValue {
  return { year: Number(ymd.slice(0, 4)), month: Number(ymd.slice(5, 7)) };
}

function addMonths(v: MonthValue, delta: number): MonthValue {
  const zero = v.year * 12 + (v.month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

function isAfter(a: MonthValue, b: MonthValue): boolean {
  return a.year * 12 + a.month > b.year * 12 + b.month;
}

// «‹ Июль 2026 ›» — один жест владельца «за месяц». Вперёд дальше
// текущего бизнес-месяца не листается (там пусто по определению).
export function MonthStepper({
  value,
  max,
  onChange,
}: {
  value: MonthValue;
  /** Текущий бизнес-месяц — правая граница. */
  max: MonthValue;
  onChange: (v: MonthValue) => void;
}) {
  const t = useThemeColors();
  const next = addMonths(value, 1);
  const nextDisabled = isAfter(next, max);
  return (
    <View
      className="flex-row items-center justify-between px-2"
      style={{
        minHeight: 44,
        backgroundColor: t.surface,
        borderTopWidth: 1,
        borderTopColor: t.separator,
        borderBottomWidth: 1,
        borderBottomColor: t.separator,
      }}
    >
      <Pressable
        onPress={() => onChange(addMonths(value, -1))}
        accessibilityRole="button"
        accessibilityLabel="Предыдущий месяц"
        className="h-11 w-11 items-center justify-center active:opacity-60"
      >
        <ChevronLeft color={t.body} size={20} />
      </Pressable>
      <Text className="text-[15px] font-semibold" style={{ color: t.ink }}>
        {RU_MONTHS[value.month - 1]} {value.year}
      </Text>
      <Pressable
        onPress={() => onChange(next)}
        disabled={nextDisabled}
        accessibilityRole="button"
        accessibilityLabel="Следующий месяц"
        accessibilityState={{ disabled: nextDisabled }}
        className="h-11 w-11 items-center justify-center active:opacity-60"
        style={{ opacity: nextDisabled ? 0.3 : 1 }}
      >
        <ChevronRight color={t.body} size={20} />
      </Pressable>
    </View>
  );
}
