import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { DEFAULT_CALENDAR_SETTINGS } from "@babun/shared/local/calendar-settings";
import type { TeamSchedule } from "@babun/shared/local/schedule";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SectionFooter } from "@/components/ui/SectionFooter";
import { AddRow } from "@/components/ui/AddRow";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useTeam } from "@/features/reference/queries";
import { useTeamSchedule } from "@/features/reference/team-schedule";
import { formatYMD } from "@/features/appointments/helpers";
import {
  allDays,
  listSpecialDays,
  specialDayLabel,
  WEEKDAY_FULL,
} from "@/features/calendar/schedule-days";
import {
  effectiveWorkHours,
  hourLabel,
} from "@/features/calendar/setting-options";

// ─── «Рабочий график» ────────────────────────────────────────────────
// Семь дней с ДЕЙСТВУЮЩИМИ значениями. Единственный заслуженный подэкран:
// модель графика — по дням, и плоская пара «Начало/Конец смены» (как было в
// хабе бригады) не может выразить «в субботу до 15:00».

export default function TeamScheduleScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const { data: team } = useTeam(teamId);
  const { data: settings } = useCalendarSettings();
  const { data: schedule, isLoading } = useTeamSchedule(teamId);

  const g = settings ?? DEFAULT_CALENDAR_SETTINGS;

  if (isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Рабочий график" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  // Строки графика ещё нет: сетку красят общие рабочие часы. Показываем ИХ —
  // и первая же правка дня материализует строку из них же, поэтому ничего не
  // «прыгает» после сохранения. Фолбэк берём общим резолвером: свой (?? 6 /
  // ?? 22) показывал бы часы, которых никто не задавал и которые не действуют.
  const gWork = effectiveWorkHours(g);
  const base: TeamSchedule = schedule ?? {
    start: hourLabel(gWork.start),
    end: hourLabel(gWork.end),
    breaks: [],
  };

  const days = allDays(base);
  const inheritedHours = !schedule;
  // Особые дни — только материализованные оверрайды: фолбэк base их не носит.
  const specials = listSpecialDays(schedule);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Рабочий график" subtitle={team?.name} />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <SectionEyebrow>Дни</SectionEyebrow>
        <SectionCard>
          {days.map(({ key, day }, i) => (
            <View key={key}>
              {i > 0 ? <Divider inset={16} /> : null}
              {/* Только навигация. Материализовать строку расписания здесь
                  было бы побочным эффектом ПРОСМОТРА: тапнул день, ничего не
                  изменил, ушёл — а календарь уже навсегда отвязан от общих
                  рабочих часов (workBandFor перестаёт быть undefined, и
                  DayView больше не доходит до фолбэка). Строку создаёт первая
                  ПРАВКА в редакторе дня — ровно как обещает футнот ниже. */}
              <Pressable
                onPress={() => router.push(`/calendar/${teamId}/day/${key}`)}
                accessibilityRole="button"
                accessibilityLabel={`${WEEKDAY_FULL[key]}: ${
                  day.is_working ? `${day.start}–${day.end}` : "выходной"
                }`}
                style={({ pressed }) => ({
                  minHeight: 48,
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  backgroundColor: pressed ? t.pressed : "transparent",
                })}
              >
                <Text style={{ flex: 1, fontSize: 16, color: t.ink }}>
                  {WEEKDAY_FULL[key]}
                </Text>
                <Text
                  style={{
                    fontSize: 16,
                    color: day.is_working && !inheritedHours ? t.ink : t.faint,
                    marginRight: 6,
                  }}
                >
                  {day.is_working ? `${day.start}–${day.end}` : "Выходной"}
                </Text>
                <ChevronRight color={t.chevron} size={ICON.sm} />
              </Pressable>
            </View>
          ))}
        </SectionCard>
        <SectionFooter>
          {inheritedHours
            ? "Пока действуют общие рабочие часы. Измените любой день — и у этого календаря появится свой график."
            : "Вне рабочего времени сетка серая. Записи ставить можно — приложение просто предупредит."}
        </SectionFooter>

        <SectionEyebrow>Особые дни</SectionEyebrow>
        <SectionCard>
          {specials.map(({ dateKey, day }, i) => (
            <View key={dateKey}>
              {i > 0 ? <Divider inset={16} /> : null}
              <Pressable
                onPress={() => router.push(`/calendar/${teamId}/date/${dateKey}`)}
                accessibilityRole="button"
                accessibilityLabel={`${specialDayLabel(dateKey)}: ${
                  day.is_working ? `${day.start}–${day.end}` : "выходной"
                }`}
                style={({ pressed }) => ({
                  minHeight: 48,
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  backgroundColor: pressed ? t.pressed : "transparent",
                })}
              >
                <Text style={{ flex: 1, fontSize: 16, color: t.ink }}>
                  {specialDayLabel(dateKey)}
                </Text>
                <Text
                  style={{
                    fontSize: 16,
                    color: day.is_working ? t.ink : t.faint,
                    marginRight: 6,
                  }}
                >
                  {day.is_working ? `${day.start}–${day.end}` : "Выходной"}
                </Text>
                <ChevronRight color={t.chevron} size={ICON.sm} />
              </Pressable>
            </View>
          ))}
          {/* Дверь создания ведёт в редактор СЕГОДНЯШНЕЙ даты: особый день —
              это правка конкретной даты, и дата на странице меняется первой
              же строкой. Отдельного экрана «выбери дату» не существует. */}
          <AddRow
            label="Добавить особый день"
            separated={specials.length > 0}
            onPress={() =>
              router.push(`/calendar/${teamId}/date/${formatYMD(new Date())}`)
            }
          />
        </SectionCard>
        <SectionFooter>
          Свои часы или выходной на конкретную дату — поверх недельного графика: короткий день перед праздником, подмена, отгул.
        </SectionFooter>
      </ScrollView>
    </Screen>
  );
}
