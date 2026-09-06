import { View } from "react-native";
import {
  BLOCK_FILL,
  CANCELLED_BORDER,
  CANCELLED_EDGE,
  edgeColor,
  fillRgba,
} from "@/components/ui/color-contrast";
import { useThemeColors } from "@/theme/colors";

// ЗНАК ЗАПИСИ — МИНИАТЮРА БЛОКА КАЛЕНДАРЯ, А НЕ ОБРАЗЕЦ ПИГМЕНТА.
//
// Здесь живёт весь облик блока, который зависит от цвета записи: заливка 18 %,
// кант в полную силу (`edgeColor` затемняет цвет ровно до порога 3 : 1), радиус
// 10 и разомкнутый контур у отменённой. Добавили блоку новый слой, зависящий от
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
// переиспользовать его нельзя. От расхождения защищают одно место для альфы
// (`BLOCK_FILL`) и гейт в `color-contrast.test.ts`.
//
// 28pt — НЕ УПРОЩЕНИЕ, А ЧЕСТНАЯ ШИРИНА. По арифметике блока при ширине 28
// textW = 28 − 2·pad(4) − 2 = 18 < 24, то есть настоящий блок такой ширины
// текста тоже не печатает, а угловой знак не рисуется при ширине < 40. Реальная
// колонка недели с двумя наложенными записями даёт 21pt.
export function RecordMark({
  hue,
  cancelled = false,
  size = 28,
}: {
  /** Цвет записи. `null` — «не красить»: пустой контур волосяной линией. */
  hue: string | null;
  cancelled?: boolean;
  size?: number;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        width: size,
        height: size,
        // Строка ленты выровнена по верху, строка настроек — по центру: без
        // этого знак уехал бы к кромке.
        alignSelf: "center",
        borderRadius: t.radius.card,
        borderCurve: "continuous",
        // ОТМЕНЁННАЯ ТЕРЯЕТ ЦВЕТ ЗАПИСИ, как и её блок в сетке.
        backgroundColor: cancelled
          ? `${t.ink}14`
          : hue
            ? fillRgba(hue, BLOCK_FILL)
            : "transparent",
        borderWidth: 1,
        borderColor: cancelled
          ? CANCELLED_EDGE
          : hue
            ? edgeColor(hue)
            : t.separator,
        borderStyle: cancelled ? CANCELLED_BORDER : "solid",
      }}
    />
  );
}

export default RecordMark;
