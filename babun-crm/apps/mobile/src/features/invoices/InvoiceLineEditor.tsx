import { Pressable, Text, TextInput, View } from "react-native";
import { useThemeColors } from "@/theme/colors";
import {
  formatInvoiceMoney,
  parseDecimal,
  parseMoneyAmount,
} from "./format";

export interface EditableInvoiceLine {
  id: string;
  title: string;
  qty: string;
  unitPrice: string;
}

export function InvoiceLineEditor({
  line,
  canRemove,
  onChange,
  onRemove,
}: {
  line: EditableInvoiceLine;
  canRemove: boolean;
  onChange: (line: EditableInvoiceLine) => void;
  onRemove: () => void;
}) {
  const t = useThemeColors();
  const qty = parseDecimal(line.qty) ?? 0;
  const price = parseMoneyAmount(line.unitPrice) ?? 0;

  const inputStyle = {
    minHeight: 44,
    borderRadius: t.radius.input,
    borderWidth: 1,
    borderColor: t.separator,
    paddingHorizontal: 12,
    fontSize: 16,
    color: t.ink,
    backgroundColor: t.surface,
  } as const;

  return (
    <View
      className="rounded-2xl p-3"
      style={{ backgroundColor: t.canvas, borderWidth: 1, borderColor: t.separator }}
    >
      <Text className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: t.faint }}>
        Описание
      </Text>
      <TextInput
        value={line.title}
        onChangeText={(title) => onChange({ ...line, title })}
        placeholder="Услуга или товар"
        placeholderTextColor={t.placeholder}
        selectionColor={t.accent}
        keyboardAppearance="light"
        accessibilityLabel="Описание позиции"
        style={inputStyle}
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
            Цена, €
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
        <Text className="text-sm font-semibold tabular-nums" style={{ color: t.ink }}>
          {formatInvoiceMoney(qty * price)}
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
