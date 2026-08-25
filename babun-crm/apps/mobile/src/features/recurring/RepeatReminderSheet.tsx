import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { addMonthsYYYYMMDD } from "@babun/shared/local/recurring";
import {
  formatDateLongRu,
  formatDateShortRu,
} from "@babun/shared/common/utils/date-utils";
import { Button } from "@/components/ui/Button";
import { useThemeColors } from "@/theme/colors";

// «Повторить через…» — RN-порт web RepeatReminderSheet.tsx: центрированный
// попап (по продуктовому правилу — не bottom sheet) с интервалами ТО для
// выездного сервиса. Смонтирован в AppointmentSheet (кнопка «Повторить
// через…» у ЗАВЕРШЁННОЙ записи; web: ClientActionMenu → AppointmentSubSheets)
// и сеет recurring-reminder через useCreateReminder — инбокс возвратов
// живёт на экране «Повторяющиеся ТО» (cabinet/recurring).

const PRESETS: { months: number; label: string; hint: string }[] = [
  { months: 3, label: "Через 3 мес", hint: "фильтр, быстрая чистка" },
  { months: 6, label: "Через 6 мес", hint: "сезонная чистка" },
  { months: 12, label: "Через 1 год", hint: "годовое обслуживание" },
];

export function RepeatReminderSheet({
  visible,
  clientName,
  serviceSummary,
  lastDate,
  busy,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  clientName: string;
  serviceSummary: string;
  /** YYYY-MM-DD визита, который сеет напоминание. */
  lastDate: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (months: number, note: string) => void;
}) {
  const t = useThemeColors();
  const [months, setMonths] = useState(6);
  const [note, setNote] = useState("");
  const [wasVisible, setWasVisible] = useState(false);

  if (visible !== wasVisible) {
    // Сброс черновика на каждое открытие (render-time reset).
    setWasVisible(visible);
    if (visible) {
      setMonths(6);
      setNote("");
    }
  }

  const nextDate = useMemo(
    () => addMonthsYYYYMMDD(lastDate, months),
    [lastDate, months],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          className="flex-1 items-center justify-center px-6"
          style={{ backgroundColor: t.scrim }}
          onPress={onClose}
          // The explicit «Отмена» button below is the VoiceOver dismissal
          // path. Keeping the scrim out of the accessibility tree prevents
          // it from grouping the whole form into one giant button.
          accessible={false}
        >
          <Pressable
            // Останавливает закрытие по тапу внутри карточки.
            onPress={() => {}}
            accessible={false}
            className="w-full max-w-[360px] overflow-hidden rounded-[10px]"
            style={{ backgroundColor: t.surface }}
          >
            <View className="border-b px-5 pb-3 pt-4" style={{ borderColor: t.separator }}>
              <Text
                className="text-[11px] font-bold uppercase tracking-wider"
                style={{ color: t.faint }}
              >
                Напомнить о повторе
              </Text>
              <Text
                className="mt-1 text-lg font-semibold"
                style={{ color: t.ink }}
                numberOfLines={1}
              >
                {clientName}
              </Text>
              {serviceSummary ? (
                <Text className="mt-0.5 text-sm" style={{ color: t.sub }} numberOfLines={1}>
                  {serviceSummary}
                </Text>
              ) : null}
            </View>

            <View className="gap-2 px-4 pb-2 pt-3">
              {PRESETS.map((p) => {
                const active = months === p.months;
                return (
                  <Pressable
                    key={p.months}
                    onPress={() => setMonths(p.months)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={p.label}
                    className="flex-row items-center justify-between rounded-[10px] border px-3 py-3"
                    style={{
                      minHeight: 48,
                      borderColor: active ? t.accent : t.separator,
                      backgroundColor: active
                        ? "rgba(44,91,224,0.10)"
                        : t.surface,
                    }}
                  >
                    <View>
                      <Text className="text-base font-semibold" style={{ color: t.ink }}>
                        {p.label}
                      </Text>
                      <Text className="text-xs" style={{ color: t.sub }}>
                        {p.hint}
                      </Text>
                    </View>
                    <Text className="text-xs font-medium" style={{ color: t.faint }}>
                      {formatDateShortRu(addMonthsYYYYMMDD(lastDate, p.months))}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View className="px-4 pb-2 pt-1">
              <Text
                className="mb-1 text-[11px] font-bold uppercase tracking-wider"
                style={{ color: t.faint }}
              >
                Заметка (необязательно)
              </Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="например: проверить пульт"
                placeholderTextColor={t.placeholder}
                selectionColor={t.accent}
                keyboardAppearance="light"
                className="rounded-[10px] px-3.5 py-2.5 text-base"
                style={{
                  color: t.ink,
                  backgroundColor: t.fill,
                }}
                accessibilityLabel="Заметка к напоминанию"
              />
            </View>

            <Text className="px-4 pb-2 pt-1 text-center text-sm" style={{ color: t.sub }}>
              Напомним{" "}
              <Text style={{ fontWeight: "600", color: t.ink }}>
                {formatDateLongRu(nextDate)}
              </Text>
            </Text>

            <View className="flex-row gap-2 px-4 pb-4">
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Отмена"
                className="h-11 flex-1 items-center justify-center rounded-[10px] active:opacity-70"
                style={{ backgroundColor: t.fill }}
              >
                <Text className="text-base font-medium" style={{ color: t.ink }}>
                  Отмена
                </Text>
              </Pressable>
              <View className="flex-1">
                <Button
                  label="Создать"
                  onPress={() => {
                    onConfirm(months, note.trim());
                    onClose();
                  }}
                  disabled={busy}
                  loading={busy}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
