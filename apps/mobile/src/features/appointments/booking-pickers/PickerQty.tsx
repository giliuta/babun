import { Pressable, Text, View } from "react-native";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

/** КОЛИЧЕСТВО ВЫБРАННОЙ УСЛУГИ — «− 3 +» прямо в строке списка. Пилюля, а не
 *  три кнопки: один орган с числом посередине. Нажатия по ней НЕ доходят до
 *  строки — вложенный `Pressable` забирает касание себе, поэтому подкрутить
 *  количество можно, не сняв услугу.
 *
 *  «−» на единице ПРИГАШЕН: снять услугу — это тап по строке, и два разных
 *  жеста для одного действия только сбивают. */
export function PickerQty({
  name,
  qty,
  onChange,
}: {
  name: string;
  qty: number;
  onChange: (next: number) => void;
}) {
  const t = useThemeColors();
  const step = (delta: number, label: string, sign: string, off?: boolean) => (
    <Pressable
      onPress={() => {
        if (off) return;
        haptics.tap();
        onChange(qty + delta);
      }}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off }}
      style={({ pressed }) => ({
        width: 32,
        height: 36,
        alignItems: "center",
        justifyContent: "center",
        opacity: off ? 0.3 : pressed ? 0.5 : 1,
      })}
    >
      <Text
        maxFontSizeMultiplier={1}
        style={{ fontSize: 18, fontWeight: "600", color: t.ink, lineHeight: 22 }}
      >
        {sign}
      </Text>
    </Pressable>
  );
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        width: 92,
        height: 36,
        borderRadius: t.radius.input,
        backgroundColor: t.surface,
      }}
    >
      {step(-1, `Убавить: ${name}`, "\u2212", qty <= 1)}
      <Text
        maxFontSizeMultiplier={1.2}
        style={{
          fontSize: 15,
          fontWeight: "700",
          color: t.ink,
          fontVariant: ["tabular-nums"],
        }}
      >
        {qty}
      </Text>
      {step(1, `Добавить: ${name}`, "+")}
    </View>
  );
}
