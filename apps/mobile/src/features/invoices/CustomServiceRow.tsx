import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { X } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import type { EditableInvoiceLine } from "./format";
import { customLineTotalText, unitPriceFromTotal } from "./custom-line";

// СВОЯ УСЛУГА — СТРОКОЙ ПРЯМО В БЛОКЕ «УСЛУГИ».
//
// Владелец 2026-09-22: «„＋ Добавить“ возле „Услуги“ справа — и ничего не
// создавать: сразу внизу пишу услугу, количество, цену за штуку и сумму, и
// оно сразу добавляется пунктом внизу блока». Ни шторки, ни прайса: строка
// живёт только в этом документе. Сверху название, под ним три числа;
// «×» справа от названия убирает строку.

const FIELD_H = 40;

export function CustomServiceRow({
  line,
  autoFocus,
  onChange,
  onRemove,
}: {
  line: EditableInvoiceLine;
  autoFocus?: boolean;
  onChange: (line: EditableInvoiceLine) => void;
  onRemove: () => void;
}) {
  const t = useThemeColors();
  // Пока человек набирает сумму, поле показывает ЕГО текст; в остальное
  // время — сумму, которая выйдет из количества и цены.
  const [typedTotal, setTypedTotal] = useState<string | null>(null);

  const field = {
    height: FIELD_H,
    borderRadius: t.radius.input,
    borderCurve: "continuous" as const,
    backgroundColor: t.fill,
    paddingHorizontal: 10,
    fontSize: 15,
    color: t.ink,
    fontVariant: ["tabular-nums" as const],
  };
  const caption = (text: string) => (
    <Text style={{ fontSize: 12, color: t.sub, marginBottom: 4 }}>{text}</Text>
  );

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <TextInput
          value={line.title}
          onChangeText={(title) => onChange({ ...line, title })}
          placeholder="Название услуги"
          placeholderTextColor={t.placeholder}
          autoFocus={autoFocus}
          accessibilityLabel="Название своей услуги"
          style={[field, { flex: 1 }]}
        />
        <Pressable
          onPress={onRemove}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Убрать услугу"
          style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.4 : 1 })}
        >
          <X color={t.faint} size={18} strokeWidth={2} />
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", gap: 8, paddingRight: 30 }}>
        <View style={{ flex: 0.8 }}>
          {caption("Кол-во")}
          <TextInput
            value={line.qty}
            onChangeText={(qty) => onChange({ ...line, qty })}
            keyboardType="decimal-pad"
            selectTextOnFocus
            accessibilityLabel="Количество"
            style={[field, { textAlign: "center" }]}
          />
        </View>
        <View style={{ flex: 1.1 }}>
          {caption("Цена за шт.")}
          <TextInput
            value={line.unitPrice}
            onChangeText={(unitPrice) => onChange({ ...line, unitPrice })}
            keyboardType="decimal-pad"
            selectTextOnFocus
            placeholder="0,00"
            placeholderTextColor={t.placeholder}
            accessibilityLabel="Цена за штуку"
            style={[field, { textAlign: "right" }]}
          />
        </View>
        <View style={{ flex: 1.1 }}>
          {caption("Сумма")}
          <TextInput
            value={typedTotal ?? customLineTotalText(line)}
            onFocus={() => setTypedTotal(customLineTotalText(line))}
            onBlur={() => setTypedTotal(null)}
            onChangeText={(text) => {
              setTypedTotal(text);
              const unitPrice = unitPriceFromTotal(line.qty, text);
              if (unitPrice != null) onChange({ ...line, unitPrice });
            }}
            keyboardType="decimal-pad"
            selectTextOnFocus
            placeholder="0,00"
            placeholderTextColor={t.placeholder}
            accessibilityLabel="Сумма"
            style={[field, { textAlign: "right", fontWeight: "600" }]}
          />
        </View>
      </View>
    </View>
  );
}
