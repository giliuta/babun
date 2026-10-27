import { useRef, useState, type Ref } from "react";
import { Text, TextInput, View, type TextInput as TextInputType } from "react-native";
import type { ServicesBlockLine } from "@/features/appointments/ServicesBlock";
import { parseMoneyInput } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import { COL_GAP, COL_PRICE, COL_QTY, COL_SUM } from "./columns";
import { moneyCellText, unitFromRowTotal } from "./line-math";
import { QtyStepper } from "./QtyStepper";

/** ШАПКА КОЛОНОК — ВМЕСТО ПОДПИСЕЙ В КАЖДОЙ СТРОКЕ (название, количество, цена за единицу и
 *  общая цена). Слова «за шт» и «всего» повторялись в
 *  каждой строке и съедали ту самую ширину, которой не хватало именам. Здесь
 *  они сказаны один раз сверху, и список становится таблицей. */
export function ColumnHeader() {
  const t = useThemeColors();
  const cap = {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 0.6,
    textTransform: "uppercase" as const,
    color: t.faint,
  };
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: COL_GAP,
        paddingHorizontal: 14,
        paddingTop: 8,
        paddingBottom: 4,
      }}
    >
      <Text style={[cap, { flex: 1 }]}>Услуга</Text>
      <Text style={[cap, { width: COL_QTY, textAlign: "center" }]}>Кол-во</Text>
      {/* Без знака валюты: «Сумма, €» переносилось на вторую строку и рвало
          шапку, а лист и так весь про деньги одной валюты. */}
      <Text style={[cap, { width: COL_PRICE, textAlign: "right" }]}>Цена</Text>
      <Text style={[cap, { width: COL_SUM, textAlign: "right" }]}>Сумма</Text>
    </View>
  );
}

export function ServiceLine({
  line,
  separated,
  onQtyChange,
  onPriceChange,
  onNameChange,
}: {
  line: ServicesBlockLine;
  /** Не первая строка списка — волосок сверху. */
  separated?: boolean;
  onQtyChange: (lineId: string, qty: number) => void;
  onPriceChange: (lineId: string, price: number) => void;
  onNameChange?: (lineId: string, name: string) => void;
}) {
  const name = line.name;
  const nameEditable = line.editableName !== undefined && !!onNameChange;
  const t = useThemeColors();
  // ЧЕРНОВИКИ — СВОИ У КАЖДОГО ПОЛЯ. Пока набирают «13», строка не должна
  // превращаться в «€13» и терять то, что человек ещё не дописал; число уходит
  // в запись на каждый символ, а показывает поле набранное.
  const [unitDraft, setUnitDraft] = useState<string | null>(null);
  const [totalDraft, setTotalDraft] = useState<string | null>(null);
  const unitShown = unitDraft ?? moneyCellText(line.pricePerUnit);
  const totalShown = totalDraft ?? moneyCellText(line.total);
  // Return в названии своей строки ведёт к цене, а не прячет клавиатуру.
  const priceRef = useRef<TextInputType>(null);
  // ОДНА СТРОКА НА УСЛУГУ, ЧЕТЫРЕ КОЛОНКИ. Цветная точка услуги и её длительность второй
  // строкой здесь лишние. Длительность живёт в строке
  // услуги на самой странице записи и от правки цены не меняется, цвет тут
  // ничего не различает — услуг в списке немного, и каждая названа словом.
  //
  // Имя переносится на вторую строку, а не обрезается: «Заправка фреоном» в
  // 130pt не влезает, а услуга без имени — не услуга.
  const nameNode = nameEditable ? (
    <TextInput
      keyboardAppearance="light"
      value={line.editableName}
      onChangeText={(next) => onNameChange?.(line.id, next)}
      placeholder="Название"
      placeholderTextColor={t.placeholder}
      selectionColor={t.accent}
      // Новая строка — курсор сразу в имени.
      autoFocus={!line.editableName}
      returnKeyType="next"
      submitBehavior="submit"
      onSubmitEditing={() => priceRef.current?.focus()}
      accessibilityLabel="Название своей услуги"
      maxFontSizeMultiplier={1.2}
      style={{
        height: 34,
        paddingHorizontal: 8,
        ...ANDROID_INPUT,
        borderRadius: t.radius.input,
        backgroundColor: t.fill,
        fontSize: 15,
        fontWeight: "600",
        color: t.ink,
      }}
    />
  ) : (
    <Text
      numberOfLines={2}
      style={{ flex: 1, fontSize: 15, fontWeight: "600", color: t.ink }}
    >
      {name}
    </Text>
  );
  const numbers = (
    <>
      <QtyStepper
        name={name}
        qty={line.qty}
        onChange={(next) => onQtyChange(line.id, next)}
      />
      {/* ЦЕНА ЗА ОДНУ И СУММА СТРОКИ — ПРАВЯТСЯ ОБЕ (можно править цену за штуку или общую сумму). Снимок строки хранит цену за штуку, итог = цена × количество
          в копейках; набранная сумма пересчитывает цену за одну. Прайс
          каталога не трогается. */}
      <MoneyCell
        width={COL_PRICE}
        value={unitShown}
        inputRef={priceRef}
        accessibilityLabel={`Цена за одну: ${name}`}
        onChange={(next) => {
          setUnitDraft(next);
          setTotalDraft(null);
          onPriceChange(line.id, parseMoneyInput(next));
        }}
        onBlur={() => setUnitDraft(null)}
      />
      <MoneyCell
        width={COL_SUM}
        value={totalShown}
        strong
        accessibilityLabel={`Сумма строки: ${name}`}
        onChange={(next) => {
          setTotalDraft(next);
          setUnitDraft(null);
          onPriceChange(line.id, unitFromRowTotal(parseMoneyInput(next), line.qty));
        }}
        onBlur={() => setTotalDraft(null)}
      />
    </>
  );
  const frame = {
    gap: COL_GAP,
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderTopWidth: separated ? 1 : 0,
    borderTopColor: t.separator,
  } as const;

  // СВОЯ СТРОКА — НАЗВАНИЕ НАД ЧИСЛАМИ, во всю ширину: в колонке рядом с
  // числами на узком экране оставалось ~80 pt, и «Замена компрессора» не
  // читалась. Строки прайса остаются одной строкой — их имя не правят.
  if (nameEditable) {
    return (
      <View style={{ ...frame, paddingVertical: 8 }}>
        {nameNode}
        <View
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: COL_GAP }}
        >
          {numbers}
        </View>
      </View>
    );
  }
  return (
    <View style={{ ...frame, flexDirection: "row", alignItems: "center" }}>
      {nameNode}
      {numbers}
    </View>
  );
}

/** Android добавляет полю шрифтовые поля сверху: в высоте 34 цифры
 *  срезались по верху. На iOS эти свойства ничего не меняют. */
const ANDROID_INPUT = {
  paddingVertical: 0,
  includeFontPadding: false,
  textAlignVertical: "center",
} as const;

/** Денежное поле колонки. Знака валюты в ячейке нет — он сказан в шапке
 *  колонки один раз; подложка говорит, что число правится. */
function MoneyCell({
  value,
  width,
  strong,
  inputRef,
  accessibilityLabel,
  onChange,
  onBlur,
}: {
  value: string;
  width: number;
  inputRef?: Ref<TextInputType>;
  /** Сумма работы: крупнее и чернилами — её читают, остальное крутят. */
  strong?: boolean;
  accessibilityLabel: string;
  onChange: (next: string) => void;
  onBlur: () => void;
}) {
  const t = useThemeColors();
  return (
    <TextInput
      ref={inputRef}
      keyboardAppearance="light"
      selectionColor={t.accent}
      value={value}
      onChangeText={onChange}
      onBlur={onBlur}
      selectTextOnFocus
      keyboardType="decimal-pad"
      placeholder="0"
      placeholderTextColor={t.placeholder}
      accessibilityLabel={accessibilityLabel}
      maxFontSizeMultiplier={1.2}
      style={{
        width,
        height: 34,
        paddingHorizontal: 8,
        ...ANDROID_INPUT,
        borderRadius: t.radius.input,
        backgroundColor: t.fill,
        textAlign: "right",
        fontSize: strong ? 16 : 15,
        fontWeight: "700",
        color: t.ink,
        fontVariant: ["tabular-nums"],
      }}
    />
  );
}
