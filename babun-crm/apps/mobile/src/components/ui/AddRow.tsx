import { Pressable, Text, View } from "react-native";
import { Plus } from "lucide-react-native";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

// Стандарт «Добавить» (DS): в кабинете и справочниках создание живёт НЕ в
// нав-баре, а полноширинной строкой-кнопкой под последним элементом списка:
// слева плюс в accent-tinted круге 28, текст «Добавить счёт»/«Добавить
// услугу»/… цветом accent. В пустом состоянии CTA даёт EmptyState — AddRow
// тогда не рендерить, чтобы не дублировать.
export function AddRow({
  label,
  onPress,
  disabled,
}: {
  /** Полная подпись действия: «Добавить счёт», «Добавить услугу»… */
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-row items-center px-4"
      style={({ pressed }) => ({
        minHeight: 52,
        opacity: disabled ? 0.4 : 1,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <View
        style={{
          height: 28,
          width: 28,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 14,
          backgroundColor: t.dark
            ? "rgba(90,134,255,0.16)"
            : "rgba(44,91,224,0.10)",
        }}
      >
        <Plus color={t.accent} size={ICON.sm} />
      </View>
      <Text
        className="ml-3 text-base font-medium"
        style={{ color: t.accent }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}
