import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { getStorage } from "@babun/shared/storage";
import {
  DEFAULT_CALENDAR_SETTINGS,
  TIMEZONE_OPTIONS,
  type CalendarSettings,
} from "@babun/shared/local/calendar-settings";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SectionFooter } from "@/components/ui/SectionFooter";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { ValueRow } from "@/components/ui/ValueRow";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { OptionSheet } from "@/components/ui/OptionSheet";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  useCalendarSettings,
  useSaveCalendarSettings,
} from "@/features/settings/local-settings";
import { useTeams, useUpdateTeam } from "@/features/reference/queries";
import { useAllTeamSchedules } from "@/features/reference/team-schedule";
import { SavedIndicator } from "@/features/calendar/SavedIndicator";
import { schedulePreview } from "@/features/calendar/schedule-days";
import {
  BUFFER_CHOICES,
  bufferLabel,
  effectiveWorkHours,
  hourLabel,
  SLOT_CHOICES,
  slotLabel,
  tzLabel,
  withCurrent,
} from "@/features/calendar/setting-options";

// ─── «Календарь» — ВСЕ настройки на одном экране ─────────────────────
// Сюда ведёт шестерёнка. Уровня «/calendar/[teamId]» больше нет: целый экран
// ради двух строк — это лишний этап, а не архитектура. Настройки открытого
// календаря встроены сюда же.
//
// Область действия задаёт ЗАГОЛОВОК СЕКЦИИ, а не этаж навигации: первая
// секция названа именем календаря, вторая — «Все календари». Раньше границу
// держала ступень навигации, но это стоило пользователю лишнего тапа на
// каждый заход, а календарь у покупателя, как правило, один.
//
// Строки «Команда» здесь тоже нет. Она вела в стек ТАБОВ из стека, лежащего
// НАД табами: push плодил второй экземпляр табов, navigate ломал «назад»
// (возвращал в календарь вместо настроек). Управление командой живёт в
// Кабинет → Команды — там ему и место, а этот экран про календарь.

const CAL_VIEW_KEY = "calendar.view";

export default function CalendarSettingsScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ team?: string }>();
  const settingsQuery = useCalendarSettings();
  const settings = settingsQuery.data;
  const { data: teams = [], isLoading: teamsLoading } = useTeams();
  const { data: schedules = {} } = useAllTeamSchedules();
  const save = useSaveCalendarSettings();
  const update = useUpdateTeam();
  const [savedTick, setSavedTick] = useState(0);
  const [picker, setPicker] = useState<"slot" | "buffer" | "tz" | null>(null);

  // Какой календарь настраиваем: параметр из шестерёнки → тот, что открыт в
  // самом календаре (MMKV, тот же ключ) → первый. Экран всегда показывает
  // календарь, в котором человек работает, а не абстрактный «первый».
  const persisted = getStorage().get<{ teamId?: string | null }>(CAL_VIEW_KEY)?.teamId;
  const activeId = params.team ?? persisted ?? teams[0]?.id;
  const team = teams.find((x) => x.id === activeId) ?? teams[0];

  const s: CalendarSettings = settings ?? DEFAULT_CALENDAR_SETTINGS;

  // Instant-commit: контрол шлёт частичный патч сразу, кнопки «Сохранить» нет.
  // До резолва запроса патчи игнорируем — контролы показывают ещё
  // неподтверждённые дефолты, и правка ушла бы не от той базы.
  const patchCompany = (p: Partial<CalendarSettings>) => {
    if (!settings) return;
    save.mutate(p, {
      onSuccess: () => setSavedTick(Date.now()),
      onError: (e) => Alert.alert("Ошибка", e.message),
    });
  };
  const patchTeam = (p: Record<string, unknown>) => {
    if (!team) return;
    update.mutate(
      { id: team.id, patch: p },
      {
        onSuccess: () => setSavedTick(Date.now()),
        onError: (e) => Alert.alert("Ошибка", e.message),
      },
    );
  };

  const work = effectiveWorkHours(s);
  const buffer = s.bufferMinutes ?? 0;
  const timezone = s.timezone ?? DEFAULT_CALENDAR_SETTINGS.timezone;
  const slotMinutes = team?.default_slot_minutes;

  // Строки графика может не быть — тогда сетку красят общие рабочие часы
  // (DayView: workBand === undefined → фолбэк). Показываем действующее, а
  // первая правка в редакторе дня материализует строку из них же.
  const sched = team ? schedules[team.id] : undefined;
  const schedText = sched
    ? schedulePreview(sched)
    : `${hourLabel(work.start)}–${hourLabel(work.end)}`;

  const others = teams.filter((x) => x.id !== team?.id);

  if (teamsLoading || settingsQuery.isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Календарь" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (settingsQuery.isError) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Календарь" />
        <EmptyState
          state="error"
          fill
          subtitle={
            settingsQuery.error instanceof Error
              ? settingsQuery.error.message
              : undefined
          }
          action={{
            label: "Повторить",
            onPress: () => void settingsQuery.refetch(),
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Календарь" right={<SavedIndicator tick={savedTick} />} />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        {team ? (
          <>
            {/* Заголовок секции = имя календаря: он и есть область действия. */}
            <SectionEyebrow>{team.name}</SectionEyebrow>
            <SectionCard>
              <Pressable
                onPress={() => router.push(`/calendar/${team.id}/schedule`)}
                accessibilityRole="button"
                accessibilityLabel={`Рабочие дни и часы: ${schedText}`}
                style={({ pressed }) => ({
                  minHeight: 52,
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  backgroundColor: pressed ? t.pressed : "transparent",
                })}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 16, color: t.ink }} numberOfLines={1}>
                    Рабочие дни и часы
                  </Text>
                  <Text
                    style={{ fontSize: 13, color: t.sub, marginTop: 1 }}
                    numberOfLines={1}
                  >
                    {schedText}
                  </Text>
                </View>
                <ChevronRight color={t.chevron} size={ICON.sm} />
              </Pressable>
              <Divider inset={16} />
              <ValueRow
                label="Длительность записи"
                value={slotMinutes == null ? "30 мин" : slotLabel(slotMinutes)}
                onPress={() => setPicker("slot")}
              />
            </SectionCard>
            <SectionFooter>
              Календарь показывает эти часы и красит всё за их пределами серым.
              Длительность — сколько занимает новая запись при тапе по слоту.
            </SectionFooter>
          </>
        ) : null}

        <SectionEyebrow>Все календари</SectionEyebrow>
        <SectionCard>
          <ValueRow
            label="Буфер"
            value={bufferLabel(buffer)}
            onPress={() => setPicker("buffer")}
          />
          <Divider inset={16} />
          <SwitchRow
            label="Скрывать отменённые"
            value={!!s.hideCancelled}
            onChange={(v) => patchCompany({ hideCancelled: v })}
          />
          <Divider inset={16} />
          <ValueRow
            label="Часовой пояс"
            value={tzLabel(timezone)}
            onPress={() => setPicker("tz")}
          />
        </SectionCard>
        <SectionFooter>
          Действует во всех календарях компании. Буфер — зазор на дорогу и
          уборку после визита; календарь рисует его полосой и предупредит, если
          новая запись в него попадает.
        </SectionFooter>

        {/* Список — только когда календарей больше одного: секция из одной
            строки «переключись на себя же» была бы чистым шумом. */}
        {others.length > 0 ? (
          <>
            <SectionEyebrow>Другие календари</SectionEyebrow>
            <SectionCard>
              {others.map((o, i) => (
                <View key={o.id}>
                  {i > 0 ? <Divider inset={42} /> : null}
                  <Pressable
                    onPress={() => router.setParams({ team: o.id })}
                    accessibilityRole="button"
                    accessibilityLabel={`Настроить календарь ${o.name}`}
                    style={({ pressed }) => ({
                      minHeight: 52,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      backgroundColor: pressed ? t.pressed : "transparent",
                    })}
                  >
                    <View
                      style={{
                        height: 10,
                        width: 10,
                        borderRadius: 5,
                        backgroundColor: o.color ?? t.faint,
                      }}
                    />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 16, color: t.ink }} numberOfLines={1}>
                        {o.name}
                      </Text>
                      <Text
                        style={{ fontSize: 13, color: t.faint, marginTop: 1 }}
                        numberOfLines={1}
                      >
                        {schedules[o.id]
                          ? schedulePreview(schedules[o.id])
                          : `${hourLabel(work.start)}–${hourLabel(work.end)}`}
                      </Text>
                    </View>
                    <ChevronRight color={t.chevron} size={ICON.sm} />
                  </Pressable>
                </View>
              ))}
            </SectionCard>
          </>
        ) : null}

        {teams.length === 0 ? (
          <SectionCard>
            <Text
              style={{
                paddingHorizontal: 16,
                paddingVertical: 14,
                fontSize: 15,
                color: t.faint,
              }}
            >
              Календарей пока нет — создайте первый на вкладке «Календарь».
            </Text>
          </SectionCard>
        ) : null}
      </ScrollView>

      <OptionSheet
        visible={picker === "slot"}
        title="Длительность записи"
        options={withCurrent(
          SLOT_CHOICES,
          String(slotMinutes ?? 30),
          slotLabel(slotMinutes ?? 30),
        )}
        value={String(slotMinutes ?? 30)}
        onPick={(v) => patchTeam({ default_slot_minutes: Number(v) })}
        onClose={() => setPicker(null)}
      />
      <OptionSheet
        visible={picker === "buffer"}
        title="Буфер после записи"
        options={BUFFER_CHOICES}
        value={String(buffer)}
        onPick={(v) => patchCompany({ bufferMinutes: Number(v) })}
        onClose={() => setPicker(null)}
      />
      <OptionSheet
        visible={picker === "tz"}
        title="Часовой пояс"
        options={TIMEZONE_OPTIONS.map((tz) => ({ value: tz, label: tzLabel(tz) }))}
        value={timezone}
        onPick={(v) => patchCompany({ timezone: v })}
        onClose={() => setPicker(null)}
      />
    </Screen>
  );
}
