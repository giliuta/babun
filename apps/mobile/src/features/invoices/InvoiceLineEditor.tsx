import { Pressable, Text, TextInput, View } from "react-native";
import { moneySymbol } from "@babun/shared/common/utils/money";
import { useThemeColors } from "@/theme/colors";
import {
  formatInvoiceMoney,
  parseDecimal,
  parseMoneyAmount,
} from "./format";

export interface EditableInvoiceLine {
  id: string;
  title: string;
  /** Что входит в работу. Приезжает из описания услуги и дальше живёт своей
   *  жизнью: правка в документе прайс не трогает. */
  description?: string | null;
  qty: string;
  /** Единица количества: «4 м» на бумаге. Приезжает из услуги и с этого
   *  момента принадлежит документу — как и описание. */
  unit?: string | null;
  unitPrice: string;
}

export function InvoiceLineEditor({
  line,
  currency,
  canRemove,
  separated,
  onChange,
  onRemove,
}: {
  line: EditableInvoiceLine;
  /** Валюта документа (из настроек компании) — форма говорит в ней же,
   *  а не в зашитом евро. */
  currency: string;
  canRemove: boolean;
  /** Шов над позицией — когда она идёт не первой в списке. */
  separated?: boolean;
  onChange: (line: EditableInvoiceLine) => void;
  onRemove: () => void;
}) {
  const t = useThemeColors();
  const qty = parseDecimal(line.qty) ?? 0;
  const price = parseMoneyAmount(line.unitPrice) ?? 0;

  // ОДНА ВСТАВНАЯ ЗАЛИВКА НА ПРОДУКТ (DS §«fill»): поля позиции были белыми в
  // 1px рамке — единственный контурный ввод среди залитых (поиск в шапке,
  // ставка НДС, суммы). Рамка на белой карточке и так почти не видна, а
  // заливка сразу говорит «сюда печатать».
  const inputStyle = {
    minHeight: 44,
    borderRadius: t.radius.input,
    paddingHorizontal: 12,
    fontSize: 16,
    color: t.ink,
    backgroundColor: t.fill,
  } as const;

  return (
    <View
      className="px-4 py-3"
      style={{
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
      }}
    >
      {/* НАЗВАНИЕ И ОПИСАНИЕ — РАЗНЫЕ ВОПРОСЫ (2026-08-21). До этого дня поле
          названия было подписано «Описание», и с приходом настоящего описания
          в одной форме оказалось бы два «Описания». */}
      <Text className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: t.faint }}>
        Название
      </Text>
      <TextInput
        value={line.title}
        onChangeText={(title) => onChange({ ...line, title })}
        selectionColor={t.accent}
        keyboardAppearance="light"
        accessibilityLabel="Название позиции"
        style={inputStyle}
      />

      {/* ПРАВКА ОПИСАНИЯ В СЧЁТЕ НЕ ТРОГАЕТ ПРАЙС: документ помнит свою
          формулировку, а справочник переименуют задним числом. */}
      <Text
        className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wider"
        style={{ color: t.faint }}
      >
        Что входит
      </Text>
      <TextInput
        value={line.description ?? ""}
        onChangeText={(description) => onChange({ ...line, description })}
        multiline
        selectionColor={t.accent}
        keyboardAppearance="light"
        accessibilityLabel="Что входит в позицию"
        style={[inputStyle, { minHeight: 64, textAlignVertical: "top" }]}
      />

      <View className="mt-3 flex-row" style={{ gap: 10 }}>
        <View className="flex-1">
          <Text className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: t.faint }}>
            Количество
          </Text>
          <TextInput
            value={line.qty}
            onChangeText={(value) => onChange({ ...line, qty: value })}
            placeholder="1"
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance="light"
            keyboardType="decimal-pad"
            accessibilityLabel="Количество"
            style={inputStyle}
          />
        </View>
        <View className="flex-1">
          <Text className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: t.faint }}>
            Цена, {moneySymbol(currency)}
          </Text>
          <TextInput
            value={line.unitPrice}
            onChangeText={(value) => onChange({ ...line, unitPrice: value })}
            placeholder="0"
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance="light"
            keyboardType="decimal-pad"
            accessibilityLabel="Цена"
            style={inputStyle}
          />
        </View>
      </View>

      <View className="mt-3 flex-row items-center justify-between">
        <Text
          className="text-sm font-semibold"
          // Только стилем: `tabular-nums` в className в этом стеке — пустышка.
          style={{ color: t.ink, fontVariant: ["tabular-nums"] }}
        >
          {formatInvoiceMoney(qty * price, currency)}
        </Text>
        {canRemove ? (
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel="Удалить позицию"
            hitSlop={8}
            className="min-h-11 justify-center px-2 active:opacity-60"
          >
            <Text className="text-sm font-semibold" style={{ color: t.danger }}>
              Удалить
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
