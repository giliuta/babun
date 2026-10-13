import { View } from "react-native";
import Animated from "react-native-reanimated";
import { useThemeColors } from "@/theme/colors";
import { pct } from "@/features/calendar/grid-units";
import type { useUnstretchedStyle } from "@/features/calendar/zoom";

// ЛИНИЯ «СЕЙЧАС» ЛЕЖИТ ПОД ЗАПИСЯМИ, А НЕ ПОВЕРХ НИХ. Сверху она
// перечёркивала карточку ровно по строке времени — а зачёркивание в
// этом продукте уже занято и означает ОТМЕНЁННУЮ запись: работа, которая
// идёт прямо сейчас, выглядела снятой. Ничего при этом не теряется: где
// мы во времени, говорит красная капсула на рельсе часов — она живёт вне
// колонки и никогда ничем не закрыта, — а в пустых местах колонки линия
// видна как прежде. Рельс отвечает за время, сетка — за записи.
// `zIndex` блока на это не влиял: у обёртки он приходит анимированным
// стилем и до первого кадра не применяется.
export function NowLine({
  nowMin,
  totalMin,
  nowUnstretched,
}: {
  nowMin: number;
  totalMin: number;
  /** The column's `useUnstretchedStyle`: the line keeps its shape in a pinch. */
  nowUnstretched: ReturnType<typeof useUnstretchedStyle>;
}) {
  const t = useThemeColors();
  return (
    <Animated.View
      pointerEvents="none"
      style={[{
        position: "absolute",
        top: pct(nowMin, totalMin),
        // Ряд высотой в точку (9pt) центрирует линию на 4.5pt НИЖЕ своего
        // верха: линия «сейчас» стояла на 4–10 минут позже настоящего
        // времени — ниже капсулы на рельсе и края серого «прошлого»
        // (повторный аудит 03.10, видно на симуляторе).
        marginTop: -4.5,
        left: -4,
        right: 0,
        flexDirection: "row",
        alignItems: "center",
      }, nowUnstretched]}
    >
      <View style={{ height: 9, width: 9, borderRadius: 5, backgroundColor: t.danger }} />
      <View style={{ height: 1.5, flex: 1, backgroundColor: t.danger, opacity: 0.85 }} />
    </Animated.View>
  );
}
