import { Pressable, View } from "react-native";
import { pad2 } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import { haptics } from "@/lib/haptics";
import { HALF_MARK_MIN_H } from "./constants";
import { slotTimeAt } from "./slot-time";
import type { FreeSlotRange } from "./types";

/** One flex cell per hour: the hour line and the create-slot tap target. */
export function HourCells({
  hours,
  hourH,
  gridLine,
  dateYmd,
  onCreateAt,
  onSlotLongPress,
  freeSlots,
}: {
  hours: number[];
  hourH: number;
  gridLine: string;
  dateYmd: string;
  onCreateAt?: (dateYmd: string, timeStart: string) => void;
  onSlotLongPress?: (dateYmd: string, timeStart: string) => void;
  freeSlots?: readonly FreeSlotRange[];
}) {
  const t = useThemeColors();
  /** Время под пальцем в ячейке часа, с шагом TAP_STEP. */
  const slotTime = (hour: number, locationY: number) =>
    slotTimeAt(hour, locationY, hourH);
  const onSlotPress = (hour: number, locationY: number) => {
    if (!onCreateAt) return;
    // Касание свободного времени ощущается рукой (владелец 04.10).
    haptics.tap();
    onCreateAt(dateYmd, slotTime(hour, locationY));
  };

  return (
    <>
      {/* hour cells: gridline + create-slot in one flex node. Часовые ряды
          чистые (Bumpix); получасовая волосяная линия появляется только на
          достаточном зуме (HALF_MARK_MIN_H) — иначе частокол. */}
      {hours.map((h) => {
        const halfHourLine = hourH >= HALF_MARK_MIN_H ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: "50%",
              left: 0,
              right: 0,
              height: 1,
              backgroundColor: `${t.ink}14`,
            }}
          />
        ) : null;
        const style = {
          flex: 1,
          borderTopWidth: 1,
          borderTopColor: gridLine,
        } as const;

        return onCreateAt ? (
          <Pressable
            key={h}
            onPress={(e) => onSlotPress(h, e?.nativeEvent?.locationY ?? 0)}
            // ДОЛГОЕ НАЖАТИЕ ПО СВОБОДНОМУ ВРЕМЕНИ (владелец 2026-09-24:
            // «перерыв — интересная идея»): разметка дня без формы записи.
            onLongPress={
              onSlotLongPress
                ? (e) =>
                    onSlotLongPress(
                      dateYmd,
                      slotTime(h, e?.nativeEvent?.locationY ?? 0),
                    )
                : undefined
            }
            delayLongPress={400}
            accessibilityRole="button"
            accessibilityLabel={`Создать запись в ${pad2(h)}:00`}
            // В режиме подбора выбор — это кубики. Часы остаются кликабельными
            // (родитель ответит «выберите зелёное»), но в озвучке молчат:
            // иначе VoiceOver сначала читает дюжину одинаковых «Создать
            // запись в HH:00» и только потом доходит до свободного времени.
            accessibilityElementsHidden={freeSlots !== undefined}
            importantForAccessibility={
              freeSlots !== undefined ? "no-hide-descendants" : "auto"
            }
            style={style}
          >
            {halfHourLine}
          </Pressable>
        ) : (
          <View key={h} pointerEvents="none" style={style}>
            {halfHourLine}
          </View>
        );
      })}
      {/* closing line of the last hour */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 1,
          backgroundColor: gridLine,
        }}
      />
    </>
  );
}
