import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated } from "react-native";
import { useThemeColors } from "@/theme/colors";

// «✓ Сохранено» в правом слоте шапки — тихий отклик instant-commit'а.
// Кнопки «Сохранить» на экранах настроек нет (каждый контрол коммитит сам),
// а тост на каждый тап был бы шумом: он перекрывает контент сверху ровно там,
// куда человек смотрит. Индикатор гаснет сам через ~1.5 с; каждый новый tick
// переустанавливает таймер, поэтому серия быстрых правок держит одну надпись,
// а не мигает.
export function SavedIndicator({ tick }: { tick: number }) {
  const t = useThemeColors();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!tick) return;
    opacity.setValue(1);
    // Индикатор не ловит pointerEvents и гаснет сам — без явного анонса
    // VoiceOver не узнал бы, что настройка сохранилась.
    AccessibilityInfo.announceForAccessibility("Сохранено");
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }, 1500);
    return () => clearTimeout(timer);
  }, [tick, opacity]);
  if (!tick) return null;
  return (
    <Animated.Text
      style={{ opacity, fontSize: 13, fontWeight: "600", color: t.success }}
    >
      ✓ Сохранено
    </Animated.Text>
  );
}
