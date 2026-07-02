import { useState } from "react";
import { Alert, Pressable, Switch, Text, View } from "react-native";
import { Minus, Plus } from "lucide-react-native";
import {
  DEFAULT_CALENDAR_SETTINGS,
  type CalendarSettings,
} from "@babun/shared/local/calendar-settings";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Divider } from "@/components/ui/Divider";
import { Button } from "@/components/ui/Button";
import { useThemeColors } from "@/theme/colors";
import {
  useCalendarSettings,
  useSaveCalendarSettings,
} from "@/features/settings/local-settings";

function Row({ label, right }: { label: string; right: React.ReactNode }) {
  const t = useThemeColors();
  return (
    <View className="flex-row items-center justify-between px-1 py-2.5">
      <Text style={{ color: t.ink }} className="text-base">{label}</Text>
      {right}
    </View>
  );
}

function Stepper({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  const t = useThemeColors();
  const chipBg = t.dark ? "rgba(255,255,255,0.07)" : "#eef1f5";
  return (
    <View className="flex-row items-center gap-3">
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        style={{ backgroundColor: chipBg }}
        className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
      >
        <Minus color={t.body} size={16} />
      </Pressable>
      <Text style={{ color: t.ink }} className="w-14 text-center text-base font-semibold tabular-nums">
        {String(value).padStart(2, "0")}:00
      </Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + 1))}
        style={{ backgroundColor: chipBg }}
        className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
      >
        <Plus color={t.body} size={16} />
      </Pressable>
    </View>
  );
}

export default function CalendarSettingsScreen() {
  const t = useThemeColors();
  const { data: settings } = useCalendarSettings();
  const save = useSaveCalendarSettings();
  // Only the fields the user touched. Saving sends THIS object as a
  // targeted patch, so unloaded / web-managed fields can never be pushed
  // as DEFAULT_CALENDAR_SETTINGS; a late query resolve refreshes the base
  // values underneath without discarding unsaved edits.
  const [changes, setChanges] = useState<Partial<CalendarSettings>>({});
  const dirty = Object.keys(changes).length > 0;
  const s: CalendarSettings = {
    ...(settings ?? DEFAULT_CALENDAR_SETTINGS),
    ...changes,
  };

  const patch = (p: Partial<CalendarSettings>) =>
    setChanges((prev) => ({ ...prev, ...p }));

  const chipBg = t.dark ? "rgba(255,255,255,0.07)" : "#eef1f5";

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Календарь" />

      <SectionCard title="Рабочие часы (сетка «День»)" padded>
        <Row
          label="Начало"
          right={
            <Stepper
              value={s.workStartHour ?? 6}
              min={0}
              max={(s.workEndHour ?? 22) - 1}
              onChange={(v) => patch({ workStartHour: v })}
            />
          }
        />
        <Divider />
        <Row
          label="Конец"
          right={
            <Stepper
              value={s.workEndHour ?? 22}
              min={(s.workStartHour ?? 6) + 1}
              max={24}
              onChange={(v) => patch({ workEndHour: v })}
            />
          }
        />
      </SectionCard>

      <SectionCard title="Шаг сетки" padded>
        <View className="flex-row gap-2">
          {([15, 30, 60] as const).map((g) => {
            const active = s.gridStep === g;
            return (
              <Pressable
                key={g}
                onPress={() => patch({ gridStep: g })}
                style={{ backgroundColor: active ? t.accent : chipBg }}
                className="flex-1 items-center rounded-xl py-2.5"
              >
                <Text
                  style={{ color: active ? "#fff" : t.sub }}
                  className="text-sm font-semibold"
                >
                  {g} мин
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SectionCard>

      <SectionCard title="Отображение" padded>
        <Row
          label="Скрывать отменённые"
          right={
            <Switch
              value={!!s.hideCancelled}
              onValueChange={(v) => patch({ hideCancelled: v })}
              trackColor={{ true: t.accent }}
            />
          }
        />
      </SectionCard>

      <View className="mx-3 mt-5">
        <Button
          label="Сохранить"
          onPress={() =>
            save.mutate(changes, {
              onSuccess: () => setChanges({}),
              onError: (e) => Alert.alert("Ошибка", e.message),
            })
          }
          // `!settings` — no saving until the settings query resolved at
          // least once; before that the form shows unconfirmed defaults.
          disabled={!settings || !dirty || save.isPending}
          loading={save.isPending}
        />
      </View>
    </Screen>
  );
}
