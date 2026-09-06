import { Pressable, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import { haptics } from "@/lib/haptics";

/**
 * ПЛАШКА РЕЖИМА над сеткой — «Записать: Иван» и «Перенести: Иван». Пока она
 * висит, свободное время подсвечено зелёным, а тап по кубику делает дело
 * режима (форма записи / переезд записи). Крестик выходит из режима, оставляя
 * календарь там же, где стоите. Одна плашка на оба режима: зелень одна, и
 * человек должен узнавать её с полувзгляда.
 */
export function ModePlaque({
  title,
  subtitle,
  exitLabel,
  onExit,
}: {
  title: string;
  subtitle: string;
  exitLabel: string;
  onExit: () => void;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginHorizontal: 12,
        marginTop: 8,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: t.radius.input,
        backgroundColor: `${t.success}1f`,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
        >
          {title}
        </Text>
        <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 13, color: t.sub }}>
          {subtitle}
        </Text>
      </View>
      <Pressable
        onPress={() => {
          haptics.tap();
          onExit();
        }}
        accessibilityRole="button"
        accessibilityLabel={exitLabel}
        hitSlop={10}
        style={({ pressed }) => ({
          width: 32,
          height: 32,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.5 : 1,
        })}
      >
        <X color={t.sub} size={18} strokeWidth={2.4} />
      </Pressable>
    </View>
  );
}
