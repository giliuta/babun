import { Text } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { nameShrinkFits, NAME_MIN_SCALE } from "@/features/calendar/block-geometry";
import type { BlockLayout } from "./block-layout";

// ЛЕСТНИЦА СОДЕРЖИМОГО: имя → время → услуга → адрес. Имя первым, потому
// что время уже названо рельсом слева и позицией блока, а имя не
// выводится ниоткуда. Кегль 13 — типографический пол продукта;
// девятка, которой неделя набиралась раньше, была нечитаема.
// Лестница только ДОПИСЫВАЕТСЯ вниз и никогда не переставляется:
// при щипке глаз не должен терять якорь.
export function BlockText({
  layout,
  apt,
  service,
  address,
  lineH,
  overdue,
  nameColor,
  subColor,
}: {
  layout: BlockLayout;
  apt: Appointment;
  service: string | null;
  address: string | null;
  lineH: number;
  overdue: boolean;
  nameColor: string;
  subColor: string;
}) {
  const {
    nameParts,
    textW,
    nameLineW,
    markReserve,
    deckMore,
    deckBadgeLow,
    deckBadgeW,
    lastRow,
    dotReserve,
    cancelled,
    showTime,
    showService,
    showAddress,
  } = layout;
  return (
    <>
      {textW >= 24 && nameLineW >= 24
        ? nameParts.map((part, i) => (
            <Text
              key={i}
              style={{
                color: nameColor,
                fontSize: 13,
                lineHeight: lineH,
                fontWeight: "700",
                marginRight: Math.max(
                  i === 0 ? markReserve : 0,
                  i === 0 && deckMore > 0 && !deckBadgeLow ? deckBadgeW : 0,
                  lastRow === "name" && i === nameParts.length - 1
                    ? dotReserve
                    : 0,
                ),
                textDecorationLine: cancelled ? "line-through" : "none",
              }}
              numberOfLines={1}
              // УЗКАЯ КАРТОЧКА: КОРОТКОЕ ИМЯ СЖИМАЕТСЯ, А НЕ РЕЖЕТСЯ
              // ПОПОЛАМ БУКВЫ. Обрезка по краю оставляла огрызок глифа
              // («Андреі», «Перерı»); кегль до 11 (0.85 от 13 — пол шрифта
              // продукта) вмещает «Андрей», «Встреча», «Перерыв» целиком.
              // Режим «clip» подгонку кегля в iOS выключает, поэтому при
              // сжатии — «tail» (текст и так влез). Длинное имя, которому
              // и 11pt мало, режется по краю, как раньше: «Конс» говорит
              // больше, чем «Ко…».
              ellipsizeMode={
                (i === 0 ? nameLineW : textW) >= 96 ||
                nameShrinkFits(part, i === 0 ? nameLineW : textW)
                  ? "tail"
                  : "clip"
              }
              adjustsFontSizeToFit={
                (i === 0 ? nameLineW : textW) < 96 &&
                nameShrinkFits(part, i === 0 ? nameLineW : textW)
              }
              minimumFontScale={NAME_MIN_SCALE}
              maxFontSizeMultiplier={1.3}
            >
              {part}
            </Text>
          ))
        : null}
      {showTime && textW >= 24 ? (
        <Text
          style={{
            color: subColor,
            fontSize: 13,
            lineHeight: lineH,
            fontWeight: overdue ? "700" : "500",
            marginRight: lastRow === "time" ? dotReserve : 0,
            fontVariant: ["tabular-nums"],
          }}
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
        >
          {textW >= 92 ? `${apt.time_start} – ${apt.time_end}` : apt.time_start}
        </Text>
      ) : null}
      {showService && textW >= 24 ? (
        <Text
          style={{
            color: subColor,
            fontSize: 13,
            lineHeight: lineH,
            marginRight: lastRow === "service" ? dotReserve : 0,
          }}
          numberOfLines={1}
          ellipsizeMode={textW < 96 ? "clip" : "tail"}
          maxFontSizeMultiplier={1.3}
        >
          {service}
        </Text>
      ) : null}
      {showAddress && textW >= 24 ? (
        <Text
          style={{
            color: subColor,
            fontSize: 13,
            lineHeight: lineH,
            marginRight: dotReserve,
          }}
          numberOfLines={1}
          ellipsizeMode={textW < 96 ? "clip" : "tail"}
          maxFontSizeMultiplier={1.3}
        >
          {address}
        </Text>
      ) : null}
    </>
  );
}
