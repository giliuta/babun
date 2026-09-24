import type { ReactNode } from "react";
import { View } from "react-native";
import {
  BLOCK_TEXT,
  blockContour,
  blockSolid,
  CANCELLED_BORDER,
  CANCELLED_EDGE,
} from "@/components/ui/color-contrast";
import { useThemeColors } from "@/theme/colors";

// ЗНАК ЗАПИСИ — МИНИАТЮРА БЛОКА КАЛЕНДАРЯ, А НЕ ОБРАЗЕЦ ПИГМЕНТА.
//
// Здесь живёт весь облик блока, который зависит от цвета записи: плотная
// заливка (`blockSolid` — цвет, затемнённый по светлоте до читаемого белого
// имени; владелец 2026-09-24, вариант 7), радиус и разомкнутый контур у
// отменённой. Текст внутри красит `recordMarkText` — тот же, что в сетке. Добавили блоку новый слой, зависящий от
// цвета, — добавьте его и сюда, иначе настройка снова начнёт врать.
//
// ПОЧЕМУ КРУЖОК ПИГМЕНТА НЕ ГОДИЛСЯ. Он показывал единственный канал, которого
// в календаре нет ни разу — сырой цвет на 100 %, — и прятал оба, которые там
// есть. На Ванильном #FFF0BC он давал к белой карточке настроек 1.14 : 1, то
// есть образца попросту не было видно; кант того же цвета даёт 4.74 : 1.
// Человек выбирал по кружку, получал в календаре другую вещь и шёл заводить
// тестовую запись — ровно из-за этого расхождения.
//
// Общий у сетки и у знака РЕЦЕПТ, а не компонент: блок сетки — это
// `Animated.View` с жестами, `interpolateColor` и процентной геометрией,
// переиспользовать его нельзя. От расхождения защищают одно место рецепта
// (`blockSolid`) и гейт в `color-contrast.test.ts`.
//
// 28pt — НЕ УПРОЩЕНИЕ, А ЧЕСТНАЯ ШИРИНА. По арифметике блока при ширине 28
// textW = 28 − 2·pad(4) − 2 = 18 < 24, то есть настоящий блок такой ширины
// текста тоже не печатает, а угловой знак не рисуется при ширине < 40. Реальная
// колонка недели с двумя наложенными записями даёт 21pt.
export function RecordMark({
  hue,
  cancelled = false,
  size = 28,
  full = false,
  children,
}: {
  /** Цвет записи. `null` — «не красить»: пустой контур волосяной линией. */
  hue: string | null;
  cancelled?: boolean;
  size?: number;
  /** Во всю ширину родителя — образец в натуральную величину, с текстом
   *  внутри. Тот же рецепт, только большой: настройка обязана показывать
   *  ровно то, что нарисует сетка. */
  full?: boolean;
  children?: ReactNode;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        width: full ? undefined : size,
        height: size,
        justifyContent: "center",
        paddingHorizontal: full ? 10 : 0,
        // Строка ленты выровнена по верху, строка настроек — по центру: без
        // этого знак уехал бы к кромке.
        alignSelf: full ? "stretch" : "center",
        borderRadius: t.radius.card,
        borderCurve: "continuous",
        // ОТМЕНЁННАЯ ТЕРЯЕТ ЦВЕТ ЗАПИСИ, как и её блок в сетке.
        backgroundColor: cancelled
          ? `${t.ink}14`
          : hue
            ? blockSolid(hue)
            : "transparent",
        borderWidth: 1,
        borderColor: cancelled
          ? CANCELLED_EDGE
          : hue
            ? blockContour(hue)
            : t.separator,
        borderStyle: cancelled ? CANCELLED_BORDER : "solid",
        overflow: "hidden",
      }}
    >
      {/* Тот же блик, что у блока в сетке (вариант 5): образец не имеет
          права выглядеть площе, чем то, что он обещает. */}
      {hue && !cancelled
        ? ([
            ["18%", 0.07],
            ["34%", 0.06],
            ["52%", 0.05],
          ] as const).map(([h, a]) => (
            <View
              key={h}
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: h,
                backgroundColor: `rgba(255,255,255,${a})`,
              }}
            />
          ))
        : null}
      {children}
    </View>
  );
}

/** Цвет текста внутри знака: белый на плотной заливке, чернила там, где
 *  заливки нет («не красить») или запись отменена. */
export function recordMarkText(
  hue: string | null,
  ink: string,
  cancelled = false,
): string {
  return hue && !cancelled ? BLOCK_TEXT : ink;
}

export default RecordMark;
