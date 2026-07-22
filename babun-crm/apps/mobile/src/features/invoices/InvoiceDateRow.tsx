import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Button } from "@/components/ui/Button";
import { ValueRow } from "@/components/ui/ValueRow";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import { formatInvoiceDate, todayYmd } from "./format";

export function InvoiceDateRow({
  label,
  value,
  optional,
  minimum,
  onChange,
}: {
  label: string;
  value: string | null;
  optional?: boolean;
  minimum?: string;
  onChange: (value: string | null) => void;
}) {
  const t = useThemeColors();
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState(value ?? minimum ?? todayYmd());

  useEffect(() => {
    if (visible) setDraft(value ?? minimum ?? todayYmd());
  }, [visible, value, minimum]);

  return (
    <>
      <ValueRow
        label={label}
        value={value ? formatInvoiceDate(value) : "Не указан"}
        muted={!value}
        onPress={() => setVisible(true)}
      />
      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <View className="flex-1 justify-end" style={{ backgroundColor: t.scrim }}>
          <Pressable
            className="flex-1"
            onPress={() => setVisible(false)}
            accessibilityRole="button"
            accessibilityLabel="Закрыть выбор даты"
          />
          <View className="rounded-t-3xl px-5 pb-8 pt-5" style={{ backgroundColor: t.surface }}>
            <Text className="text-lg font-bold" style={{ color: t.ink }}>
              {label}
            </Text>
            <View className="items-center py-2">
              <DateTimePicker
                value={parseYMD(draft)}
                minimumDate={minimum ? parseYMD(minimum) : undefined}
                mode="date"
                display="spinner"
                locale="ru-RU"
                themeVariant="light"
                onChange={(_, date) => date && setDraft(formatYMD(date))}
              />
            </View>
            <View style={{ gap: 8 }}>
              <Button
                label="Выбрать дату"
                onPress={() => {
                  onChange(draft);
                  setVisible(false);
                }}
              />
              {optional && value ? (
                <Button
                  label="Убрать срок"
                  variant="secondary"
                  onPress={() => {
                    onChange(null);
                    setVisible(false);
                  }}
                />
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
