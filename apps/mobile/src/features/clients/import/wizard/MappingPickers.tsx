import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { ValuePickerSheet } from "@/components/ui/ValuePickerSheet";
import type { useThemeColors } from "@/theme/colors";
import { FIELD_LABEL, FIELD_OPTIONS, type ImportableField } from "../csv-mapping";

// ВЫБОР ПОЛЯ — КАНОНИЧЕСКОЙ ШТОРКОЙ (`ValuePickerSheet`), а не своим окном по
// центру: тап выбирает и закрывает, выбранное отмечено, как у любого выбора
// из справочника. Заголовок — сама колонка файла: человек видит, что
// сопоставляет.
export function FieldPicker({
  t,
  column,
  value,
  onChange,
}: {
  t: ReturnType<typeof useThemeColors>;
  /** Название колонки файла — заголовок шторки. */
  column: string;
  value: ImportableField;
  onChange: (f: ImportableField) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Поле: ${FIELD_LABEL[value]}`}
        className="min-h-11 flex-row items-center gap-1 px-3 py-2 active:opacity-70"
        style={{ backgroundColor: t.fill, borderRadius: t.radius.input }}
      >
        <Text
          className="max-w-[120px] text-[13px] font-medium"
          style={{ color: value === "skip" ? t.faint : t.ink }}
          numberOfLines={1}
        >
          {FIELD_LABEL[value]}
        </Text>
        <ChevronDown color={t.faint} size={14} />
      </Pressable>
      <ValuePickerSheet
        visible={open}
        title={column}
        options={FIELD_OPTIONS.map((f) => ({ id: f, label: FIELD_LABEL[f] }))}
        selectedId={value}
        onPick={(id) => {
          if (id) onChange(id as ImportableField);
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

export function TagChip({
  t,
  label,
  color,
  active,
  onPress,
}: {
  t: ReturnType<typeof useThemeColors>;
  label: string;
  color?: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      accessibilityLabel={`Тег ${label}`}
      className="min-h-11 flex-row items-center gap-1.5 rounded-full px-3 py-1.5 active:opacity-70"
      style={{ backgroundColor: active ? t.accent : t.fill }}
    >
      {color ? (
        <View
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
      ) : null}
      <Text
        className="text-[13px] font-semibold"
        style={{ color: active ? "#fff" : t.body }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
