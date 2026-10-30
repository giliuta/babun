import { Text } from "react-native";
import type { BlockLayout } from "./block-layout";

// ЛЕСТНИЦА СОДЕРЖИМОГО: имя → время → услуга. Имя первым, потому что время
// уже названо рельсом слева и позицией блока, а имя не выводится ниоткуда.
// Кегль 13 — типографический пол продукта. Лестница только ДОПИСЫВАЕТСЯ вниз
// и никогда не переставляется: при щипке глаз не должен терять якорь.
//
// ПОЛОВИНКА ПИШЕТ, СКОЛЬКО ВЛЕЗЕТ. Две записи на одно время делят колонку
// Недели пополам (~16pt под текст); прежний порог 24pt оставлял их немыми
// цветными брусками. Теперь строка печатается от `MIN_TEXT_W` и режется
// краем: первые буквы имени и часы уже отличают одну половинку от другой.
//
// ОДИН КЕГЛЬ У ВСЕХ, ХВОСТ ТАЕТ. Подгонки кегля нет: короткие имена ужимались
// до 11pt, длинные — нет, и соседние блоки недели писали имя разным размером.
// Не влезающая строка режется по краю, а край прячет плёнка в цвет блока
// (`FadeTail`). У отменённой заливка полупрозрачная, плёнке спрятать нечем —
// ей многоточие.
const MIN_TEXT_W = 10;

export function BlockText({
  layout,
  label,
  service,
  lineH,
  overdue,
  nameColor,
  subColor,
}: {
  layout: BlockLayout;
  label: string;
  service: string | null;
  lineH: number;
  overdue: boolean;
  nameColor: string;
  subColor: string;
}) {
  const {
    textW,
    lastRow,
    dotReserve,
    cancelled,
    showTime,
    showService,
    timeText,
  } = layout;
  const cut = cancelled ? "tail" : "clip";
  // ОТМЕНЁННАЯ ЗАЧЁРКНУТА ЦЕЛИКОМ — имя, время и услуга: блок читается
  // «перечёркнутым», а не записью с одним зачёркнутым словом.
  const strike = cancelled ? "line-through" : "none";
  return (
    <>
      {textW >= MIN_TEXT_W ? (
        <Text
          style={{
            color: nameColor,
            fontSize: 13,
            lineHeight: lineH,
            fontWeight: "700",
            marginRight: lastRow === "name" ? dotReserve : 0,
            textDecorationLine: strike,
          }}
          numberOfLines={1}
          ellipsizeMode={cut}
          maxFontSizeMultiplier={1.3}
        >
          {label}
        </Text>
      ) : null}
      {showTime && textW >= MIN_TEXT_W ? (
        <Text
          style={{
            color: subColor,
            fontSize: 13,
            lineHeight: lineH,
            fontWeight: overdue ? "700" : "500",
            marginRight: lastRow === "time" ? dotReserve : 0,
            fontVariant: ["tabular-nums"],
            textDecorationLine: strike,
          }}
          numberOfLines={1}
          // Жирное время просрочки в узкой колонке не влезало и рубилось
          // многоточием («13:…») — теперь тает, как имя.
          ellipsizeMode={cut}
          maxFontSizeMultiplier={1.3}
        >
          {timeText}
        </Text>
      ) : null}
      {showService && textW >= MIN_TEXT_W ? (
        <Text
          style={{
            color: subColor,
            fontSize: 13,
            lineHeight: lineH,
            marginRight: lastRow === "service" ? dotReserve : 0,
            textDecorationLine: strike,
          }}
          numberOfLines={1}
          ellipsizeMode={cut}
          maxFontSizeMultiplier={1.3}
        >
          {service}
        </Text>
      ) : null}
    </>
  );
}
