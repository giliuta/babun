import { Text, TextInput, View } from "react-native";
import { moneySymbol } from "@babun/shared/common/utils/money";
import { useThemeColors } from "@/theme/colors";

// ПОЛЕ СУММЫ — ОДНО НА ВЕСЬ ПРОДУКТ.
//
// Деньги набирают в трёх местах (операция, новый счёт, перевод), и все три
// поля были разными: в операции € висел серым хвостом ЗА числом, в счёте и
// переводе — словом в ярлыке («Сумма €»), размер цифры отличался вдвое.
// Символ при этом всюду зашит евро, хотя `tenants.currency` допускает пять
// валют и киевский тенант набирал бы гривны в поле с €.
//
// Символ стоит ПЕРЕД числом — так деньги напечатаны везде в продукте
// (`formatEURExact`); поле было единственным местом, где сумма читалась
// наоборот.
//
// Валидация сюда не переезжает: поле отдаёт СЫРОЙ текст, а разбор и текст
// ошибки остаются у вызывающей стороны — только она знает, допустим ли ноль
// и хватает ли остатка на счёте. Как у `Field`: ошибка приходит пропом.
export function MoneyField({
  label,
  value,
  onChangeText,
  currency,
  hint,
  error,
  allowNegative,
  autoFocus,
}: {
  label: string;
  /** Сырой текст поля — не число: разбор живёт у вызывающей стороны. */
  value: string;
  onChangeText: (value: string) => void;
  /** Код валюты тенанта (`tenants.currency`); символ печатается префиксом. */
  currency: string | null | undefined;
  /** Подпись под полем: что эта сумма значит («От неё считается баланс»). */
  hint?: string;
  error?: string | null;
  /** Счёт бывает в долге, поэтому минус разрешается полем, а не догадкой. */
  allowNegative?: boolean;
  autoFocus?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View style={{ marginBottom: 16 }}>
      {/* Ярлык — тот же набор, что у `Field`: поле суммы и текстовое поле в
          одной форме обязаны подписываться одинаково. */}
      <Text
        maxFontSizeMultiplier={1.2}
        style={{
          marginBottom: 6,
          fontSize: 13,
          lineHeight: 18,
          fontWeight: "600",
          color: t.caption,
        }}
      >
        {label}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          borderRadius: t.radius.input,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: error ? t.danger : t.separator,
          minHeight: 60,
          paddingHorizontal: 16,
          paddingVertical: 8,
        }}
      >
        <Text
          // Символ — часть НАПИСАНИЯ суммы, а не самостоятельный элемент:
          // иначе VoiceOver делает на «€» отдельную остановку перед полем.
          accessible={false}
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 30, fontWeight: "700", color: t.faint }}
        >
          {moneySymbol(currency)}
        </Text>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          autoFocus={autoFocus}
          // `decimal-pad` не содержит минуса ни в одной раскладке: счёт «в
          // долге» на ней физически не набрать. Там, где минус осмыслен,
          // берём клавиатуру с пунктуацией — на ней есть и точка, и минус.
          keyboardType={allowNegative ? "numbers-and-punctuation" : "decimal-pad"}
          // Сумма либо принимается целиком, либо перебивается целиком:
          // предзаполненный остаток («перевести всё») правят не по цифре, а
          // набором поверх, и стирать его вручную — лишняя работа.
          selectTextOnFocus
          placeholder="0"
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance="light"
          accessibilityLabel={label}
          maxFontSizeMultiplier={1.2}
          style={{
            flex: 1,
            padding: 0,
            fontSize: 30,
            fontWeight: "700",
            color: t.ink,
            // ТОЛЬКО СТИЛЕМ: `className="tabular-nums"` в этом стеке —
            // пустышка (см. src/lib/nativewind-traps.test.ts).
            fontVariant: ["tabular-nums"],
          }}
        />
      </View>
      {error ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          maxFontSizeMultiplier={1.2}
          style={{ marginTop: 4, fontSize: 14, color: t.danger }}
        >
          {error}
        </Text>
      ) : hint ? (
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ marginTop: 4, fontSize: 13, color: t.sub }}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
