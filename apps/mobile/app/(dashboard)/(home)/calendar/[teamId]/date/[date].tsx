import { useState } from "react";
import { ScrollView } from "react-native";
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
import { ValueRow } from "@/components/ui/ValueRow";
import { DateWheelSheet } from "@/components/ui/DateWheelSheet";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { useCalendarSettings } from "@/features/settings/local-settings";
import {
  useTeamSchedule,
  useUpsertTeamSchedule,
} from "@/features/reference/team-schedule";
import { parseYMD } from "@/features/appointments/helpers";
import { isDateKey, specialDayLabel } from "@/features/calendar/schedule-days";
import {
  effectiveWorkHours,
  hourLabel,
} from "@/features/calendar/setting-options";
import { BreaksSection } from "@/features/calendar/BreaksSection";
import { HourRangeSheet } from "@/features/calendar/HourRangeSheet";
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
  const router = useRouter();
  const { teamId, date } = useLocalSearchParams<{
    teamId: string;
    date: string;
  }>();
  const { data: settings } = useCalendarSettings();
  const { data: schedule, isLoading } = useTeamSchedule(teamId);
  const upsert = useUpsertTeamSchedule();
  const [savedTick, setSavedTick] = useState(0);
  const [dateOpen, setDateOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);

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
          {/* ДАТА И ЧАСЫ — БАРАБАНОМ (владелец 2026-09-10: «барабан везде»).
              Здесь стоял компактный нативный пикер прямо в строке, а часы —
              двумя такими же: тап по «Указать» не открывал ничего, он лишь
              дорисовывал второй крошечный контрол у правого края, в который
              надо было попасть вторым тапом. Одной рукой в машине это два
              прицельных касания по 30pt вместо одного понятного. */}
          <ValueRow
            label="Дата"
            value={specialDayLabel(date)}
            onPress={() => setDateOpen(true)}
          />
          <Divider inset={16} />
          <SwitchRow
            label="Рабочий день"
            value={day.is_working}
            onChange={(v) => patch({ is_working: v })}
          />
          {day.is_working ? (
            <>
              <Divider inset={16} />
              {/* Пара границ одной строкой и одним листом — тот же
                  `HourRangeSheet`, что у часов календаря и у перерыва. Две
                  строки «Начало» и «Конец» спрашивали дважды об одном. */}
              <ValueRow
                label="Рабочие часы"
                value={`${day.start} – ${day.end}`}
                onPress={() => setHoursOpen(true)}
              />
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

      <DateWheelSheet
        visible={dateOpen}
        title="Дата особого дня"
        value={date}
        onApply={(ymd) => {
          setDateOpen(false);
          moveTo(ymd);
        }}
        onClose={() => setDateOpen(false)}
      />
      <HourRangeSheet
        visible={hoursOpen}
        title="Рабочие часы"
        value={{
          start: hourOf(day.start),
          startMinute: minuteOf(day.start),
          end: hourOf(day.end),
          endMinute: minuteOf(day.end),
        }}
        // Смена заканчивается часом суток, а не их концом.
        allowEndOfDay={false}
        onApply={({ start, end, startMinute, endMinute }) =>
          patch({ start: hm(start, startMinute), end: hm(end, endMinute) })
        }
        onClose={() => setHoursOpen(false)}
      />
    </Screen>
  );
}

/** «HH:MM» → части и обратно. Наружу нужны только строки. */
function hourOf(value: string): number {
  return Number(value.slice(0, 2)) || 0;
}
function minuteOf(value: string): number {
  return Number(value.slice(3, 5)) || 0;
}
function hm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
