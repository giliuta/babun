import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import { ICON } from "../tokens";

/** Строка-дверь: ярлык · значение · шеврон. Шеврон — единственный признак,
 *  отличающий «уводит» от «правится на месте», когда обе строки выглядят
 *  одинаково. `loud` — единственная громкая поверхность экрана («Записать»). */
export function NavRow({
  label,
  value,
  accessory,
  placeholder,
  valueColor,
  separated,
  loud,
  dimmed,
  onPress,
}: {
  label: string;
  value?: string | null;
  /** Ответ, который показывает СЕБЯ, а не своё имя: точка цвета, глиф значка.
   *  Называть цвет словом лишнее:
   *  «Голубой» не нужен. Стоит вместо текста значения; подпись строки при этом
   *  остаётся единственным словом, и её же читает VoiceOver. */
  accessory?: ReactNode;
  placeholder?: string;
  valueColor?: string;
  separated?: boolean;
  loud?: boolean;
  dimmed?: boolean;
  /** Без обработчика строка становится ПОКАЗАНИЕМ, а не дверью: тот же ритм
   *  и типографика, но без шеврона, нажатия и роли кнопки (лента истории
   *  печатает так заметки — внутрь них проваливаться некуда). */
  onPress?: () => void;
}) {
  const t = useThemeColors();
  const shown = value || placeholder || "";
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={shown ? `${label}: ${shown}` : label}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        minHeight: loud ? 52 : 48,
        paddingHorizontal: 16,
        gap: 12,
        opacity: dimmed ? 0.5 : 1,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: loud
          ? t.accent
          : pressed
            ? t.pressed
            : "transparent",
      })}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        // Ярлык уступает место значению: адрес объекта длиннее подписи
        // «Дом», и без сжатия ярлык забирал бы ширину у того, ради чего
        // строку и открывают.
        style={{
          flexShrink: 1,
          fontSize: loud ? 17 : 15,
          fontWeight: "600",
          color: loud ? t.onAccent : t.ink,
        }}
      >
        {label}
      </Text>
      <View style={{ flex: 1, alignItems: "flex-end" }}>
        {accessory ?? (shown ? (
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{
              fontSize: 15,
              fontWeight: "500",
              color: loud
                ? t.onAccent
                : value
                  ? (valueColor ?? t.ink)
                  : t.faint,
            }}
          >
            {shown}
          </Text>
        ) : null)}
      </View>
      {onPress ? (
        <ChevronRight
          color={loud ? t.onAccent : t.chevron}
          size={ICON.chevron}
        />
      ) : null}
    </Pressable>
  );
}
