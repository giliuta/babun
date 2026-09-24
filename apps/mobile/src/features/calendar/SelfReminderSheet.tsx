import { useState } from "react";
import { Text, View } from "react-native";
import { Bell, CalendarClock } from "lucide-react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { FieldLabel } from "@/components/ui/Field";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { LoopWheelColumn, TimeWheelPair } from "@/components/ui/TimeWheel";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { GUTTER } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import {
  SELF_REMINDER_PRESETS,
  sameSelfReminder,
  selfReminderLabel,
  type SelfReminder,
} from "@/features/calendar/reminder-time";

// «НАПОМНИТЬ» — ПУШ СЕБЕ О ЗАПИСИ ИЛИ СОБЫТИИ (владелец 2026-09-24: «колокольчик
// вверху справа рядом с цветом; открывается снизу менюшка — напомнить за
// какое-то время, за 24 часа, или свой диапазон: дни и время»).
//
// Готовые варианты — одним тапом, как любой одиночный выбор; повторный тап по
// выбранному снимает напоминание (тот же жест, что у типа события). «Своё
// время» раскрывает два барабана — за сколько дней и во сколько — и одну
// кнопку «Напомнить» в футере.

const MAX_DAYS = 30;
const DAYS = Array.from({ length: MAX_DAYS + 1 }, (_, i) => String(i));

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
  /** «пт, 26 сентября, 10:00» — о чём напоминаем. */
  subtitle?: string;
  /** Выбор или снятие (`null`). Лист закрывает вызывающий. */
  onPick: (rule: SelfReminder | null) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const isPreset = value != null && SELF_REMINDER_PRESETS.some((p) => sameSelfReminder(p, value));
  const [custom, setCustom] = useState(false);
  const [days, setDays] = useState(1);
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  // Лист открылся со своим правилом «за N дней в ЧЧ:ММ» — барабаны на нём.
  const [seeded, setSeeded] = useState<string | null>(null);
  const seedKey = visible ? JSON.stringify(value) : null;
  if (seedKey !== seeded) {
    setSeeded(seedKey);
    if (visible && value && !isPreset && value.kind === "dayAt") {
      const [h, m] = value.time.split(":").map(Number);
      setDays(value.daysBefore);
      setHour(h || 0);
      setMinute(m || 0);
      setCustom(true);
    } else if (visible) {
      setCustom(false);
    }
  }

  const pickPreset = (rule: SelfReminder) => {
    haptics.tap();
    onPick(sameSelfReminder(rule, value) ? null : rule);
  };

  const customRule: SelfReminder = {
    kind: "dayAt",
    daysBefore: days,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Напомнить"
      subtitle={subtitle}
      padded={false}
      scroll
      footer={
        custom ? (
          // Лист без внутренних полей (`padded={false}` — строки выбора во всю
          // ширину), поэтому кнопке поля даём сами, как в шторке времени.
          <View style={{ paddingHorizontal: GUTTER }}>
            <Button
              label="Напомнить"
              onPress={() => {
                haptics.tap();
                onPick(customRule);
              }}
            />
          </View>
        ) : undefined
      }
    >
      <SelectList>
        {SELF_REMINDER_PRESETS.map((rule) => (
          <SelectRow
            key={selfReminderLabel(rule)}
            icon={Bell}
            color={SETTINGS_TILE.yellow}
            title={selfReminderLabel(rule)}
            selected={sameSelfReminder(rule, value)}
            accessibilityRole="radio"
            onPress={() => pickPreset(rule)}
          />
        ))}
        <SelectRow
          icon={CalendarClock}
          color={SETTINGS_TILE.indigo}
          title="Своё время"
          subtitle={
            value && !isPreset ? selfReminderLabel(value) : undefined
          }
          selected={custom || (value != null && !isPreset)}
          onPress={() => {
            haptics.tap();
            setCustom((open) => !open);
          }}
        />
      </SelectList>

      {custom ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 24 }}>
            <View style={{ alignItems: "center" }}>
              <FieldLabel text="За дней" />
              <LoopWheelColumn
                items={DAYS}
                value={days}
                onChange={setDays}
                accessibilityLabel="За сколько дней"
              />
            </View>
            <View style={{ alignItems: "center" }}>
              <FieldLabel text="Во сколько" />
              <TimeWheelPair
                hour={hour}
                minute={minute}
                onChangeHour={setHour}
                onChangeMinute={setMinute}
                labelPrefix="Во сколько"
              />
            </View>
          </View>
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ textAlign: "center", marginTop: 8, fontSize: 15, fontWeight: "600", color: t.ink }}
          >
            {selfReminderLabel(customRule)}
          </Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}
