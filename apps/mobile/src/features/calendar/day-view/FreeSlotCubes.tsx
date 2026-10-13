import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";
import { minToHM, pct } from "@/features/calendar/grid-units";
import type { FreeSlotRange } from "./types";

/** Green «free time» cubes of the slot-pick mode — each one a button. */
export function FreeSlotCubes({
  freeSlots,
  dateYmd,
  winStartMin,
  winEndMin,
  hourH,
  fontScale,
  onCreateAt,
}: {
  freeSlots?: readonly FreeSlotRange[];
  dateYmd: string;
  winStartMin: number;
  winEndMin: number;
  hourH: number;
  fontScale: number;
  onCreateAt?: (dateYmd: string, timeStart: string) => void;
}) {
  const t = useThemeColors();
  return (
    <>
      {/* СВОБОДНОЕ ВРЕМЯ (режим «Записать»). Кубики лежат в самой сетке, а не
          на отдельном экране: диспетчер видит, ЧЕМ занят день вокруг
          свободного окна, и выбирает осознанно.
          Каждый слот — ОТДЕЛЬНАЯ плашка с зазором: сплошная заливка читалась
          как «весь день свободен», а не как выбор из кубиков.
          КУБИК — КНОПКА, и стоит ПОСЛЕ часовых ячеек: под ними он был
          картинкой, тап проваливался в сетку и приезжал округлённым по 15
          минут — с кубика «16:00» уходило 16:15. Кнопка отдаёт ровно своё
          начало. Записи рисуются ниже по дереву и остаются сверху. */}
      {freeSlots?.map((slot) => {
        if (!(slot.endMin > winStartMin && slot.startMin < winEndMin)) {
          return null;
        }
        const from = Math.max(slot.startMin, winStartMin);
        const to = Math.min(slot.endMin, winEndMin);
        const totalMin = winEndMin - winStartMin;
        // Высота кубика в пикселях — по ней решаем, влезет ли подпись.
        const slotH = ((to - from) / 60) * hourH;
        const time = minToHM(slot.startMin);
        return (
          <Pressable
            key={`free-${slot.startMin}`}
            onPress={
              onCreateAt ? () => onCreateAt(dateYmd, time) : undefined
            }
            accessibilityRole="button"
            accessibilityLabel={`Свободно в ${time}`}
            style={{
              position: "absolute",
              left: 2,
              right: 2,
              top: pct(from - winStartMin, totalMin),
              height: pct(to - from, totalMin),
              paddingVertical: 1,
            }}
          >
            {({ pressed }) => (
              <View
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: t.radius.input,
                  backgroundColor: `${t.success}${pressed ? "4d" : "33"}`,
                  // Рамка — чтобы кубик оставался ФИГУРОЙ: одной заливкой в
                  // 20% он даёт 1.33:1 к белой колонке, а при малой высоте,
                  // когда подпись не влезает, исчезает для слабовидящего.
                  borderWidth: 1,
                  borderColor: `${t.success}66`,
                }}
              >
                {/* ВРЕМЯ НА КУБИКЕ (владелец 2026-08-07). Часы слева отвечают
                    за всю сетку, но при выборе смотрят на кубик, а не на
                    рельс: подпись прямо на плашке снимает пересчёт глазами.
                    Не рисуем, когда кубик ниже 16pt — обрезанная цифра хуже
                    отсутствующей. */}
                {slotH >= 16 * Math.min(fontScale, 1.2) ? (
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.2}
                    style={{
                      fontSize: 11,
                      fontWeight: "600",
                      color: t.successInk,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {time}
                  </Text>
                ) : null}
              </View>
            )}
          </Pressable>
        );
      })}
    </>
  );
}
