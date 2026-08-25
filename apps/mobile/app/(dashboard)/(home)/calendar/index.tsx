import { useState } from "react";
import { Alert, ScrollView, Text } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import {
  CalendarClock,
  CalendarRange,
  Eye,
  Globe,
  Scissors,
  Tags,
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
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { OptionSheet } from "@/components/ui/OptionSheet";
import { NameColorField } from "@/components/ui/picker-fields";
import { useThemeColors } from "@/theme/colors";
import {
  useCalendarSettings,
  useSaveCalendarSettings,
} from "@/features/settings/local-settings";
import { useCities, useTeams, useUpdateTeam } from "@/features/reference/queries";
import { useAllTeamSchedules } from "@/features/reference/team-schedule";
import { SavedIndicator } from "@/features/calendar/SavedIndicator";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { schedulePreview } from "@/features/calendar/schedule-days";
import { HourRangeSheet } from "@/features/calendar/HourRangeSheet";
import { TeamScheduleSheet } from "@/features/calendar/TeamScheduleSheet";
import {
  effectiveCalendarWindow,
  formatHm,
} from "@/features/calendar/window";
import {
  effectiveBuffer,
  effectiveWorkHours,
  hourLabel,
  tzLabel,
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

// ИМЯ И ЦВЕТ КАЛЕНДАРЯ ПРАВЯТСЯ ПРЯМО В СТРОКЕ (владелец 2026-08-18: «не хочу,
// чтоб снизу выплывало — можно было прям сразу так и менять»).
//
// Здесь по очереди побывали: поле ввода плюс шеврон, раскрывающий палитру
// внутрь карточки, потом нижний лист с двумя строками и кнопкой «Применить».
// Оба раза человек делал лишний шаг ради двух правок, которые правятся на
// месте. Теперь карточка И ЕСТЬ редактор: имя пишется в строке и сохраняется,
// когда из него уходят, точка слева открывает палитру поверх экрана.
function CalendarIdentityCard({
  team,
  onPatch,
}: {
  team: { name: string; color?: string | null };
  onPatch: (p: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? team.name;

  const commitName = () => {
    const trimmed = name.trim();
    // Пустое имя не пишем: календарь без имени не существует ни в чипах, ни в
    // переводах. Молча возвращаем как было.
    if (trimmed && trimmed !== team.name) onPatch({ name: trimmed });
    setDraft(null);
  };

  return (
    <SectionCard>
      <NameColorField
        bare
        label={null}
        name={name}
        onNameChange={setDraft}
        onBlur={commitName}
        color={team.color}
        onColorChange={(hex) => onPatch({ color: hex })}
      />
    </SectionCard>
  );
}

export default function CalendarSettingsScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ team?: string }>();
  const settingsQuery = useCalendarSettings();
  const settings = settingsQuery.data;
  const { data: teams = [], isLoading: teamsLoading } = useTeams();
  const { data: schedules = {} } = useAllTeamSchedules();
  const { data: labels = [] } = useCities();
  const save = useSaveCalendarSettings();
  const update = useUpdateTeam();
  const [savedTick, setSavedTick] = useState(0);
  // Отдельной двери к общим «Рабочим часам» больше нет (владелец 2026-08-17):
  // когда работает команда, отвечает её ГРАФИК — он правится листом снизу.
  // Колонки `work_start_hour/work_end_hour` живы и остаются фолбэком сетки для
  // команды без строки расписания — стандарт 06:00–20:00.
  const [picker, setPicker] = useState<"view" | "tz" | null>(null);
  // График команды правится ЛИСТОМ, а не страницей (владелец 2026-08-17):
  // семь дней надо видеть целиком, пока правишь один. См. шапку
  // `TeamScheduleSheet` — там же, почему это исключение из закона «настройка —
  // всегда страница».
  const [scheduleOpen, setScheduleOpen] = useState(false);

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
  const timezone = s.timezone ?? DEFAULT_CALENDAR_SETTINGS.timezone;
  // «Часы календаря» — видимое окно рельса ЭТОГО календаря (владелец
  // 2026-08-17: «на команде один я могу выбрать такие часы, а на команде два
  // совершенно другие»). Читается буквально: «Автоматически» из продукта
  // убрано, 00:00–24:00 — это сутки целиком. Своей пары у команды нет —
  // наследуется стандарт компании, и строка про это говорит вслух.
  const window = effectiveCalendarWindow(team, s);
  // Первые имена меток — чтобы строка отвечала «что у меня заведено», не
  // проваливаясь внутрь. Пусто — честное «Пока нет».
  const labelsSub = (() => {
    const names = labels.map((c) => c.name).filter(Boolean);
    if (names.length === 0) return "Пока нет меток";
    const head = names.slice(0, 3).join(", ");
    return names.length > 3 ? `${head} и ещё ${names.length - 3}` : head;
  })();
  const view = {
    start: window.start.hour,
    end: window.end.hour,
    startMinute: window.start.minute,
    endMinute: window.end.minute,
  };

  // ОДИН ДИАЛЕКТ У СТРОКИ ГРАФИКА (владелец 2026-08-21: «почему у команды один
  // график Пн–Вс 10–20, а у команды два просто 6–22, что это за хуета»).
  //
  // Причина была не в данных, а в двух разных фразах на одной строке: у
  // команды со СВОИМ графиком печаталось «Пн–Вс · 10:00–20:00», а у команды
  // БЕЗ него — голые часы компании без единого дня. Две команды рядом
  // становились несравнимыми, и вторая не отвечала на главный вопрос строки —
  // «в какие дни».
  //
  // Строки графика может не быть — тогда команда работает общими часами
  // компании все семь дней (так же её красит и сетка: DayView с
  // workBand === undefined). Это ровно тот же график, только унаследованный, —
  // значит и произносится он тем же способом.
  const sched = team ? schedules[team.id] : undefined;
  const schedText = schedulePreview(
    sched ?? {
      start: hourLabel(work.start),
      end: hourLabel(work.end),
      breaks: [],
    },
  );


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
      {/* Шов под шапкой один — его несёт лента чипов. */}
      <ScreenHeader
        title="Календарь"
        seam={false}
        right={<SavedIndicator tick={savedTick} />}
      />
      {/* КОМАНДЫ СВЕРХУ, КАК ВЕЗДЕ. Владелец 2026-08-10: «зачем делать другой
          дизайн внизу, если можно всё в едином стиле» — те же чипы, что в
          календаре и в финансах, и настройки каждой команды правятся не выходя
          с экрана. Раньше переключатель лежал последней секцией внизу. */}
      <ScopeChips
        items={teams}
        activeId={team?.id ?? null}
        // «Все календари разом» здесь нет: настройки правятся у КОНКРЕТНОЙ
        // команды, и лента другого выбора не предлагает.
        onSelect={(id) => router.setParams({ team: id })}
      />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        {team ? (
          <>
            {/* Заголовок секции = имя календаря: он и есть область действия. */}
            <SectionEyebrow>{team.name}</SectionEyebrow>
            <CalendarIdentityCard
              key={team.id}
              team={team}
              onPatch={patchTeam}
            />
            {/* «Длительности записи» здесь больше нет (владелец 2026-08-16):
                длительность даёт УСЛУГА, а не настройка календаря. Дефолт
                тапа по слоту остался кодовым фолбэком 30 мин. */}
            {/* ДВА ВОПРОСА ПРО ЧАСЫ СТОЯТ РЯДОМ (владелец 2026-08-17: «часы
                календаря и рабочие дни и часы поставь вместе»). Раньше они
                лежали на разных концах экрана, в разных секциях, и человек
                сравнивал их по памяти.
                «Часы календаря» — какой отрезок суток ВИДЕН на сетке; настройка
                общая на все календари, и это сказано в самой строке, а не
                сноской под карточкой. «График команды» — КОГДА РАБОТАЕТ ЭТА
                КОМАНДА (дни и часы, правится шторкой снизу).

                ПОРЯДОК: сперва часы календаря, потом график команды (владелец
                2026-08-25). Так и читается: сначала настраивают саму сетку — то,
                на что смотришь каждый день, — а уже потом заполняют её работой
                конкретной команды. */}
            <SectionCard className="mt-4">
              <SettingsRow
                tile={SETTINGS_TILE.teal}
                icon={CalendarRange}
                title="Часы календаря"
                sub={`${formatHm(window.start)}–${formatHm(window.end)}`}
                onPress={() => setPicker("view")}
              />
              <Divider inset={56} />
              <SettingsRow
                tile={SETTINGS_TILE.blue}
                icon={CalendarClock}
                title="График команды"
                sub={schedText}
                onPress={() => setScheduleOpen(true)}
              />
            </SectionCard>
          </>
        ) : null}

        <SectionEyebrow>Все календари</SectionEyebrow>
        <SectionCard>
          <SettingsRow
            tile={SETTINGS_TILE.indigo}
            icon={Eye}
            title="Что показывать"
            sub={s.hideCancelled ? "Отменённые скрыты" : "Показываем всё"}
            onPress={() => router.push("/calendar/display")}
          />
          <Divider inset={56} />
          <SettingsRow
            tile="neutral"
            icon={Globe}
            title="Часовой пояс"
            sub={tzLabel(timezone)}
            onPress={() => setPicker("tz")}
          />
        </SectionCard>

        {/* СПРАВОЧНИКИ КАЛЕНДАРЯ. Метки переехали сюда из настроек клиентов
            (владелец 2026-08-02: «метки мы не делаем в клиентах — метки
            должны стоять в настройках календаря»): метка — это про ДЕНЬ и
            маршрут команды, а карточка клиента её только показывает. */}
        <SectionEyebrow>Справочники</SectionEyebrow>
        <SectionCard>
          {/* Услуги — здесь, потому что именно они дают ДЛИТЕЛЬНОСТЬ записи
              (настройки «Длительность» на календаре больше нет). Тот же
              экран, что в Кабинете, второй дверью внутри стека /calendar:
              наружу этот стек не ведёт (закон навигации). */}
          <SettingsRow
            tile={SETTINGS_TILE.blue}
            icon={Scissors}
            title="Услуги"
            sub="Каталог работ и цены"
            // Отдаём ТУ команду, чьи настройки открыты: иначе прайс
            // открывался на чужой, и новая услуга уезжала не туда.
            onPress={() =>
              router.push(
                team?.id
                  ? ({
                      pathname: "/calendar/services",
                      params: { team: team.id },
                    } as Href)
                  : ("/calendar/services" as Href),
              )
            }
          />
          <Divider inset={56} />
          <SettingsRow
            tile={SETTINGS_TILE.purple}
            icon={Tags}
            title="Метки дня"
            // Подпись показывает СВОИ метки, а не жанр: «Города и районы» врали
            // про содержимое (владелец 2026-08-17: «туда можно писать что
            // угодно, это всё метки»).
            sub={labelsSub}
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

      {/* Часы календаря — нижним листом «С … До …» (владелец 2026-08-16: «как
          время в финансах»): сегмент С|До, список часов, «Применить». */}
      <HourRangeSheet
        visible={picker === "view"}
        title="Часы календаря"
        value={view}
        onClose={() => setPicker(null)}
        // ПИШЕТСЯ В КОМАНДУ, А НЕ В КОМПАНИЮ: часы календаря принадлежат этому
        // календарю. Текст «ЧЧ:ММ» в `teams.calendar_window_*` несёт и минуты,
        // поэтому второй пары колонок под них не нужно.
        onApply={(v) =>
          patchTeam({
            calendar_window_start: formatHm({
              hour: v.start,
              minute: v.startMinute,
            }),
            calendar_window_end: formatHm({ hour: v.end, minute: v.endMinute }),
          })
        }
      />
      <TeamScheduleSheet
        visible={scheduleOpen}
        teamId={team?.id}
        teamName={team?.name}
        // ПОКАЗЫВАЕМ ДЕЙСТВУЮЩИЙ перерыв, а не сырое поле команды: пустое
        // поле означает «как у компании», и печатать вместо него 00:00 —
        // врать про то, что на самом деле стоит между записями.
        buffer={effectiveBuffer(team, settings)}
        onBufferChange={(minutes) => patchTeam({ buffer_minutes: minutes })}
        onClose={() => setScheduleOpen(false)}
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
