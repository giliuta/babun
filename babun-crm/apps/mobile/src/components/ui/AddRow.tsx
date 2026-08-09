import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

// Стандарт «Добавить» (DS): в кабинете и справочниках создание живёт НЕ в
// нав-баре, а полноширинной строкой-кнопкой под последним элементом списка:
// явная текстовая команда «Добавить счёт»/«Добавить услугу» и шеврон.
// Универсального глифа «плюс» в приложении нет. В пустом состоянии CTA даёт EmptyState — AddRow
// тогда не рендерить, чтобы не дублировать.
export function AddRow({
  label,
  onPress,
  disabled,
  separated,
}: {
  /** Полная подпись действия: «Добавить счёт», «Добавить услугу»… */
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Верхняя линия — когда строка идёт под списком, а не одна в группе. */
  separated?: boolean;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      className="flex-row items-center px-4"
      style={({ pressed }) => ({
        minHeight: 52,
        opacity: disabled ? 0.4 : 1,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <Text
        maxFontSizeMultiplier={1.3}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        className="flex-1 text-base font-medium"
        style={{ color: t.accent }}
        numberOfLines={1}
      >
        {label}
      </Text>
      <View className="ml-3 h-7 w-7 items-center justify-center">
        <ChevronRight color={t.chevron} size={ICON.sm} />
      </View>
    </Pressable>
  );
}
