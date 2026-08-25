import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { DateTimeInput } from "@/components/ui/DateTimeInput";
import { useLocalSearchParams, useRouter } from "expo-router";
import { DEFAULT_CALENDAR_SETTINGS } from "@babun/shared/local/calendar-settings";
import {
  getDayScheduleForDate,
  setDateOverride,
  type DaySchedule,
  type TeamSchedule,
} from "@babun/shared/local/schedule";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { ActionRow } from "@/components/ui/card-rows";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { TimeField } from "@/components/ui/TimeField";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import { useCalendarSettings } from "@/features/settings/local-settings";
import {
  useTeamSchedule,
  useUpsertTeamSchedule,
} from "@/features/reference/team-schedule";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import {
  addHourHM,
  isDateKey,
  specialDayLabel,
  subHourHM,
} from "@/features/calendar/schedule-days";
import {
  effectiveWorkHours,
  hourLabel,
} from "@/features/calendar/setting-options";
import { BreaksSection } from "@/features/calendar/BreaksSection";
import { SavedIndicator } from "@/features/calendar/SavedIndicator";
import { notify } from "@/lib/notify";

// Редактор ОСОБОГО ДНЯ — графика одной конкретной даты: смена короче,
// другие часы или выходной. Зеркало редактора дня недели ([weekday].tsx):
// та же страница-настройка, тот же instant-commit, тот же принцип «просмотр
// ничего не материализует — оверрайд создаёт первая ПРАВКА».
//
// Дата живёт в URL: /calendar/[teamId]/date/2026-08-22. Смена даты — это
// setParams, а не второй экран; если оверрайд уже создан, он ПЕРЕЕЗЖАЕТ на
// новую дату (намерение «этот особый день вообще-то 23-го», а не «и там и
// там»).

export default function SpecialDayEditorScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { teamId, date } = useLocalSearchParams<{
    teamId: string;
    date: string;
  }>();
  const { data: settings } = useCalendarSettings();
  const { data: schedule, isLoading } = useTeamSchedule(teamId);
  const upsert = useUpsertTeamSchedule();
  const [savedTick, setSavedTick] = useState(0);

  const g = settings ?? DEFAULT_CALENDAR_SETTINGS;

  if (!date || !isDateKey(date)) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Особый день" />
        <EmptyState
          title="Такой даты нет"
          action={{
            label: "Назад",
            onPress: () =>
              router.canGoBack()
                ? router.back()
                : router.replace({
                    pathname: "/calendar",
                    params: { team: teamId },
                  }),
          }}
          fill
        />
      </Screen>
    );
  }

  if (isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title={specialDayLabel(date)} />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  // Фолбэк тот же, что на экране графика: без своей строки расписания день
  // красят общие рабочие часы — редактор обязан показывать ДЕЙСТВУЮЩЕЕ.
  const gWork = effectiveWorkHours(g);
  const base: TeamSchedule = schedule ?? {
    start: hourLabel(gWork.start),
    end: hourLabel(gWork.end),
    breaks: [],
  };
  const override = base.date_overrides?.[date];
  const day = getDayScheduleForDate(base, parseYMD(date));

  const commit = (next: TeamSchedule) => {
    if (!teamId) return;
    upsert.mutate(
      { teamId, schedule: next },
      {
        onSuccess: () => setSavedTick(Date.now()),
        onError: (e) => notify("Ошибка", (e as Error).message),
      },
    );
  };

  const patch = (p: Partial<DaySchedule>) =>
    commit(setDateOverride(base, date, { ...day, ...p }));

  // Конец обязан быть позже начала — та же минимальная починка пары, что в
  // редакторе дня недели: двигаем границу, которую сейчас не трогают.
  const setStart = (v: string) =>
    patch({ start: v, end: day.end <= v ? addHourHM(v) : day.end });
  const setEnd = (v: string) =>
    patch({ start: v <= day.start ? subHourHM(v) : day.start, end: v });

  const moveTo = (nextDate: string) => {
    if (nextDate === date) return;
    if (override) {
      commit(
        setDateOverride(setDateOverride(base, date, null), nextDate, override),
      );
    }
    router.setParams({ date: nextDate });
  };

  const reset = () => {
    commit(setDateOverride(base, date, null));
    if (router.canGoBack()) router.back();
    // Страницы «Рабочий график» больше нет: график правится листом на экране
    // настроек календаря (2026-08-17), поэтому запасной путь ведёт туда.
    else router.replace({ pathname: "/calendar", params: { team: teamId } });
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title={specialDayLabel(date)}
        subtitle="Особый день"
        right={<SavedIndicator tick={savedTick} />}
      />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <SectionCard className="mt-4">
          {/* Дата — компактным нативным пикером прямо в строке, как ставится
              любая дата в продукте (операция, инвойс). Пикер рождается со
              значением из URL — ловушка «1 янв. 1970» (см. InvoiceDateRow)
              сюда не достаёт: без валидного ключа экран не рендерится. */}
          <View
            style={{
              minHeight: 48,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 16,
              paddingVertical: 6,
            }}
          >
            <Text style={{ fontSize: 16, color: t.ink }}>Дата</Text>
            <DateTimeInput
              value={parseYMD(date)}
              mode="date"
              display="compact"
              themeVariant="light"
              locale="ru-RU"
              accessibilityLabel="Дата особого дня"
              onChange={(_, d) => d && moveTo(formatYMD(d))}
            />
          </View>
          <Divider inset={16} />
          <SwitchRow
            label="Рабочий день"
            value={day.is_working}
            onChange={(v) => patch({ is_working: v })}
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

        {day.is_working ? (
          <BreaksSection
            dayStart={day.start}
            dayEnd={day.end}
            breaks={day.breaks}
            onChange={(next) => patch({ breaks: next })}
          />
        ) : null}

        {override ? (
          <SectionCard className="mt-6">
            {/* Своя вёрстка кнопки здесь была последней: сброс — это ряд-
                действие над сущностью, и он выглядит `ActionRow`, как «Убрать
                перерыв» и «Удалить объект». */}
            <ActionRow label="Вернуть обычный график" onPress={reset} />
          </SectionCard>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
