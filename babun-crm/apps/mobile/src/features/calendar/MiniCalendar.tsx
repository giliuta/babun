import { useMemo, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { formatYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";

const DAY_HEADERS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

// Web-parity date jumper (web MiniCalendar, trimmed): tap the «Месяц Год ⌄»
// header title → this popover; pick any day to jump the calendar there.
// Dot under a day = it has non-cancelled appointments. «Сегодня» at the
// bottom returns home. (Long-press preview + year grid stay web-only.)
export function MiniCalendar({
  visible,
  currentDate,
  todayYmd,
  appointments,
  onSelectDate,
  onClose,
}: {
  visible: boolean;
  currentDate: Date;
  /** Business-timezone today (YYYY-MM-DD). */
  todayYmd: string;
  appointments: Appointment[];
  onSelectDate: (d: Date) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const [viewYear, setViewYear] = useState(currentDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(currentDate.getMonth());

  // Re-anchor to the calendar's date every time the popover opens.
  const [anchorKey, setAnchorKey] = useState("");
  const openKey = visible ? formatYMD(currentDate) : "";
  if (visible && anchorKey !== openKey) {
    setAnchorKey(openKey);
    setViewYear(currentDate.getFullYear());
    setViewMonth(currentDate.getMonth());
  }

  const countByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of appointments) {
      if (a.status === "cancelled") continue;
      m.set(a.date, (m.get(a.date) ?? 0) + 1);
    }
    return m;
  }, [appointments]);

  const firstDow = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else setViewMonth(viewMonth + 1);
  };

  const monthTitle = new Date(viewYear, viewMonth, 1)
    .toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
    .replace(/\s*г\.?\s*$/i, "");

  const CELL = 40;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: t.scrim }} onPress={onClose}>
        <Pressable
          // Stop taps inside the card from closing the modal.
          onPress={() => {}}
          style={{
            position: "absolute",
            top: insets.top + 52,
            left: 12,
            width: 7 * CELL + 24,
            backgroundColor: t.surface,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: t.separator,
            padding: 12,
            boxShadow: t.cardShadow,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <Pressable
              onPress={prevMonth}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Предыдущий месяц"
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 16,
                backgroundColor: pressed ? t.pressed : "transparent",
              })}
            >
              <ChevronLeft color={t.sub} size={16} strokeWidth={2.5} />
            </Pressable>
            <Text
              style={{ fontSize: 15, fontWeight: "600", color: t.ink, textTransform: "capitalize" }}
            >
              {monthTitle}
            </Text>
            <Pressable
              onPress={nextMonth}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Следующий месяц"
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 16,
                backgroundColor: pressed ? t.pressed : "transparent",
              })}
            >
              <ChevronRight color={t.sub} size={16} strokeWidth={2.5} />
            </Pressable>
          </View>

          <View style={{ flexDirection: "row" }}>
            {DAY_HEADERS.map((d) => (
              <Text
                key={d}
                style={{
                  width: CELL,
                  textAlign: "center",
                  fontSize: 11,
                  fontWeight: "600",
                  textTransform: "uppercase",
                  color: t.sub,
                  paddingVertical: 4,
                }}
              >
                {d}
              </Text>
            ))}
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {Array.from({ length: firstDow }).map((_, i) => (
              <View key={`e-${i}`} style={{ width: CELL, height: CELL }} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const date = new Date(viewYear, viewMonth, day);
              const key = formatYMD(date);
              const isToday = key === todayYmd;
              const count = countByDate.get(key) ?? 0;
              return (
                <Pressable
                  key={day}
                  onPress={() => onSelectDate(date)}
                  accessibilityRole="button"
                  accessibilityLabel={`${day} ${date.toLocaleDateString("ru-RU", { month: "long" })}${isToday ? ", сегодня" : ""}${count > 0 ? `, записей: ${count}` : ""}`}
                  style={({ pressed }) => ({
                    width: CELL,
                    height: CELL,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: CELL / 2,
                    backgroundColor: isToday
                      ? t.accent
                      : pressed
                        ? t.pressed
                        : "transparent",
                  })}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: isToday ? "700" : "400",
                      color: isToday ? t.onAccent : t.ink,
                    }}
                    className="tabular-nums"
                  >
                    {day}
                  </Text>
                  <View
                    style={{
                      width: 4,
                      height: 4,
                      borderRadius: 2,
                      marginTop: 1,
                      backgroundColor:
                        count > 0
                          ? isToday
                            ? "rgba(255,255,255,0.8)"
                            : t.accent
                          : "transparent",
                    }}
                  />
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={() => {
              const [y, m, d] = todayYmd.split("-").map(Number);
              onSelectDate(new Date(y, (m || 1) - 1, d || 1));
            }}
            accessibilityRole="button"
            style={({ pressed }) => ({
              marginTop: 8,
              height: 36,
              borderRadius: 10,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${t.accent}1a`,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ fontSize: 13, fontWeight: "600", color: t.accent }}>
              Сегодня
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
