import { Pressable, Text, View } from "react-native";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { COL_QTY } from "./columns";

/** Количество — ОДНОЙ ПИЛЮЛЕЙ «− 3 +», а не тремя предметами через всю
 *  строку. Три отдельных кружка, разъехавшихся по ширине карточки, читались
 *  как три разные кнопки; здесь это один орган с числом посередине.
 *
 *  «−» на единице УБИРАЕТ услугу из записи — тот же закон, что в списке услуг
 *  на странице записи (ноль = вычеркнули), поэтому знак не гаснет. */
export function QtyStepper({
  name,
  qty,
  onChange,
}: {
  name: string;
  qty: number;
  onChange: (next: number) => void;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        width: COL_QTY,
        height: 34,
        borderRadius: t.radius.input,
        backgroundColor: t.fill,
      }}
    >
      <StepButton
        icon="minus"
        label={qty <= 1 ? `Убрать: ${name}` : `Убавить: ${name}`}
        onPress={() => onChange(qty - 1)}
      />
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
      <StepButton
        icon="plus"
        label={`Добавить: ${name}`}
        onPress={() => onChange(qty + 1)}
      />
    </View>
  );
}

// Круг 30pt с зоной касания 44pt: в листе, где считают деньги, промах по
// «минусу» стоит дороже, чем лишние пиксели.
//
// ЗНАКИ — ТЕКСТОМ, А НЕ ИКОНКАМИ. Продуктовая политика запрещает `Plus` из
// lucide во всём приложении (`ui-policy-contract`): плюс-иконка означала
// «создать» и уводила от `AddRow`. Здесь это не создание, а арифметика — и
// набирается она теми же знаками, что человек видит на клавиатуре.
function StepButton({
  icon,
  label,
  onPress,
}: {
  icon: "minus" | "plus";
  label: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      hitSlop={7}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Внутри пилюли `QtyStepper`: подложку и радиус даёт она, кнопке
      // остаётся зона касания. Своя заливка рисовала бы круг в круге.
      style={({ pressed }) => ({
        width: 28,
        height: 34,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.5 : 1,
      })}
    >
      <Text
        maxFontSizeMultiplier={1}
        style={{ fontSize: 18, fontWeight: "600", color: t.ink, lineHeight: 22 }}
      >
        {icon === "minus" ? "−" : "+"}
      </Text>
    </Pressable>
  );
}
