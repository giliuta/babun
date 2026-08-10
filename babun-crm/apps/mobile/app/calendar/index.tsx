import { useState } from "react";
import { Alert, ScrollView, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  CalendarClock,
  Clock,
  Eye,
  Globe,
  Route,
  Tags,
  Timer,
} from "lucide-react-native";
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
import { SettingsRow } from "@/components/ui/SettingsRow";
import { OptionSheet } from "@/components/ui/OptionSheet";
import { useThemeColors } from "@/theme/colors";
import {
  useCalendarSettings,
  useSaveCalendarSettings,
} from "@/features/settings/local-settings";
import { useTeams, useUpdateTeam } from "@/features/reference/queries";
import { useAllTeamSchedules } from "@/features/reference/team-schedule";
import { SavedIndicator } from "@/features/calendar/SavedIndicator";
import { TeamChips } from "@/features/calendar/TeamChips";
import { schedulePreview } from "@/features/calendar/schedule-days";
import {
  BUFFER_CHOICES,
  bufferLabel,
  HOUR_CHOICES,
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
  const [picker, setPicker] = useState<
    "slot" | "buffer" | "tz" | "workStart" | "workEnd" | null
  >(null);

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
      {/* КОМАНДЫ СВЕРХУ, КАК ВЕЗДЕ. Владелец 2026-08-10: «зачем делать другой
          дизайн внизу, если можно всё в едином стиле» — те же чипы, что в
          календаре и в финансах, и настройки каждой команды правятся не выходя
          с экрана. Раньше переключатель лежал последней секцией внизу. */}
      <TeamChips
        teams={teams}
        activeId={team?.id ?? null}
        onSelect={(id) => router.setParams({ team: id })}
      />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        {team ? (
          <>
            {/* Заголовок секции = имя календаря: он и есть область действия. */}
            <SectionEyebrow>{team.name}</SectionEyebrow>
            <SectionCard>
              <SettingsRow
                tile="#2F6FD6"
                icon={CalendarClock}
                title="Рабочие дни и часы"
                sub={schedText}
                onPress={() => router.push(`/calendar/${team.id}/schedule`)}
              />
              <Divider inset={56} />
              <SettingsRow
                tile="#0E7C86"
                icon={Timer}
                title="Длительность записи"
                sub={slotMinutes == null ? "30 мин" : slotLabel(slotMinutes)}
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
          <SettingsRow
            tile="#1F7A44"
            icon={Clock}
            title="Рабочие часы по умолчанию"
            sub={`${hourLabel(work.start)}–${hourLabel(work.end)}`}
            onPress={() => setPicker("workStart")}
          />
          <Divider inset={56} />
          <SettingsRow
            tile="#FF9500"
            icon={Route}
            title="Буфер"
            sub={bufferLabel(buffer)}
            onPress={() => setPicker("buffer")}
          />
          <Divider inset={56} />
          <SettingsRow
            tile="#5856D6"
            icon={Eye}
            title="Что показывать"
            sub={s.hideCancelled ? "Отменённые скрыты" : "Показываем всё"}
            onPress={() => router.push("/calendar/display")}
          />
          <Divider inset={56} />
          <SettingsRow
            tile="#5B6678"
            icon={Globe}
            title="Часовой пояс"
            sub={tzLabel(timezone)}
            onPress={() => setPicker("tz")}
          />
        </SectionCard>
        <SectionFooter>
          Действует во всех календарях компании. Буфер — зазор на дорогу и
          уборку после визита; календарь рисует его полосой и предупредит, если
          новая запись в него попадает.
        </SectionFooter>

        {/* СПРАВОЧНИКИ КАЛЕНДАРЯ. Метки переехали сюда из настроек клиентов
            (владелец 2026-08-02: «метки мы не делаем в клиентах — метки
            должны стоять в настройках календаря»): метка — это про ДЕНЬ и
            маршрут бригады, а карточка клиента её только показывает. */}
        <SectionEyebrow>Справочники</SectionEyebrow>
        <SectionCard>
          <SettingsRow
            tile="#AF52DE"
            icon={Tags}
            title="Метки дня"
            sub="Города и районы"
            onPress={() => router.push("/calendar/labels")}
          />
        </SectionCard>

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
      {/* ЧАСЫ ЗАДАЮТСЯ ДВУМЯ ЛИСТАМИ ПОДРЯД: сначала начало, сразу за ним
          конец. Так это устроено и в редакторе дня — человек уже знает движение,
          и одна строка настройки не превращается в подэкран ради двух чисел. */}
      <OptionSheet
        visible={picker === "workStart"}
        title="Начало рабочего дня"
        options={HOUR_CHOICES}
        value={String(work.start)}
        onPick={(v) => {
          const start = Number(v);
          // Конец обязан быть позже начала, иначе сетка молча отвергает пару.
          patchCompany({
            workStartHour: start,
            workEndHour: Math.max(work.end, start + 1),
          });
          setPicker("workEnd");
        }}
        onClose={() => setPicker(null)}
      />
      <OptionSheet
        visible={picker === "workEnd"}
        title="Конец рабочего дня"
        options={HOUR_CHOICES.filter((o) => Number(o.value) > work.start)}
        value={String(work.end)}
        onPick={(v) => patchCompany({ workEndHour: Number(v) })}
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
