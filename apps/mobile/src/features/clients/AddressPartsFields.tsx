import { View } from "react-native";
import type { AddressParts } from "@babun/shared/local/clients";
import { FieldRow } from "@/components/ui/card-rows";

// ПОЛЯ УТОЧНЕНИЯ АДРЕСА — ОДНИ НА ДОБАВЛЕНИЕ И ПРАВКУ ОБЪЕКТА (владелец
// 2026-09-06: «полноценно прописать город, улицу, дом, подъезд, квартиру,
// индекс — как на доставке»). Порядок — как заполняют: сперва «где» (улица и
// дом, комплекс), потом «куда внутри» (подъезд · этаж · квартира одной
// строкой — три коротких числа не заслуживают трёх строк по 60pt), потом
// город и индекс. Ссылка на карту — последней: пин у объекта с частями живёт
// здесь, а не в строке «адрес или ссылка», которой в этом режиме нет.
//
// Все поля `live`: черновик держит лист, а когда писать — решает он сам
// (правка — на уходе с поля, добавление — по кнопке).

const SHORT: { key: keyof AddressParts; label: string }[] = [
  { key: "entrance", label: "Подъезд" },
  { key: "floor", label: "Этаж" },
  { key: "apartment", label: "Квартира" },
];

export function AddressPartsFields({
  parts,
  onChange,
  onEditEnd,
  pin,
  onPinChange,
  onPinEditEnd,
}: {
  parts: AddressParts;
  onChange: (next: AddressParts) => void;
  /** Уход с любого поля частей — момент записи у правки объекта. */
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
        label="Улица и дом"
        value={parts.street ?? ""}
        placeholder=""
        stacked
        live
        onSave={set("street")}
        onEditEnd={onEditEnd}
      />
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
