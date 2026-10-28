import { Pressable, Text, View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

/** Строка периода — сплит Финансов: имя открывает пресеты, даты — колёса. */
export function PeriodSplitRow({
  periodName,
  datesLabel,
  hasPeriod,
  onOpenPresets,
  onOpenWheels,
}: {
  periodName: string;
  datesLabel: string;
  /** Период выбран (не «Всё время»). */
  hasPeriod: boolean;
  onOpenPresets: () => void;
  onOpenWheels: () => void;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "stretch",
        minHeight: 44,
        borderRadius: t.radius.card,
        backgroundColor: t.rowFill,
      }}
    >
      <Pressable
        onPress={() => {
          haptics.tap();
          onOpenPresets();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Период: ${periodName}`}
        accessibilityHint="Открывает список периодов"
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 16,
          paddingRight: 8,
          gap: 4,
          borderTopLeftRadius: t.radius.card,
          borderBottomLeftRadius: t.radius.card,
          backgroundColor: pressed ? t.rowFillPressed : "transparent",
        })}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
        >
          {periodName}
        </Text>
        <ChevronDown color={t.chevron} size={14} strokeWidth={2.6} />
      </Pressable>
      <View
        style={{
          width: 1,
          alignSelf: "center",
          height: 20,
          backgroundColor: "rgba(11,18,32,0.10)",
        }}
      />
      <Pressable
        onPress={() => {
          haptics.tap();
          onOpenWheels();
        }}
        accessibilityRole="button"
        accessibilityLabel={hasPeriod ? `Даты: ${datesLabel}` : "Даты не заданы"}
        accessibilityHint="Открывает выбор диапазона"
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 12,
          paddingRight: 16,
          borderTopRightRadius: t.radius.card,
          borderBottomRightRadius: t.radius.card,
          backgroundColor: pressed ? t.rowFillPressed : "transparent",
        })}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
          style={{
            fontSize: 15,
            // В покое даты не спорят с именем периода.
            fontWeight: hasPeriod ? "700" : "500",
            color: hasPeriod ? t.ink : t.faint,
            fontVariant: ["tabular-nums"],
          }}
        >
          {datesLabel}
        </Text>
      </Pressable>
    </View>
  );
}
