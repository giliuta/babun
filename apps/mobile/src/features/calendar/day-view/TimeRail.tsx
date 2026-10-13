import { useMemo } from "react";
import { Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { pad2 } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import { useUnstretchedStyle } from "@/features/calendar/zoom";
import { minToHM, pct, RAIL_W } from "@/features/calendar/grid-units";
import { DEFAULT_END, DEFAULT_START } from "./constants";

// The fixed hour-label rail on the left of the grid: one flex cell per hour
// (equal split of the animated grid height), each label riding its cell top.
// `nowMinutes` (только когда видимый период содержит сегодня) рисует красную
// капсулу текущего времени на высоте now-line — Apple Calendar паттерн;
// соседний часовой лейбл в ±18 мин прячется, чтобы не слипались.
export function TimeRail({
  startHour = DEFAULT_START,
  endHour = DEFAULT_END,
  nowMinutes,
}: {
  startHour?: number;
  endHour?: number;
  nowMinutes?: number | null;
}) {
  const t = useThemeColors();
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = startHour; h < endHour; h++) out.push(h);
    return out;
  }, [startHour, endHour]);
  const winStart = startHour * 60;
  const winEnd = endHour * 60;
  const nowInWin =
    nowMinutes != null && nowMinutes >= winStart && nowMinutes <= winEnd
      ? nowMinutes
      : null;
  const nearNow = (h: number) =>
    nowInWin != null && Math.abs(h * 60 - nowInWin) < 18;
  // Пока идёт щипок, сетка тянется картинкой — подписи держат форму.
  const unstretched = useUnstretchedStyle();
  // Чёрные цифры на белом рельсе — принцип «из чёрного, не серого»
  // (Bumpix-эталон): подписи осей не приглушаем.
  const labelStyle = {
    position: "absolute" as const,
    right: 6,
    width: RAIL_W - 8,
    textAlign: "right" as const,
    color: t.ink,
    fontSize: 12,
    fontWeight: "600" as const,
  };
  return (
    <View
      // Жирный разделитель рельса и сетки (запрос владельца 2026-07-13):
      // левая колонка времени отчётливо отделена от происходящего.
      style={{
        width: RAIL_W,
        backgroundColor: t.surface,
        borderRightWidth: 2,
        borderRightColor: `${t.ink}4d`,
      }}
    >
      {hours.map((h) => (
        <View key={h} style={{ flex: 1 }}>
          {nearNow(h) ? null : (
            <Animated.Text
              style={[
                labelStyle,
                { top: h === startHour ? 0 : -7, fontVariant: ["tabular-nums"] },
                unstretched,
              ]}
              maxFontSizeMultiplier={1.3}
              // Крупный шрифт системы × 1.3 не влезает в 40pt рельса: «06:00»
              // рвалось на «06:0» и «0» (повторный аудит 03.10). Одна строка,
              // ужимается до ширины.
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {`${pad2(h % 24)}:00`}
            </Animated.Text>
          )}
        </View>
      ))}
      {/* endHour label — anchored to the rail bottom, no cell needed. */}
      <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 0 }}>
        {nearNow(endHour) ? null : (
          <Animated.Text
            style={[labelStyle, { top: -7, fontVariant: ["tabular-nums"] }, unstretched]}
            maxFontSizeMultiplier={1.3}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {endHour === 24 ? "24:00" : `${pad2(endHour % 24)}:00`}
          </Animated.Text>
        )}
      </View>
      {/* Капсула текущего времени — на высоте now-line колонки сегодня. */}
      {nowInWin != null ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              right: 3,
              top: pct(nowInWin - winStart, winEnd - winStart),
              marginTop: -8,
              height: 16,
              borderRadius: t.radius.card,
              paddingHorizontal: 4,
              justifyContent: "center",
              backgroundColor: t.danger,
            },
            unstretched,
          ]}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            style={{
              fontSize: 11,
              fontWeight: "700",
              color: t.onAccent,
              fontVariant: ["tabular-nums"],
            }}
          >
            {minToHM(nowInWin)}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}
