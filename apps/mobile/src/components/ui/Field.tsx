import { Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { useState, type ReactNode, type Ref } from "react";
import { useThemeColors, type ThemeColors } from "@/theme/colors";

/** ВЫСОТА ПОЛЯ ВВОДА — DS §3: «Input 52». */
export const INPUT_HEIGHT = 52;
/** Кольцо фокуса — DS §5: «focused 1.5px accent inset ring». */
export const INPUT_RING = 1.5;

/** РАМКА ПОЛЯ ВВОДА — ОДНА НА ПРОДУКТ (DS §1, §7). Заливка `t.fill` — та
 *  самая «inset input», без обводки: «DON'T use 1px borders». Поля жили
 *  белыми с волоском по краю в 48pt — чужие и на странице, и в листе. В
 *  фокусе — кольцо акцентом по той же рамке; без фокуса оно прозрачное, и
 *  поле не прыгает на полтора пункта при вводе. Браузерную рамку фокуса
 *  (второй синий, прямые углы) снимает `global.css`. */
export function inputFrame(t: ThemeColors, focused: boolean): ViewStyle {
  return {
    minHeight: INPUT_HEIGHT,
    borderRadius: t.radius.input,
    borderCurve: "continuous",
    backgroundColor: t.fill,
    borderWidth: INPUT_RING,
    borderColor: focused ? t.accent : "transparent",
  };
}

/** Фокус поля для кольца: свои обработчики поля зовутся как прежде. */
export function useInputFocus(props: Pick<TextInputProps, "onFocus" | "onBlur">) {
  const [focused, setFocused] = useState(false);
  return {
    focused,
    onFocus: ((e) => {
      setFocused(true);
      props.onFocus?.(e);
    }) as NonNullable<TextInputProps["onFocus"]>,
    onBlur: ((e) => {
      setFocused(false);
      props.onBlur?.(e);
    }) as NonNullable<TextInputProps["onBlur"]>,
  };
}

/** ЯРЛЫК ПОЛЯ — ОДНА ТИПОГРАФИКА НА ВСЕ ПОЛЯ. В одном листе
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
  leading,
  inputRef,
  ...inputProps
}: {
  label: string;
  error?: string | null;
  /** ХВОСТ ВНУТРИ РАМКИ — ответ, живущий при самом поле: «за шт.» у цены,
   *  «на шт.» у материалов. Рамка становится рядом, ввод занимает всё, что
   *  осталось. Так на листе не заводится четвёртая рукописная рамка ради
   *  одного слова (анатомия та же, что у `MoneyField`). */
  trailing?: ReactNode;
  /** ГОЛОВА ВНУТРИ РАМКИ — плитка слева, как у названия с цветом
   *  (`NameColorField`): одна строка одним блоком, а не подпись над голым
   *  вводом. Первый носитель — почта в «Пригласить мастера». */
  leading?: ReactNode;
  /** Поле наружу — экран возвращает в него курсор (почта нового партнёра). */
  inputRef?: Ref<TextInput>;
} & TextInputProps) {
  const t = useThemeColors();
  // ЧИСЛО ВЫДЕЛЯЕТСЯ ЦЕЛИКОМ ПРИ ФОКУСЕ. Без этого правка «60» на «40» даёт
  // «6040»: курсор встаёт в конец, а на цифровой клавиатуре нет ни стрелок,
  // ни удобного способа выделить.
  const numeric =
    inputProps.keyboardType === "decimal-pad" ||
    inputProps.keyboardType === "number-pad";
  const focus = useInputFocus(inputProps);
  const input = (
    <TextInput
      ref={inputRef}
      accessibilityLabel={accessibilityLabel ?? label}
      placeholderTextColor={t.placeholder}
      selectionColor={t.accent}
      keyboardAppearance="light"
      selectTextOnFocus={numeric}
      style={[
        {
          flex: 1,
          minHeight: INPUT_HEIGHT - 2 * INPUT_RING,
          paddingVertical: 12,
          fontSize: 15,
          color: t.ink,
        },
        style,
      ]}
      {...inputProps}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
    />
  );
  return (
    <View style={{ marginBottom: 16 }}>
      {/* Пустая подпись — поле под шапкой листа, которая уже его назвала
          («Новая почта»): третий раз то же слово не печатаем. */}
      {label ? <FieldLabel text={label} /> : null}
      <View
        style={[
          inputFrame(t, focus.focused),
          { flexDirection: "row", alignItems: "center", paddingHorizontal: 16 - INPUT_RING },
        ]}
      >
        {leading ? <View style={{ marginRight: 12 }}>{leading}</View> : null}
        {input}
        {trailing}
      </View>
      {error ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={{ marginTop: 4, fontSize: 13, color: t.danger }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
