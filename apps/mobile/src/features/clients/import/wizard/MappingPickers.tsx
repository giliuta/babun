import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { Check, ChevronDown } from "lucide-react-native";
import type { useThemeColors } from "@/theme/colors";
import { FIELD_LABEL, FIELD_OPTIONS, type ImportableField } from "../csv-mapping";

export function FieldPicker({
  t,
  value,
  onChange,
}: {
  t: ReturnType<typeof useThemeColors>;
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
        className="min-h-11 flex-row items-center gap-1 rounded-[10px] px-3 py-2 active:opacity-70"
        style={{ backgroundColor: t.fill }}
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
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View
          className="flex-1 items-center justify-center px-8"
          style={{ backgroundColor: t.scrim }}
        >
          <Pressable
            className="absolute inset-0"
            onPress={() => setOpen(false)}
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <View
            className="w-full overflow-hidden rounded-[10px]"
            style={{ backgroundColor: t.surface }}
          >
            {FIELD_OPTIONS.map((f, i) => {
              const active = f === value;
              return (
                <Pressable
                  key={f}
                  onPress={() => {
                    onChange(f);
                    setOpen(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={FIELD_LABEL[f]}
                  className="min-h-11 flex-row items-center gap-2 px-4 py-3 active:opacity-70"
                  style={
                    i < FIELD_OPTIONS.length - 1
                      ? { borderBottomWidth: 1, borderBottomColor: t.separator }
                      : undefined
                  }
                >
                  <Text
                    className="flex-1 text-[15px]"
                    style={{ color: t.ink, fontWeight: active ? "700" : "400" }}
                  >
                    {FIELD_LABEL[f]}
                  </Text>
                  {active ? <Check color={t.accent} size={18} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
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
