import { Pressable, Text, View } from "react-native";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import type { AddressParts } from "@babun/shared/local/clients";
import { FieldRow } from "@/components/ui/card-rows";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ТОЧНЫЙ АДРЕС — «МИНИ-ДОП» ПОД ГЛАВНОЙ СТРОКОЙ (владелец 2026-09-06:
// «основное — это адрес или ссылка на карту; уточнение можно раскрыть и
// свернуть обратно»; слово «уточнение» владелец отверг — канцелярит).
// Главная строка «Адрес или ссылка на карту» живёт в листе и стоит первой;
// здесь — переключатель «Точный адрес» и его поля: комплекс; подъезд · этаж ·
// квартира; город · индекс; ссылка на карту (только когда главная строка —
// текст: ссылку в главной строке пин дублировал бы). Улицы и дома среди
// полей НЕТ — это и есть главная строка.
//
// Свёрнутая строка не молчит: справа стоит её содержимое («Sunny Court ·
// подъезд 2 · эт. 3 · кв. 5»), обрезанное с НАЧАЛА — хвост «эт. 3 · кв. 5»
// мастеру нужнее названия комплекса. Все поля `live`: черновик держит лист.

export const ADDRESS_DETAILS_LABEL = "Точный адрес";

const SHORT: { key: keyof AddressParts; label: string }[] = [
  { key: "entrance", label: "Подъезд" },
  { key: "floor", label: "Этаж" },
  { key: "apartment", label: "Квартира" },
];

/** Волосяной разделитель между полями одной строки: без него три подписи
 *  висят в воздухе и не читаются как три поля. */
function Hairline() {
  const t = useThemeColors();
  return <View style={{ width: 1, backgroundColor: t.separator }} />;
}

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
      accessibilityLabel={
        summary ? `${ADDRESS_DETAILS_LABEL}: ${summary}` : ADDRESS_DETAILS_LABEL
      }
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
      <Text
        maxFontSizeMultiplier={1.2}
        style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
      >
        {ADDRESS_DETAILS_LABEL}
      </Text>
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        ellipsizeMode="head"
        style={{
          flex: 1,
          textAlign: "right",
          fontSize: 15,
          fontWeight: "500",
          color: t.ink,
        }}
      >
        {open ? "" : summary}
      </Text>
      <Chevron color={t.chevron} size={17} strokeWidth={2.2} />
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
  showPin,
}: {
  /** Точный адрес — части без улицы (см. withoutStreet). */
  parts: AddressParts;
  onChange: (next: AddressParts) => void;
  /** Уход с любого поля — момент записи у правки объекта. */
  onEditEnd?: () => void;
  /** Ссылка на карту (пин) — сырой ввод; проверяет вызывающая сторона. */
  pin: string;
  onPinChange: (next: string) => void;
  onPinEditEnd?: () => void;
  /** Поле пина показывают, только когда главная строка — текст. */
  showPin: boolean;
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
        {SHORT.map((field, i) => (
          <View key={field.key} style={{ flex: 1, flexDirection: "row" }}>
            {i > 0 ? <Hairline /> : null}
            <View style={{ flex: 1 }}>
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
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row" }}>
        <View style={{ flex: 2 }}>
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
        </View>
        <Hairline />
        <View style={{ flex: 1 }}>
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
        </View>
      </View>
      {showPin ? (
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
      ) : null}
    </>
  );
}
