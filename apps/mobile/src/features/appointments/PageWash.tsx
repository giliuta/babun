import { useId } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

// ПОДСВЕТКА СТРАНИЦЫ ЦВЕТОМ ЗАПИСИ (владелец 2026-09-07: «не прям жёлтая…
// плавная, не сильная, не ядовитая — красивая подсветка»). Сплошная заливка
// на 38 % красила всю страницу в цвет; здесь цвет стоит у шапки и мягко
// сходит на нет к середине экрана, дальше — обычный холст. Рисуется одним
// SVG-градиентом за содержимым: касания не ловит, раскладку не меняет.

export function PageWash({
  color,
  /** Сила у самой шапки, 0…1 — в холст подмешивается ровно столько цвета. */
  strength = 0.22,
  /** До какой высоты доходит подсветка. */
  height = 560,
}: {
  color: string;
  strength?: number;
  height?: number;
}) {
  const id = `wash-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", left: 0, right: 0, top: 0, height }}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={strength} />
            <Stop offset="0.55" stopColor={color} stopOpacity={strength * 0.35} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
