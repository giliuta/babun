import { useState } from "react";
import { Text, View } from "react-native";
import { Bell, Clock } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { FieldLabel } from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { LoopWheelColumn, TimeWheelPair } from "@/components/ui/TimeWheel";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { GUTTER } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import {
  SELF_REMINDER_AT_PRESETS,
  SELF_REMINDER_BEFORE_PRESETS,
  reminderDayLabel,
  sameSelfReminder,
  selfReminderLabel,
  type SelfReminder,
} from "@/features/calendar/reminder-time";

// «НАПОМНИТЬ» — ПУШ СЕБЕ О ЗАПИСИ ИЛИ СОБЫТИИ (владелец 2026-09-24).
//
// ДВА РЕЖИМА (владелец: «либо напоминание в указанное время, либо за какое-то
// время — допустим за 24 часа, или напомнить в 10:00»):
//   «Заранее»    — за сколько до начала: готовые сроки + барабаны дни · часы ·
//                  минуты;
//   «Ко времени» — в какой день и во сколько: готовые + барабаны день · время.
// Готовый вариант ставится тапом (повторный тап снимает), свой — кнопкой
// «Напомнить» в футере. Итог словами стоит над кнопкой.

type Mode = "before" | "at";

const DAYS_MAX = 30;
const DAY_NUMBERS = Array.from({ length: DAYS_MAX + 1 }, (_, i) => String(i));
const DAY_LABELS = Array.from({ length: DAYS_MAX + 1 }, (_, i) => reminderDayLabel(i));

export function SelfReminderSheet({
  visible,
  value,
  subtitle,
  onPick,
  onClose,
}: {
  visible: boolean;
  /** Что стоит сейчас; `null` — не напоминать. */
  value: SelfReminder | null;
  /** «Запись · 25.09, 10:00» — о чём напоминаем. */
  subtitle?: string;
  /** Выбор или снятие (`null`). Лист закрывает вызывающий. */
  onPick: (rule: SelfReminder | null) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const [mode, setMode] = useState<Mode>("before");
  // «Заранее»: дни, часы, минуты до начала.
  const [bDays, setBDays] = useState(0);
  const [bHours, setBHours] = useState(1);
  const [bMinutes, setBMinutes] = useState(0);
  // «Ко времени»: за сколько дней и во сколько.
  const [aDays, setADays] = useState(0);
  const [aHour, setAHour] = useState(10);
  const [aMinute, setAMinute] = useState(0);

  // Лист открылся — режим и барабаны встают на то, что стоит.
  const [seeded, setSeeded] = useState<string | null>(null);
  const seedKey = visible ? JSON.stringify(value) : null;
  if (seedKey !== seeded) {
    setSeeded(seedKey);
    if (visible && value?.kind === "before") {
      setMode("before");
      setBDays(Math.floor(value.minutes / 1440));
      setBHours(Math.floor((value.minutes % 1440) / 60));
      setBMinutes(value.minutes % 60);
    } else if (visible && value?.kind === "dayAt") {
      const [h, m] = value.time.split(":").map(Number);
      setMode("at");
      setADays(value.daysBefore);
      setAHour(h || 0);
      setAMinute(m || 0);
    }
  }

  const custom: SelfReminder =
    mode === "before"
      ? { kind: "before", minutes: bDays * 1440 + bHours * 60 + bMinutes }
      : {
          kind: "dayAt",
          daysBefore: aDays,
          time: `${String(aHour).padStart(2, "0")}:${String(aMinute).padStart(2, "0")}`,
        };
  const presets = mode === "before" ? SELF_REMINDER_BEFORE_PRESETS : SELF_REMINDER_AT_PRESETS;
  // «За 0 минут» — не напоминание: кнопка молчит, пока срок нулевой.
  const customValid = custom.kind === "dayAt" || custom.minutes > 0;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Напомнить"
      subtitle={subtitle}
      padded={false}
      scroll
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          <Button
            label="Напомнить"
            disabled={!customValid}
            onPress={() => {
              haptics.tap();
              onPick(custom);
            }}
          />
        </View>
      }
    >
      <View style={{ paddingHorizontal: GUTTER, paddingBottom: 10 }}>
        <SegmentedControl
          options={[
            { value: "before", label: "Заранее" },
            { value: "at", label: "Ко времени" },
          ]}
          value={mode}
          onChange={(next) => {
            haptics.tap();
            setMode(next);
          }}
        />
      </View>

      <SelectList>
        {presets.map((rule) => (
          <SelectRow
            key={selfReminderLabel(rule)}
            icon={mode === "before" ? Bell : Clock}
            color={SETTINGS_TILE.yellow}
            title={selfReminderLabel(rule)}
            selected={sameSelfReminder(rule, value)}
            accessibilityRole="radio"
            onPress={() => {
              haptics.tap();
              onPick(sameSelfReminder(rule, value) ? null : rule);
            }}
          />
        ))}
      </SelectList>

      <View style={{ paddingHorizontal: GUTTER, paddingTop: 14, paddingBottom: 4 }}>
        {mode === "before" ? (
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 20 }}>
            <View style={{ alignItems: "center" }}>
              <FieldLabel text="Дней" />
              <LoopWheelColumn
                items={DAY_NUMBERS}
                value={bDays}
                onChange={setBDays}
                accessibilityLabel="За сколько дней"
              />
            </View>
            <View style={{ alignItems: "center" }}>
              <FieldLabel text="Часов и минут" />
              <TimeWheelPair
                hour={bHours}
                minute={bMinutes}
                onChangeHour={setBHours}
                onChangeMinute={setBMinutes}
                labelPrefix="За"
                units
              />
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 16 }}>
            <View style={{ alignItems: "center" }}>
              <FieldLabel text="День" />
              <LoopWheelColumn
                items={DAY_LABELS}
                value={aDays}
                onChange={setADays}
                width={150}
                fontSize={17}
                accessibilityLabel="В какой день"
              />
            </View>
            <View style={{ alignItems: "center" }}>
              <FieldLabel text="Во сколько" />
              <TimeWheelPair
                hour={aHour}
                minute={aMinute}
                onChangeHour={setAHour}
                onChangeMinute={setAMinute}
                labelPrefix="Во сколько"
              />
            </View>
          </View>
        )}
        <Text
          maxFontSizeMultiplier={1.3}
          style={{
            textAlign: "center",
            marginTop: 10,
            fontSize: 15,
            fontWeight: "600",
            color: customValid ? t.ink : t.faint,
          }}
        >
          {customValid ? selfReminderLabel(custom) : "Выберите срок"}
        </Text>
      </View>
    </BottomSheet>
  );
}
