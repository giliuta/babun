import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { Calendar, ChevronDown, Settings } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import { ViewModeDropdown, type CalMode } from "@/features/calendar/ViewModeDropdown";

// Web-parity calendar top bar: gear · «{Month} {Year} ⌄» · today · view dropdown.
// Title tap opens the MiniCalendar date jumper (web Header.tsx), the
// CalendarClock icon (with today's number, hidden when already on today)
// jumps home — two different actions, like on web.
export function CalendarHeader({
  monthTitle,
  mode,
  todayNumber,
  isOnToday,
  onModeChange,
  onGear,
  onTitlePress,
  onTitleLongPress,
  onToday,
}: {
  monthTitle: string;
  mode: CalMode;
  /** Day-of-month to stamp over the today icon (web CalendarClock). */
  todayNumber: number;
  /** Hide the today button when the view is already on today. */
  isOnToday: boolean;
  onModeChange: (m: CalMode) => void;
  onGear: () => void;
  onTitlePress: () => void;
  /** ВРЕМЕННО: дев-цикл вариантов ячейки даты (date-header.tsx). */
  onTitleLongPress?: () => void;
  onToday: () => void;
}) {
  const t = useThemeColors();
  return (
    <View
      // Без своего borderBottom: единый шов под хромом шапки несёт полоса
      // TeamChips ниже — две линии подряд читались бы как случайный зазор.
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        minHeight: 48,
        backgroundColor: t.surface,
      }}
    >
      <Pressable
        onPress={onGear}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Настройки команды"
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 22,
          backgroundColor: pressed ? t.pressed : "transparent",
        })}
      >
        <Settings color={t.sub} size={21} strokeWidth={2} />
      </Pressable>

      <Pressable
        onPress={onTitlePress}
        onLongPress={onTitleLongPress}
        delayLongPress={400}
        accessibilityRole="button"
        accessibilityLabel={`${monthTitle}, выбрать дату`}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          height: 44,
          paddingHorizontal: 6,
          borderRadius: 12,
          backgroundColor: pressed ? t.pressed : "transparent",
        })}
      >
        {/* key=title: смена месяца мягко въезжает (150 мс) — единственный
            сигнал смены месяца в «Дне»; Reduce Motion гасит сам reanimated. */}
        <Animated.View key={monthTitle} entering={FadeIn.duration(150)}>
          <Text
            // 17/600/-0.2 — вес и трекинг iOS-навбара; 700 спорил с контентом.
            style={{
              fontSize: 17,
              fontWeight: "600",
              letterSpacing: -0.2,
              color: t.ink,
              textTransform: "capitalize",
            }}
            numberOfLines={1}
          >
            {monthTitle}
          </Text>
        </Animated.View>
        <ChevronDown color={t.faint} size={16} strokeWidth={2.5} />
      </Pressable>

      {!isOnToday ? (
        <Pressable
          onPress={onToday}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Сегодня, ${todayNumber}`}
          // 44×44 — минимальная нажимаемая область HIG (была 40 шириной).
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 22,
            backgroundColor: pressed ? t.pressed : "transparent",
          })}
        >
          {/* «Сегодня» = action → accent (DS: cobalt = action). A plain
              Calendar glyph with today's number stamped in its body reads
              like the iOS Calendar icon; the clock-variant crowded the digit. */}
          <Calendar color={t.accent} size={22} strokeWidth={2} />
          <Text
            style={{
              position: "absolute",
              fontSize: 10,
              fontWeight: "800",
              color: t.accent,
              transform: [{ translateY: 3.5 }],
            }}
            className="tabular-nums"
          >
            {todayNumber}
          </Text>
        </Pressable>
      ) : null}

      <ViewModeDropdown mode={mode} onChange={onModeChange} />
    </View>
  );
}
