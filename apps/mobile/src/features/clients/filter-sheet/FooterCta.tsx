import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GradientButton } from "@/components/ui/GradientButton";
import type { ThemeColors } from "@/theme/colors";

/** Футер-CTA — общий каркас страницы и попапов. Кнопка — та же «плита»
 *  `GradientButton`, что и везде: своя плоская кобальтовая заливка была
 *  второй главной кнопкой продукта (смета 035, №30). Число в надписи больше
 *  не катается — плита меняет подпись на месте, глагол не моргает. */
export function FooterCta({
  t,
  verb,
  roll,
  hint,
  a11yLabel,
  a11yHint,
  onPress,
}: {
  t: ThemeColors;
  /** Постоянная часть надписи («Показать », «Готово»). */
  verb: string;
  /** Меняющаяся часть («12 клиентов», « · 3 тега»). */
  roll?: string | null;
  /** Строка над кнопкой; без текста её нет. */
  hint?: string | null;
  a11yLabel: string;
  a11yHint: string;
  onPress: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: t.surface,
        borderTopWidth: 1,
        borderTopColor: t.separator,
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: Math.max(insets.bottom, 12) + 2,
      }}
    >
      {/* Подсказка печатается ТОЛЬКО когда есть что сказать. Прежде здесь
          стояла невидимая строка-распорка (opacity 0, minHeight 16) — она
          держала место «чтобы кнопка не прыгала», но в половинном листе это
          25pt пустоты над главным действием. Кнопка и так не прыгает:
          подсказка появляется вместе с изменением набора. */}
      {hint ? (
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={{
            marginBottom: 8,
            textAlign: "center",
            fontSize: 13,
            color: t.faint,
          }}
        >
          {hint}
        </Text>
      ) : null}
      <GradientButton
        label={`${verb}${roll ?? ""}`}
        accessibilityLabel={a11yLabel}
        accessibilityHint={a11yHint}
        onPress={onPress}
      />
    </View>
  );
}
