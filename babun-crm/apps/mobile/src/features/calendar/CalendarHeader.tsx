import { Pressable, Text, View } from "react-native";
import { CalendarClock, ChevronDown, Settings } from "lucide-react-native";
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
  onToday: () => void;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        paddingHorizontal: 6,
        minHeight: 48,
        backgroundColor: t.surface,
        borderBottomWidth: 1,
        borderBottomColor: t.separator,
      }}
    >
      <Pressable
        onPress={onGear}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Настройки календаря"
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
        <Text
          style={{ fontSize: 17, fontWeight: "700", color: t.ink, textTransform: "capitalize" }}
          numberOfLines={1}
        >
          {monthTitle}
        </Text>
        <ChevronDown color={t.faint} size={15} strokeWidth={2.5} />
      </Pressable>

      {!isOnToday ? (
        <Pressable
          onPress={onToday}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Сегодня, ${todayNumber}`}
          style={({ pressed }) => ({
            width: 40,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 20,
            backgroundColor: pressed ? t.pressed : "transparent",
          })}
        >
          <CalendarClock color={t.sub} size={20} strokeWidth={2} />
          <Text
            style={{
              position: "absolute",
              fontSize: 11,
              fontWeight: "700",
              color: t.sub,
              transform: [{ translateY: 3 }],
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
