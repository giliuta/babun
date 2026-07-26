import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useThemeColors } from "@/theme/colors";
import { HEADER_H, RAIL_W } from "@/features/calendar/DayView";
import { useReduceMotion } from "@/lib/reduce-motion";

// Скелет сетки на первую загрузку: настоящий каркас (шапка + рельс +
// «блоки» на реалистичных позициях) с мягким пульсом — «это мой календарь,
// сейчас наполнится», а не безликий спиннер. При Reduce Motion пульс
// выключен (статичные кости).
//
// «Кости»-блоки по колонкам: День — одна широкая колонка, Неделя — 7 узких
// (иначе скелет обещает не ту сетку, что загрузится).
// Месяц: бледная сетка 6×7 с шапкой дней недели — то же, что нарисует
// MonthView. Без пульса: 42 мигающие клетки это не ожидание, а рябь.
function MonthSkeleton({ bone, line }: { bone: string; line: string }) {
  const t = useThemeColors();
  return (
    <View style={{ flex: 1, backgroundColor: t.surface }}>
      <View
        style={{
          flexDirection: "row",
          backgroundColor: t.canvas,
          borderBottomWidth: 1,
          borderBottomColor: line,
        }}
      >
        {Array.from({ length: 7 }).map((_, i) => (
          <View key={i} style={{ flex: 1, alignItems: "center", paddingVertical: 8 }}>
            <View
              style={{ width: 18, height: 8, borderRadius: 4, backgroundColor: bone }}
            />
          </View>
        ))}
      </View>
      <View style={{ flex: 1 }}>
        {Array.from({ length: 6 }).map((_, r) => (
          <View key={r} style={{ flex: 1, flexDirection: "row" }}>
            {Array.from({ length: 7 }).map((_, c) => (
              <View
                key={c}
                style={{
                  flex: 1,
                  borderTopWidth: r === 0 ? 0 : 1,
                  borderTopColor: line,
                  borderLeftWidth: c === 0 ? 0 : 1,
                  borderLeftColor: line,
                  padding: 6,
                }}
              >
                <View
                  style={{
                    width: 16,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: bone,
                  }}
                />
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

// Агенда: три кости-строки списка — она список, а не сетка.
function AgendaSkeleton({
  bone,
  shimmer,
}: {
  bone: string;
  shimmer: { opacity: number };
}) {
  const t = useThemeColors();
  return (
    <View style={{ flex: 1, backgroundColor: t.canvas, paddingTop: 12 }}>
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={[
            {
              marginHorizontal: 12,
              marginBottom: 10,
              height: 64,
              borderRadius: 14,
              backgroundColor: bone,
            },
            shimmer,
          ]}
        />
      ))}
    </View>
  );
}

const BONES: Record<"day" | "week", { col: number; top: `${number}%`; height: `${number}%` }[]> = {
  day: [
    { col: 0, top: "12%", height: "10%" },
    { col: 0, top: "30%", height: "7%" },
    { col: 0, top: "52%", height: "16%" },
  ],
  week: [
    { col: 0, top: "12%", height: "10%" },
    { col: 1, top: "30%", height: "7%" },
    { col: 3, top: "18%", height: "12%" },
    { col: 4, top: "52%", height: "16%" },
    { col: 6, top: "36%", height: "9%" },
  ],
};

export type SkeletonMode = "day" | "week" | "month" | "agenda";

export function CalendarSkeleton({ mode = "week" }: { mode?: SkeletonMode }) {
  const t = useThemeColors();
  const reduced = useReduceMotion();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [pulse, reduced]);
  const shimmer = useAnimatedStyle(() => ({
    opacity: 0.45 + pulse.value * 0.35,
  }));

  const bone = `${t.ink}0f`;
  const line = `${t.ink}33`;

  // Месяц и Агенда — не сетка часов: подставлять им недельный рельс из семи
  // колонок значит обещать геометрию, которая не придёт.
  if (mode === "month") return <MonthSkeleton bone={bone} line={line} />;
  if (mode === "agenda") return <AgendaSkeleton bone={bone} shimmer={shimmer} />;

  const cols = mode === "week" ? 7 : 1;

  return (
    <View style={{ flex: 1 }}>
      {/* шапка дат */}
      <View
        style={{
          flexDirection: "row",
          height: HEADER_H,
          borderBottomWidth: 1,
          borderBottomColor: line,
        }}
      >
        <View style={{ width: RAIL_W, backgroundColor: t.surface }} />
        {Array.from({ length: cols }).map((_, c) => (
          <View
            key={c}
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            <View
              style={{
                width: mode === "week" ? 22 : 26,
                height: mode === "week" ? 22 : 26,
                borderRadius: 13,
                backgroundColor: bone,
              }}
            />
          </View>
        ))}
      </View>
      <View style={{ flex: 1, flexDirection: "row" }}>
        {/* рельс часов — шов 2px/ink4d как у настоящего TimeRail (DayView) */}
        <View
          style={{
            width: RAIL_W,
            backgroundColor: t.surface,
            paddingTop: 10,
            alignItems: "flex-end",
            paddingRight: 6,
            gap: 52,
            borderRightWidth: 2,
            borderRightColor: `${t.ink}4d`,
          }}
        >
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <View
              key={i}
              style={{ width: 30, height: 10, borderRadius: 5, backgroundColor: bone }}
            />
          ))}
        </View>
        {/* колонки с «блоками» */}
        {Array.from({ length: cols }).map((_, c) => (
          <View
            key={c}
            style={{
              flex: 1,
              backgroundColor: t.surface,
              borderLeftWidth: c === 0 ? 0 : 1,
              borderLeftColor: line,
            }}
          >
            {BONES[mode]
              .filter((b) => b.col === c)
              .map((b, i) => (
                <Animated.View
                  key={i}
                  style={[
                    {
                      position: "absolute",
                      left: mode === "week" ? 3 : 8,
                      right: mode === "week" ? 3 : 8,
                      top: b.top,
                      height: b.height,
                      borderRadius: 8,
                      backgroundColor: bone,
                    },
                    shimmer,
                  ]}
                />
              ))}
          </View>
        ))}
      </View>
    </View>
  );
}
