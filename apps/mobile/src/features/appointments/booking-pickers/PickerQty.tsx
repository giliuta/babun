import { Pressable, Text, View } from "react-native";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

/** КОЛИЧЕСТВО УСЛУГИ — «− 3 +» прямо в строке списка. Пилюля, а не три
 *  кнопки: один орган с числом посередине. Стоит у КАЖДОЙ строки, и у
 *  невзятой тоже («− 0 +»): строка сама не нажимается, берут услугу «+»,
 *  считают «+» и «−».
 *
 *  «−» НА ЕДИНИЦЕ СНИМАЕТ УСЛУГУ, на нуле — гаснет. Снять — тем же органом,
 *  которым считали: палец, промахнувшийся мимо «+» на название, не берёт и
 *  не стирает услугу вместе с набранным «×3». */
export function PickerQty({
  name,
  qty,
  onChange,
  onRemove,
}: {
  name: string;
  qty: number;
  onChange: (next: number) => void;
  /** «−» на единице: снять услугу. */
  onRemove: () => void;
}) {
  const t = useThemeColors();
  const step = (delta: number, label: string, sign: string, off?: boolean) => (
    <Pressable
      onPress={() => {
        if (off) return;
        haptics.tap();
        if (qty + delta < 1) onRemove();
        else onChange(qty + delta);
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
      {step(-1, qty <= 1 ? `Убрать: ${name}` : `Убавить: ${name}`, "\u2212", qty < 1)}
      <Text
        maxFontSizeMultiplier={1.2}
        style={{
          fontSize: 15,
          fontWeight: "700",
          color: qty > 0 ? t.ink : t.sub,
          fontVariant: ["tabular-nums"],
        }}
      >
        {qty}
      </Text>
      {step(1, `Добавить: ${name}`, "+")}
    </View>
  );
}
