import { useState } from "react";
import { Alert, Pressable, ScrollView, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { DEFAULT_CALENDAR_SETTINGS } from "@babun/shared/local/calendar-settings";
import type { TeamSchedule } from "@babun/shared/local/schedule";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionFooter } from "@/components/ui/SectionFooter";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { TimeField } from "@/components/ui/TimeField";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useTeamSchedule, useUpsertTeamSchedule } from "@/features/reference/team-schedule";
import {
  addHourHM,
  dayOf,
  isWeekdayKey,
  subHourHM,
  WEEKDAY_FULL,
  withDay,
  withHoursEverywhere,
} from "@/features/calendar/schedule-days";
import {
  effectiveWorkHours,
  hourLabel,
} from "@/features/calendar/setting-options";
import { BreaksSection } from "@/features/calendar/BreaksSection";
import { SavedIndicator } from "@/features/calendar/SavedIndicator";

// Редактор одного дня недели. Минуты здесь реальны (смена до 15:30), поэтому
// время вводится нативным пикером — тем же, что в форме записи.
//
// «Применить ко всем дням» — не роскошь: без него настройка графика с нуля
// это семь заходов в семь экранов.

export default function WeekdayEditorScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { teamId, weekday } = useLocalSearchParams<{
    teamId: string;
    weekday: string;
  }>();
  const { data: settings } = useCalendarSettings();
  const { data: schedule, isLoading } = useTeamSchedule(teamId);
  const upsert = useUpsertTeamSchedule();
  const [savedTick, setSavedTick] = useState(0);

  const g = settings ?? DEFAULT_CALENDAR_SETTINGS;

  if (!weekday || !isWeekdayKey(weekday)) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="День" />
        <EmptyState
          title="Такого дня нет"
          action={{
            label: "Назад",
            onPress: () =>
              router.canGoBack()
                ? router.back()
                : router.replace(`/calendar/${teamId}/schedule`),
          }}
          fill
        />
      </Screen>
    );
  }

  if (isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title={WEEKDAY_FULL[weekday]} />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  // Тот же общий резолвер, что на экране графика и в сетке — три разных
  // фолбэка давали три разных ответа про одно значение.
  const gWork = effectiveWorkHours(g);
  const base: TeamSchedule = schedule ?? {
    start: hourLabel(gWork.start),
    end: hourLabel(gWork.end),
    breaks: [],
  };
  const day = dayOf(base, weekday);

  const commit = (next: TeamSchedule) => {
    if (!teamId) return;
    upsert.mutate(
      { teamId, schedule: next },
      {
        onSuccess: () => setSavedTick(Date.now()),
        onError: (e) => Alert.alert("Ошибка", (e as Error).message),
      },
    );
  };

  // Конец обязан быть позже начала: пару «20:00–09:00» сетка молча отвергает
  // (workBand undefined → красит ОБЩИМИ часами), и настройка дня просто не
  // действует. Двигаем ту границу, которую сейчас не трогают.
  const setStart = (v: string) => {
    const next = withDay(base, weekday, { start: v });
    const d = dayOf(next, weekday);
    commit(
      d.end <= v ? withDay(next, weekday, { end: addHourHM(v) }) : next,
    );
  };
  const setEnd = (v: string) => {
    const next = withDay(base, weekday, { end: v });
    const d = dayOf(next, weekday);
    commit(
      v <= d.start ? withDay(next, weekday, { start: subHourHM(v) }) : next,
    );
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title={WEEKDAY_FULL[weekday]}
        subtitle="Рабочий график"
        right={<SavedIndicator tick={savedTick} />}
      />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <SectionCard className="mt-4">
          <SwitchRow
            label="Рабочий день"
            value={day.is_working}
            onChange={(v) => commit(withDay(base, weekday, { is_working: v }))}
          />
          {day.is_working ? (
            <>
              <Divider inset={16} />
              <TimeField label="Начало" value={day.start} onChange={setStart} />
              <Divider inset={16} />
              <TimeField label="Конец" value={day.end} onChange={setEnd} />
            </>
          ) : null}
        </SectionCard>
        <SectionFooter>
          {day.is_working
            ? "Вне этих часов сетка серая. Записи ставить можно — приложение просто предупредит."
            : "В выходной сетка без рабочей полосы. Записать клиента всё равно можно."}
        </SectionFooter>

        {day.is_working ? (
          <BreaksSection
            dayStart={day.start}
            dayEnd={day.end}
            breaks={day.breaks}
            onChange={(next) => commit(withDay(base, weekday, { breaks: next }))}
          />
        ) : null}

        {day.is_working ? (
          <>
            <SectionCard className="mt-6">
              <Pressable
                onPress={() =>
                  commit(withHoursEverywhere(base, day.start, day.end))
                }
                accessibilityRole="button"
                accessibilityLabel="Применить эти часы ко всем дням"
                style={({ pressed }) => ({
                  minHeight: 48,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  backgroundColor: pressed ? t.pressed : "transparent",
                })}
              >
                <Text style={{ fontSize: 16, color: t.accent }}>
                  Применить ко всем дням
                </Text>
              </Pressable>
            </SectionCard>
            <SectionFooter>
              {`Поставит ${day.start}–${day.end} во все рабочие дни. Выходные останутся выходными.`}
            </SectionFooter>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
