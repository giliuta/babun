import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useReduceMotion } from "@/lib/reduce-motion";
import { useThemeColors } from "@/theme/colors";

// ФОНОВОЕ ДООБНОВЛЕНИЕ — полоска, а не прыжок списка.
//
// Было: `RefreshControl refreshing={isRefetching}` — то есть при ЛЮБОМ
// дообновлении (react-query обновляет данные при возврате на экран) iOS
// показывал системную вертушку программно и СДВИГАЛ список вниз. Человек
// ничего не тянул, а список прыгал и застывал: «залагало» (владелец
// 2026-07-27).
//
// Здесь: данные на экране уже есть, работа идёт в фоне — поэтому индикация
// обязана быть НЕсдвигающей. Двухпунктовая полоса под шапкой: видно, что
// приложение живо, и ни одна строка не двинулась.

export function LoadingBar({ visible }: { visible: boolean }) {
  const t = useThemeColors();
  const reduced = useReduceMotion();
  const [width, setWidth] = useState(0);
  const x = useSharedValue(-0.45);

  useEffect(() => {
    if (!visible || reduced || width === 0) {
      cancelAnimation(x);
      return;
    }
    x.value = -0.45;
    x.value = withRepeat(
      withTiming(1, { duration: 1150, easing: Easing.inOut(Easing.quad) }),
      -1,
      false,
    );
    return () => cancelAnimation(x);
  }, [visible, reduced, width, x]);

  const segment = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value * width }],
  }));

  if (!visible) return null;

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        height: 2,
        overflow: "hidden",
        backgroundColor: `${t.accent}14`,
      }}
    >
      {reduced ? (
        // Уменьшение движения: полоса не едет, но и не притворяется прогрессом —
        // просто ровный кобальтовый след «идёт работа».
        <View style={{ height: 2, backgroundColor: `${t.accent}59` }} />
      ) : (
        <Animated.View
          style={[
            {
              width: "45%",
              height: 2,
              borderRadius: 1,
              backgroundColor: t.accent,
            },
            segment,
          ]}
        />
      )}
    </View>
  );
}
