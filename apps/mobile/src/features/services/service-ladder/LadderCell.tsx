import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useThemeColors } from "@/theme/colors";
import { CELL_H } from "./layout";

// КОЛОНКИ РАЗДЕЛЕНЫ БЛОКАМИ, А НЕ ЧЕРТАМИ (владелец 2026-08-27: «разделение
// между столбиками не волосинка, а полноценно правильные блоки, красивые
// блоки как в iOS»).
//
// Волосинка стояла здесь один заход и была полумерой: она рисует границу, но
// не делает ячейку предметом — четыре числа всё равно читались одной строкой
// с насечками. Теперь у каждой ячейки СВОЯ залитая плитка со скруглением, а
// между плитками воздух. Так устроены группы в самом iOS: предмет отделяется
// не линией, а собственным телом и зазором вокруг него.
//
// Заливка ещё и подсказывает, что в ячейку МОЖНО ПИСАТЬ: на белом фоне поле
// ввода ничем не отличалось от подписи, и человек не понимал, где тут число,
// а где надпись.

export function LadderCell({
  value,
  onChange,
  width,
  prefix,
  suffix,
  align = "right",
  accessibilityLabel,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  width?: number;
  /** Приписка СЛЕВА от числа — «от» у количества. */
  prefix?: string;
  /** Знак валюты. Стоит СПРАВА ОТ ЧИСЛА, а не слева от ячейки: слева он
   *  прижимался к соседней колонке и читался её частью — строка начиналась
   *  «1 €», хотя единица это количество, а евро уже цена. */
  suffix?: string;
  align?: "right" | "center";
  accessibilityLabel: string;
  placeholder?: string;
}) {
  const t = useThemeColors();
  // НАБРАННОЕ — КАК НАБРАНО, ПОКА ПОЛЕ В ФОКУСЕ (аудит шестерёнки 03.10).
  // Строка ступени хранит сумму «за всё» и показывает «за одну»: «12.»
  // на количестве 2 уходило в черновик как 24, возвращалось «12», и точка
  // стиралась — копейки на ступени не набирались вовсе. Пока человек
  // печатает, поле держит его текст; пересчитанное число — после ухода.
  const [typing, setTyping] = useState<string | null>(null);
  return (
    <View
      className="flex-row items-center justify-end"
      style={{
        width,
        flex: width ? undefined : 1,
        gap: 2,
        height: CELL_H,
        paddingHorizontal: 10,
        borderRadius: t.radius.input,
        borderCurve: "continuous",
        backgroundColor: t.fill,
      }}
    >
      {prefix ? (
        <Text style={{ fontSize: 13, color: t.sub }}>{prefix}</Text>
      ) : null}
      <TextInput
        value={typing ?? value}
        onFocus={() => setTyping(value)}
        onBlur={() => setTyping(null)}
        onChangeText={(next) => {
          setTyping(next);
          onChange(next);
        }}
        placeholder={placeholder}
        placeholderTextColor={t.placeholder}
        keyboardType="decimal-pad"
        accessibilityLabel={accessibilityLabel}
        selectionColor={t.accent}
        keyboardAppearance="light"
        style={{
          flex: 1,
          textAlign: align,
          fontSize: 16,
          fontWeight: "600",
          color: t.ink,
          fontVariant: ["tabular-nums"],
          paddingVertical: 8,
        }}
      />
      {suffix ? (
        <Text style={{ fontSize: 14, color: t.sub }}>{suffix}</Text>
      ) : null}
    </View>
  );
}
