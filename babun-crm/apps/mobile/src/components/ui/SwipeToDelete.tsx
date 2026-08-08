import { useCallback, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// СМАХНУТЬ ВЛЕВО → «УДАЛИТЬ» (владелец 2026-08-06: «можно смахнуть влево и
// там можно будет нажать удалить»). Тот же жест, что в Почте и Сообщениях —
// объяснять его не нужно.
//
// Почему не крестик в строке: 32pt кнопка живёт в строке ВСЕГДА и отбирает
// место у содержания, а её зона смыкается с соседними кнопками (у номеров
// это уже приводило к ошибочным удалениям, аудит 2026-07-27). Свайп ничего
// не занимает и требует намеренного движения.
//
// Кнопка не удаляет молча: `onDelete` у вызывающей стороны спрашивает
// подтверждение — объект с историей стирается насовсем.

const ACTION_W = 96;
/** Дальше этого порога палец = «открыть», ближе = «вернуть». */
const OPEN_AT = ACTION_W * 0.5;

export function SwipeToDelete({
  onDelete,
  label = "Удалить",
  accessibilityLabel,
  children,
}: {
  onDelete: () => void;
  label?: string;
  /** Озвучка действия: «Удалить объект Вилла». */
  accessibilityLabel?: string;
  children: ReactNode;
}) {
  const t = useThemeColors();
  const x = useSharedValue(0);
  const opened = useSharedValue(false);

  const close = useCallback(() => {
    x.value = withTiming(0, { duration: 140 });
    opened.value = false;
  }, [opened, x]);

  const pan = Gesture.Pan()
    // По горизонтали: вертикальный скролл списка должен побеждать.
    .activeOffsetX([-12, 12])
    .failOffsetY([-8, 8])
    .onChange((e) => {
      const base = opened.value ? -ACTION_W : 0;
      // Вправо дальше нуля не тянем — там ничего нет.
      x.value = Math.min(0, Math.max(base + e.translationX, -ACTION_W - 24));
    })
    .onEnd(() => {
      const shouldOpen = x.value < -OPEN_AT;
      opened.value = shouldOpen;
      x.value = withSpring(shouldOpen ? -ACTION_W : 0, {
        damping: 20,
        stiffness: 220,
      });
      if (shouldOpen) runOnJS(bump)();
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }));

  return (
    <View>
      {/* Красная подложка живёт ПОД строкой и видна ровно настолько,
          насколько её сдвинули. */}
      <View
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: ACTION_W,
          alignItems: "stretch",
        }}
      >
        <Pressable
          onPress={() => {
            close();
            onDelete();
          }}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? label}
          style={({ pressed }) => ({
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: t.danger,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 15, fontWeight: "600", color: "#fff" }}
          >
            {label}
          </Text>
        </Pressable>
      </View>

      <GestureDetector gesture={pan}>
        <Animated.View style={[rowStyle, { backgroundColor: t.surface }]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** Отдельная функция: в worklet нельзя ссылаться на метод объекта. */
function bump(): void {
  haptics.impact();
}

export default SwipeToDelete;
