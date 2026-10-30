import { Pressable, Text, View } from "react-native";
import { BLOCK_TEXT } from "@/components/ui/color-contrast";
import { BLOCK_RADIUS } from "@/components/ui/RecordMark";
import { haptics } from "@/lib/haptics";
import { moreFrame, type MoreCard } from "@/features/calendar/layout";
import { GAP, pct } from "@/features/calendar/grid-units";
import type { BlockColors } from "@/features/calendar/status-colors";

// «+N» — ЗАПИСИ, КОТОРЫМ НЕ ХВАТИЛО ДОРОЖКИ (`fitLanes`). Карточка того же
// вида, что запись: та же форма, тот же отступ снизу, заливка — цветом первой
// из спрятанных, чтобы дорожка не выпадала из сетки серым пятном. Красного
// нет: записи на одно время — обычный день, а не авария. Тап раскрывает их
// списком.
export function MoreBlock({
  card,
  laneW,
  winStart,
  winEnd,
  lineH,
  colors,
  label,
  onOpen,
}: {
  card: MoreCard;
  laneW: number;
  winStart: number;
  winEnd: number;
  lineH: number;
  colors: BlockColors;
  /** Озвучка: время и сколько записей, как в шапке списка. */
  label: string;
  onOpen: (card: MoreCard) => void;
}) {
  const frame = moreFrame(card, laneW, GAP);
  const visStart = Math.max(card.startMin, winStart);
  const visEnd = Math.min(card.endMin, winEnd);
  if (visEnd <= visStart) return null;
  const totalMin = winEnd - winStart;
  return (
    <View
      style={{
        position: "absolute",
        left: frame.left,
        width: frame.width,
        top: pct(visStart - winStart, totalMin),
        height: pct(visEnd - visStart, totalMin),
        minHeight: 24,
        zIndex: 1 + frame.z,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => {
          haptics.tap();
          onOpen(card);
        }}
        style={({ pressed }) => ({
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 2,
          paddingHorizontal: frame.width >= 30 ? 3 : 2,
          paddingTop: 2,
          borderRadius: BLOCK_RADIUS,
          borderCurve: "continuous",
          overflow: "hidden",
          backgroundColor: pressed ? colors.pressed : colors.solid,
        })}
      >
        <Text
          style={{
            color: BLOCK_TEXT,
            fontSize: 13,
            lineHeight: lineH,
            fontWeight: "700",
            fontVariant: ["tabular-nums"],
          }}
          numberOfLines={1}
          ellipsizeMode="clip"
          maxFontSizeMultiplier={1.3}
        >
          +{card.members.length}
        </Text>
      </Pressable>
    </View>
  );
}
