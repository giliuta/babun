import { Text, TextInput, View, type TextInputProps } from "react-native";
import type { ReactNode } from "react";
import { useThemeColors } from "@/theme/colors";

/** ЯРЛЫК ПОЛЯ — ОДНА ТИПОГРАФИКА НА ВСЕ ПОЛЯ (2026-08-12). В одном листе
 *  создания счёта стояли три ярлыка тремя разными наборами (14/500, 12/500,
 *  14/500): форма из трёх вопросов выглядела собранной из трёх разных форм.
 *  Капс не берём — он в продукте значит «начало группы».
 *
 *  Живёт здесь и экспортируется: подпись нужна не только вводу текста, но и
 *  полям-раскрывашкам цвета и значка (`picker-fields`), а третья копия этих же
 *  чисел разъехалась бы на первой правке. */
export function FieldLabel({ text }: { text: string }) {
  const t = useThemeColors();
  return (
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
      {text}
    </Text>
  );
}

// Labeled text input. Works standalone (value/onChangeText) and pairs cleanly
// with TanStack Form fields (pass value + onChangeText + error from the field).
export function Field({
  label,
  error,
  style,
  accessibilityLabel,
  trailing,
  ...inputProps
}: {
  label: string;
  error?: string | null;
  /** ХВОСТ ВНУТРИ РАМКИ — ответ, живущий при самом поле: «за шт.» у цены,
   *  «на шт.» у материалов. Рамка становится рядом, ввод занимает всё, что
   *  осталось. Так на листе не заводится четвёртая рукописная рамка ради
   *  одного слова (анатомия та же, что у `MoneyField`). */
  trailing?: ReactNode;
} & TextInputProps) {
  const t = useThemeColors();
  // ЧИСЛО ВЫДЕЛЯЕТСЯ ЦЕЛИКОМ ПРИ ФОКУСЕ. Без этого правка «60» на «40» даёт
  // «6040»: курсор встаёт в конец, а на цифровой клавиатуре нет ни стрелок,
  // ни удобного способа выделить.
  const numeric =
    inputProps.keyboardType === "decimal-pad" ||
    inputProps.keyboardType === "number-pad";
  const input = (
    <TextInput
      accessibilityLabel={accessibilityLabel ?? label}
      placeholderTextColor={t.placeholder}
      selectionColor={t.accent}
      keyboardAppearance="light"
      selectTextOnFocus={numeric}
      style={[
        {
          minHeight: 48,
          paddingHorizontal: trailing ? 0 : 16,
          paddingVertical: 12,
          fontSize: 16,
          color: t.ink,
          ...(trailing ? { flex: 1 } : null),
        },
        trailing
          ? null
          : {
              borderRadius: t.radius.input,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: t.separator,
            },
        style,
      ]}
      {...inputProps}
    />
  );
  return (
    <View style={{ marginBottom: 16 }}>
      <FieldLabel text={label} />
      {trailing ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            borderRadius: t.radius.input,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: t.separator,
            paddingHorizontal: 16,
          }}
        >
          {input}
          {trailing}
        </View>
      ) : (
        input
      )}
      {error ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={{ marginTop: 4, fontSize: 14, color: t.danger }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
