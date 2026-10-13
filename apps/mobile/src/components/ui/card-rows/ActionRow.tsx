import { Pressable, Text } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { IconCircle } from "@/components/ui/IconCircle";
import { useThemeColors } from "@/theme/colors";

/** Ряд-действие над сущностью: «Сделать основным», «Удалить объект».
 *  Отличается от AddRow только смыслом (и тоном), поэтому вёрстка общая, а
 *  примитивы разные: «+ Добавить …» и «Удалить …» — не одно и то же, и
 *  закон строки требует различать их по имени, а не по цвету. */
export function ActionRow({
  label,
  tone = "accent",
  icon,
  separated,
  dimmed,
  onPress,
}: {
  label: string;
  tone?: "accent" | "danger";
  /** Значок в кружке слева — та же голова строки, что у двери `ChooseRow`
   *  (владелец 03.10: «Сделать основным» голым словом в блоке выпадало).
   *  Шеврона нет: строка делает, а не ведёт. */
  icon?: LucideIcon;
  separated?: boolean;
  dimmed?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={dimmed ? undefined : onPress}
      disabled={dimmed}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!dimmed }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        minHeight: 48,
        paddingHorizontal: 16,
        opacity: dimmed ? 0.4 : 1,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      {icon ? <IconCircle icon={icon} size={30} /> : null}
      <Text
        maxFontSizeMultiplier={1.2}
        style={{
          marginLeft: icon ? 12 : 0,
          // Со значком — размер двери `ChooseRow`: рядом они одной высоты.
          fontSize: icon ? 17 : 15,
          fontWeight: "600",
          color: tone === "danger" ? t.danger : t.accent,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
