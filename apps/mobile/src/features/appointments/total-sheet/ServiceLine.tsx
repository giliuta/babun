import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import type { ServicesBlockLine } from "@/features/appointments/ServicesBlock";
import { parseMoneyInput } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import { COL_GAP, COL_PRICE, COL_QTY, COL_SUM } from "./columns";
import { unitFromRowTotal } from "./line-math";
import { QtyStepper } from "./QtyStepper";

/** ШАПКА КОЛОНОК — ВМЕСТО ПОДПИСЕЙ В КАЖДОЙ СТРОКЕ (владелец 2026-09-08:
 *  «названия — красивый блок, потом количество — тоже красивый блок, потом
 *  цена за единицу и общая цена»). Слова «за шт» и «всего» повторялись в
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
  const unitShown = unitDraft ?? String(Number(line.pricePerUnit.toFixed(2)));
  const totalShown = totalDraft ?? String(Number(line.total.toFixed(2)));

  // ОДНА СТРОКА НА УСЛУГУ, ЧЕТЫРЕ КОЛОНКИ. Было две строки: во второй стояли
  // цветная точка услуги и её длительность — и то и другое здесь лишнее
  // (владелец 2026-09-08: «цвет услуги не нужен»; «полтора часа — на хуя его
  // второй раз дублировать, оно не меняется»). Длительность живёт в строке
  // услуги на самой странице записи и от правки цены не меняется, цвет тут
  // ничего не различает — услуг в списке немного, и каждая названа словом.
  //
  // Имя переносится на вторую строку, а не обрезается: «Заправка фреоном» в
  // 130pt не влезает, а услуга без имени — не услуга.
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: COL_GAP,
        minHeight: 46,
        paddingHorizontal: 14,
        paddingVertical: 4,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
      }}
    >
      {nameEditable ? (
        <TextInput
          keyboardAppearance="light"
          value={line.editableName}
          onChangeText={(next) => onNameChange?.(line.id, next)}
          placeholder="Название"
          placeholderTextColor={t.placeholder}
          // Новая строка — курсор сразу в имени.
          autoFocus={!line.editableName}
          accessibilityLabel="Название своей услуги"
          maxFontSizeMultiplier={1.2}
          style={{
            flex: 1,
            height: 34,
            paddingHorizontal: 8,
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
      )}
      <QtyStepper
        name={name}
        qty={line.qty}
        onChange={(next) => onQtyChange(line.id, next)}
      />
      {/* ЦЕНА ЗА ОДНУ И СУММА СТРОКИ — ПРАВЯТСЯ ОБЕ (владелец 2026-09-07:
          «в итого редактировать могу либо по количеству за штуку, либо общую
          сумму»). Снимок строки хранит цену за штуку, итог = цена × количество
          в копейках; набранная сумма пересчитывает цену за одну. Прайс
          каталога не трогается. */}
      <MoneyCell
        width={COL_PRICE}
        value={unitShown}
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
    </View>
  );
}

/** Денежное поле колонки. Знака валюты в ячейке нет — он сказан в шапке
 *  колонки один раз; подложка говорит, что число правится. */
function MoneyCell({
  value,
  width,
  strong,
  accessibilityLabel,
  onChange,
  onBlur,
}: {
  value: string;
  width: number;
  /** Сумма работы: крупнее и чернилами — её читают, остальное крутят. */
  strong?: boolean;
  accessibilityLabel: string;
  onChange: (next: string) => void;
  onBlur: () => void;
}) {
  const t = useThemeColors();
  return (
    <TextInput
      keyboardAppearance="light"
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
