import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { ICON } from "./tokens";
import { useThemeColors } from "@/theme/colors";

// Строка настройки с действующим значением справа (диалект iOS Settings).
//
// `muted` — центральная идея настроек календаря: значение может быть
// УНАСЛЕДОВАНО. Тогда строка показывает не пустоту и не выключенный тумблер
// (оба врут — см. `hide_cancelled: v || null`), а живое значение серым:
// «Как везде · 09:00». Своё — чёрным. Смысл несёт текст, цвет только
// усиливает: серое = «поедет за общей настройкой».
//
// Текст значения целиком собирает вызывающий: наследование звучит по-разному
// («Как везде · 09:00», «Как шаг сетки · 30 мин»), и примитив не вправе
// диктовать формулировку.
export function ValueRow({
  label,
  value,
  muted,
  onPress,
}: {
  label: string;
  /** Действующее значение — всегда конкретное, никогда не плейсхолдер. */
  value: string;
  /** Значение унаследовано, своего у объекта нет. */
  muted?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      {/* Подпись важнее значения: она сжимается последней. У Text в RN
          flexShrink по умолчанию 0 — без явного shrink у значения оно
          забирало всю свою ширину, и обрезалась именно ПОДПИСЬ
          («Длительность по…», «Отменённые зап…»). */}
      <Text
        maxFontSizeMultiplier={1.3}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={{ flexShrink: 0, fontSize: 16, color: t.ink }}
        numberOfLines={1}
      >
        {label}
      </Text>
      <View style={{ flex: 1, minWidth: 8 }} />
      <Text
        maxFontSizeMultiplier={1.3}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        style={{
          flexShrink: 1,
          fontSize: 16,
          color: muted ? t.faint : t.ink,
          marginRight: 6,
        }}
        numberOfLines={1}
      >
        {value}
      </Text>
      <ChevronRight color={t.chevron} size={ICON.sm} />
    </Pressable>
  );
}
