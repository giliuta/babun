import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useThemeColors } from "@/theme/colors";
import { HEADER_H, RAIL_W } from "@/features/calendar/DayView";

// Скелет сетки на первую загрузку: настоящий каркас (шапка + рельс +
// «блоки» на реалистичных позициях) с мягким пульсом — «это мой календарь,
// сейчас наполнится», а не безликий спиннер. При Reduce Motion пульс
// выключен (статичные кости).
export function CalendarSkeleton() {
  const t = useThemeColors();
  const reduced = useReducedMotion();
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
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <View
            style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: bone }}
          />
        </View>
      </View>
      <View style={{ flex: 1, flexDirection: "row" }}>
        {/* рельс часов */}
        <View
          style={{
            width: RAIL_W,
            backgroundColor: t.surface,
            paddingTop: 10,
            alignItems: "flex-end",
            paddingRight: 6,
            gap: 52,
          }}
        >
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <View
              key={i}
              style={{ width: 30, height: 10, borderRadius: 5, backgroundColor: bone }}
            />
          ))}
        </View>
        {/* колонка с «блоками» */}
        <View
          style={{
            flex: 1,
            backgroundColor: t.surface,
            borderLeftWidth: 1,
            borderLeftColor: line,
          }}
        >
          {[
            { top: "12%", height: "10%" },
            { top: "30%", height: "7%" },
            { top: "52%", height: "16%" },
          ].map((b, i) => (
            <Animated.View
              key={i}
              style={[
                {
                  position: "absolute",
                  left: 8,
                  right: 8,
                  top: b.top as `${number}%`,
                  height: b.height as `${number}%`,
                  borderRadius: 8,
                  backgroundColor: bone,
                },
                shimmer,
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
