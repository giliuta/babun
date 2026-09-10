import { Text, TextInput, View } from "react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { useThemeColors } from "@/theme/colors";

// БЛОК СУММЫ — ОДИН НА ВСЕ ФОРМЫ ДЕНЕГ (владелец 2026-09-10: «там просто ноль
// показан; сверху подпись „сумма“, чтобы было понимание, что это такое», и
// следом — «операции сделай так же, как долги; берёшь то, что уже имеем»).
//
// ЕВРО СЛЕВА, ВПЛОТНУЮ К ЧИСЛУ. Везде в продукте деньги печатаются «€195» —
// знак идёт первым; в поле он стоял у правой кромки, и глаз шёл к нему через
// пустое поле. «€ 0» читается одним предметом, а курсор встаёт сразу за знаком.
//
// Цвет числа задаёт вызывающий: у долга он по стороне (янтарь — должны нам,
// красный — должны мы), у операции по направлению (зелёный доход, красный
// расход). Сам блок про смысл денег ничего не знает и знать не должен.

export function AmountBlock({
  value,
  onChange,
  color,
  title = "Сумма",
  accessibilityLabel,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  color: string;
  title?: string;
  accessibilityLabel: string;
  autoFocus?: boolean;
}) {
  const t = useThemeColors();
  return (
    <SectionCard title={title} dense>
      {/* ВЫСОТА СТРОКИ ЗАДАНА ЯВНО. У поля 28-го кегля своя строка шрифта
          выше, чем даёт вертикальный отступ в четыре точки: карточка режет
          её по краю, и ноль-подсказка выходил обрезанным сверху — «€ ᴗ»
          вместо «€ 0» (поймано на экране 2026-09-10). */}
      <View
        className="flex-row items-center gap-1.5 px-4"
        style={{ minHeight: 46 }}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          className="text-[28px] font-bold"
          style={{ color: t.faint }}
        >
          €
        </Text>
        <TextInput
          value={value}
          accessibilityLabel={accessibilityLabel}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance="light"
          autoFocus={autoFocus}
          maxFontSizeMultiplier={1.2}
          className="flex-1 text-[28px] font-bold"
          style={{
            color,
            fontVariant: ["tabular-nums"],
            // Своя высота у поля: iOS меряет TextInput тесно и режет верх
            // глифа, если строку не задать.
            height: 38,
            padding: 0,
          }}
        />
      </View>
    </SectionCard>
  );
}
