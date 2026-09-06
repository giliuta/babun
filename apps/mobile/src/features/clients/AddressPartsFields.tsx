import { Pressable, Text, View } from "react-native";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import type { AddressParts } from "@babun/shared/local/clients";
import { FieldRow } from "@/components/ui/card-rows";
import { ICON } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// УТОЧНЕНИЕ АДРЕСА — «МИНИ-ДОП» ПОД ГЛАВНОЙ СТРОКОЙ (владелец 2026-09-06:
// «основное — это адрес или ссылка на карту; уточнение можно раскрыть и
// свернуть обратно»). Главная строка «Адрес или ссылка» живёт в листе и стоит
// всегда; здесь — переключатель и поля уточнения: комплекс, подъезд · этаж ·
// квартира одной строкой, город, индекс и ссылка на карту (пин, когда главная
// строка — текст). Улицы и дома среди полей НЕТ — это и есть главная строка.
//
// Свёрнутое уточнение не молчит: в строке переключателя стоит его содержимое
// («Sunny Court · подъезд 2 · эт. 3 · кв. 5»), чтобы не раскрывать ради
// проверки. Все поля `live`: черновик держит лист, а когда писать — решает он.

const SHORT: { key: keyof AddressParts; label: string }[] = [
  { key: "entrance", label: "Подъезд" },
  { key: "floor", label: "Этаж" },
  { key: "apartment", label: "Квартира" },
];

export function AddressDetailsToggle({
  open,
  summary,
  onToggle,
}: {
  open: boolean;
  /** Что уже заполнено — подпись свёрнутой строки (см. composeDetails). */
  summary: string;
  onToggle: () => void;
}) {
  const t = useThemeColors();
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onToggle();
      }}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={summary ? `Уточнение: ${summary}` : "Уточнение"}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        minHeight: 48,
        paddingHorizontal: 16,
        gap: 12,
        borderTopWidth: 1,
        borderTopColor: t.separator,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 16, color: t.ink }}>
        Уточнение
      </Text>
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={{ flex: 1, textAlign: "right", fontSize: 15, color: t.sub }}
      >
        {open ? "" : summary}
      </Text>
      <Chevron color={t.faint} size={ICON.sm} strokeWidth={2.2} />
    </Pressable>
  );
}

export function AddressDetailsFields({
  parts,
  onChange,
  onEditEnd,
  pin,
  onPinChange,
  onPinEditEnd,
}: {
  /** Уточнение — части без улицы (см. withoutStreet). */
  parts: AddressParts;
  onChange: (next: AddressParts) => void;
  /** Уход с любого поля — момент записи у правки объекта. */
  onEditEnd?: () => void;
  /** Ссылка на карту (пин) — сырой ввод; проверяет вызывающая сторона. */
  pin: string;
  onPinChange: (next: string) => void;
  onPinEditEnd?: () => void;
}) {
  const set = (key: keyof AddressParts) => (value: string) =>
    onChange({ ...parts, [key]: value });
  return (
    <>
      <FieldRow
        label="Комплекс"
        value={parts.complex ?? ""}
        placeholder=""
        stacked
        separated
        live
        onSave={set("complex")}
        onEditEnd={onEditEnd}
      />
      <View style={{ flexDirection: "row" }}>
        {SHORT.map((field) => (
          <View key={field.key} style={{ flex: 1 }}>
            <FieldRow
              label={field.label}
              value={parts[field.key] ?? ""}
              placeholder=""
              stacked
              separated
              live
              onSave={set(field.key)}
              onEditEnd={onEditEnd}
            />
          </View>
        ))}
      </View>
      <FieldRow
        label="Город"
        value={parts.city ?? ""}
        placeholder=""
        stacked
        separated
        live
        autoCapitalize="words"
        onSave={set("city")}
        onEditEnd={onEditEnd}
      />
      <FieldRow
        label="Индекс"
        value={parts.zip ?? ""}
        placeholder=""
        stacked
        separated
        live
        keyboardType="numbers-and-punctuation"
        onSave={set("zip")}
        onEditEnd={onEditEnd}
      />
      <FieldRow
        label="Ссылка на карту"
        value={pin}
        placeholder=""
        stacked
        separated
        live
        keyboardType="url"
        autoCapitalize="none"
        onSave={onPinChange}
        onEditEnd={onPinEditEnd}
      />
    </>
  );
}
