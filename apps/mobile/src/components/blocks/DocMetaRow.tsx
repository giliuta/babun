import { Pressable, Text } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";

// ТОНКАЯ СТРОКА ПОД НАБОРОМ РЕКВИЗИТОВ — «Номер», «Язык» (владелец
// 2026-10-03: «первый блок — компактный, номер так сильно не выделять»;
// 04.10: язык бумаги — строкой под номером). Справка к реквизитам, а не
// главная цифра экрана: без плитки, 13-м кеглем, текст встаёт под имя набора
// (16 + плитка 28 + зазор 12). Нет `onPress` — нет шеврона.
export function DocMetaRow({
  label,
  value,
  onPress,
  accessibilityHint,
}: {
  label: string;
  value: string | null;
  onPress?: () => void;
  accessibilityHint?: string;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={`${label}, ${value ?? "загрузка"}`}
      accessibilityHint={onPress ? accessibilityHint : undefined}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 36,
        paddingLeft: 56,
        paddingRight: 16,
        paddingBottom: 8,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text maxFontSizeMultiplier={1.2} style={{ flex: 1, fontSize: 13, fontWeight: "500", color: t.caption }}>
        {label}
      </Text>
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={{
          fontSize: 13,
          fontWeight: "500",
          color: value ? t.sub : t.faint,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value ?? "…"}
      </Text>
      {onPress ? <ChevronRight color={t.chevron} size={14} strokeWidth={1.75} /> : null}
    </Pressable>
  );
}
