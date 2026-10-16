import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { RecordMark } from "@/components/ui/RecordMark";
import { useThemeColors } from "@/theme/colors";

/** СТРОКА ЦВЕТА — КУСОЧЕК КАЛЕНДАРЯ И ПРАВИЛО. Слева образец блока записи
 *  (`RecordMark`, тот же рецепт, что на сетке: плотная заливка, контур, блик)
 *  — так запись и ляжет в календарь. Справа случай и одной
 *  строкой, когда он срабатывает. `hue = null` — «Без цвета»: пустой контур,
 *  такая запись красится обычным цветом. */
export function ColorRow({
  title,
  when,
  hue,
  separated,
  onPress,
}: {
  title: string;
  when: string;
  hue: string | null;
  separated: boolean;
  /** Нет — «Только видит»: строка показывает цвет, без двери. */
  onPress?: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={`${title}. ${when}${hue ? "" : ". Без цвета"}`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        minHeight: 68,
        paddingLeft: 16,
        paddingRight: 12,
        paddingVertical: 10,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <RecordMark hue={hue} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 16, fontWeight: "600", color: t.ink }}
        >
          {title}
        </Text>
        <Text
          numberOfLines={2}
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 13, color: t.sub, marginTop: 2 }}
        >
          {hue ? when : `${when} · без цвета`}
        </Text>
      </View>
      {onPress ? <ChevronRight size={18} color={t.faint} strokeWidth={2.2} /> : null}
    </Pressable>
  );
}
