import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";
import { Bookmark } from "lucide-react-native";
import { otherTeamTemplates } from "@/components/ui/TemplatePicker";
import { readTenantPref } from "@/lib/tenant-prefs";
import { useTenantId } from "@/lib/tenant";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { GUTTER } from "@/components/ui/tokens";
import { GradientButton } from "@/components/ui/GradientButton";
import { ReorderList } from "@/components/ui/ReorderList";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import { useDayCities } from "@/features/calendar/day-cities";
import { useAllTeamSchedules } from "@/features/reference/team-schedule";
import {
  useCities,
  useTeams,
  usePurgeExpiredCities,
} from "@/features/reference/queries";
import { useTeamSettingLevel } from "@/features/calendar/team-setting-level";
import { useDataRole } from "@/features/settings/tenant";
import { LabelEditSheet } from "./labels/LabelEditSheet";
import { LabelRow } from "./labels/LabelRow";
import {
  labelDayOwners,
  labelUsage,
  orderLabels,
  ROW_H,
  teamDaysOff,
  type Editing,
} from "./labels/label-rules";
import { useLabelActions } from "./labels/use-label-actions";

// Parts live in `labels/`: the editor sheet, the row, the pure rules
// (`label-rules.ts`) and the writes (`use-label-actions.ts`).

// Метки календаря — БИБЛИОТЕКА имён+цветов (таблица `cities`), которую
// реально потребляет календарь: команды подключают метки в своих
// настройках, диспетчер вешает метку на день тапом по шапке даты
// (DayLabelSheet → day_cities), цвет тонирует колонку дня.
//
// ОТЛИЧИЕ ОТ ВЕБА (осознанное): веб-страница settings/calendar/labels
// управляет списком «личного календаря» (personalLabels) — поверхности,
// которой на мобиле нет. Старая версия этого экрана писала personalLabels
// в никуда (аудит P0-4); теперь экран честно управляет библиотекой.
//
// Переименование каскадится по всем местам, где имя хранится строкой
// (useRenameLabelCascade) — чтобы метки не сиротели (аудит P1-12).
//
// ДОМ ОДИН, ДВЕРЕЙ ДВЕ. Тело живёт здесь, а маршруты `/calendar/labels` и
// `/cabinet/labels` его переиспользуют: настройка, открытая из таба
// «Календарь», обязана быть маршрутом этого таба, иначе ссылка переключает
// таб-бар и «назад» выбрасывает не туда (закон DS §5).
//
// ДО 2026-08-17 «Метки дня» из настроек календаря открывали СОВСЕМ ДРУГОЙ
// экран — городской справочник (`CitiesScreen`: «Города», поля «Город» и
// «Страна», без цвета). Отсюда и брались города, которых владелец не просил:
// «я не хочу, чтоб там писались города — туда можно писать что угодно, это всё
// метки». Метка — свободный текст с цветом, и редактор у неё ровно этот.
export function LabelsScreen() {
  // ЭКРАН ПРИНАДЛЕЖИТ КОМАНДЕ (владелец 2026-08-29: «метка закрепляется за
  // командой; если у меня команда два — значит и метка команды два»).
  //
  // Команда приходит параметром из настроек календаря, а если её нет —
  // берётся та, что открыта в самом календаре (тот же ключ MMKV, что у
  // экрана настроек). Абстрактной «первой» здесь быть не может: человек
  // правит метки того календаря, в котором работает.
  const params = useLocalSearchParams<{ team?: string }>();
  const tenantId = useTenantId();
  const persistedTeam = tenantId
    ? readTenantPref<{ teamId?: string | null }>(
        "calendar.view",
        tenantId,
        // Ключ до переезда настроек на компанию; забирается один раз.
        "calendar.view",
      )?.teamId
    : undefined;
  const t = useThemeColors();
  const teamsQuery = useTeams();
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  // ПАРАМЕТР ПОБЕЖДАЕТ: его шлёт шестерёнка календаря, и это команда, чьи
  // настройки открыты СЕЙЧАС. MMKV — только запасной путь (прямой заход
  // ссылкой или из Кабинета): там параметра нет, и правим тот календарь, в
  // котором человек работает.
  //
  // Пропа `teamId` здесь больше нет: его передавал маршрут Кабинет → Команды
  // → метки, а раздел «Команды» снесён 2026-08-30. Проп без вызывающего —
  // приглашение подставить в него что угодно годы спустя.
  // Запомненный календарь берётся, только если он ещё живой (аудит
  // шестерёнки 03.10): ушедший в архив оставался в памяти, и метка с прямого
  // захода заводилась на архивную команду, а подпись «Метки» читала её же.
  // Тем же правилом живёт «Услуги» (`cabinet/services.tsx`).
  const liveTeam =
    persistedTeam && teams.some((x) => x.id === persistedTeam) ? persistedTeam : null;
  const teamId =
    (Array.isArray(params.team) ? params.team[0] : params.team) ??
    liveTeam ??
    teams[0]?.id ??
    null;
  const teamName =
    teams.find((x) => x.id === teamId)?.name ?? teams[0]?.name ?? null;
  // ВКЛЮЧАЯ СКРЫТЫЕ: они остаются в списке серыми, как выключенные услуги.
  // Раньше `useCities()` их отфильтровывал, и скрытая метка исчезала с экрана
  // совсем — вернуть её было нечем.
  const citiesQuery = useCities({ includeInactive: true, teamId });
  // ШАБЛОНЫ ИЗ ДРУГИХ КОМАНД (владелец 11.10, как у услуг): метки других
  // команд аккаунта, которых здесь ещё нет по имени. Только у владельца.
  const isOwner = useDataRole().data === "owner";
  const citiesData = useCities({ includeInactive: true }).data;
  const allCities = useMemo(() => citiesData ?? [], [citiesData]);
  const labelTemplates = useMemo(
    () =>
      isOwner
        ? otherTeamTemplates(allCities, {
            teamId,
            teamOf: (c) => c.team_id,
            nameOf: (c) => c.name,
            active: (c) => c.is_active !== false && !c.deleted_at,
          }).map((c) => ({
            key: c.id,
            name: c.name,
            color: c.color ?? null,
            sub: teams.find((tm) => tm.id === c.team_id)?.name,
            value: c,
          }))
        : [],
    [isOwner, allCities, teamId, teams],
  );
  const dayCitiesQuery = useDayCities();
  const schedulesQuery = useAllTeamSchedules();
  // Order: live, hidden, deleted (`orderLabels`).
  const cities = useMemo(() => orderLabels(citiesQuery.data ?? []), [citiesQuery.data]);

  // Обещанные 30 дней истекают здесь: крона нет, а зачистка обязана когда-то
  // случиться. Открытие экрана — тот же момент, где удаляют.
  // «ТОЛЬКО ВИДИТ» — МЕТКИ БЕЗ ПРАВКИ (владелец 30.09: «Метки» в
  // «Настройках команды»): ни кнопки внизу, ни свайпов, ни ручек, строка не
  // открывает редактор. Владельцу — всегда правка.
  const readOnly = useTeamSettingLevel("calendar.labels", teamId) !== "write";
  const purgeExpired = usePurgeExpiredCities();
  useEffect(() => {
    // Зачистка — тоже правка: тому, кто только смотрит, она не положена.
    if (readOnly) return;
    void purgeExpired();
  }, [purgeExpired, readOnly]);
  const dayCities = useMemo(
    () => dayCitiesQuery.data ?? {},
    [dayCitiesQuery.data],
  );
  const schedules = useMemo(() => schedulesQuery.data ?? {}, [schedulesQuery.data]);
  const isLoading =
    citiesQuery.isLoading || teamsQuery.isLoading || dayCitiesQuery.isLoading;
  const error = citiesQuery.error || teamsQuery.error || dayCitiesQuery.error;
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dragging, setDragging] = useState(false);

  // Использование метки: на скольких днях она уже стоит рукой.
  //
  // СЧЁТЧИК КОМАНД УБРАН (2026-08-30). Он складывался по `teams.cities` —
  // легаси-списку имён, подобранных команде из ОБЩЕГО справочника. С 29
  // августа метка принадлежит ровно одной команде, подбор снесён, и список
  // застыл пустым: «сколько команд подключили» всегда давало ноль, а сам
  // вопрос перестал существовать — ответ на него теперь всегда «одна, эта».
  const usage = useMemo(() => labelUsage(dayCities), [dayCities]);

  // ═══ ДВА СТОЛКНОВЕНИЯ, КОТОРЫЕ НАДО НЕ ДОПУСТИТЬ ═══
  //
  // Владелец 2026-08-29:
  //   «по четвергам выходной — значит в четверг метку ставить нельзя, там
  //    пересекутся метка выходного и метка дня»;
  //   «две метки на понедельник — вторую уже не поставить, день занят».
  //
  // Обе беды одной природы: у дня ОДНА метка. Разрешить второй встать в тот
  // же день — значит сделать календарь недетерминированным: какая из двух
  // покрасит день, зависело бы от порядка строк в ответе базы.
  //
  // ЗАНЯТЫЕ ДНИ. Кто уже держит день недели — считаем по всем живым меткам,
  // кроме той, что сейчас правим (иначе метка «занимала» бы день у самой
  // себя и её нельзя было бы сохранить).
  //
  // ХОЗЯИН ДНЯ ЕДЕТ ВМЕСТЕ С ЦВЕТОМ (2026-08-30): плитка занятого дня теперь
  // красится в цвет занявшей метки и подписывается её именем. До этого она
  // просто гасла, а имя хозяина приходилось выковыривать тапом — карта
  // недели лежала в данных, но на экран не попадала.
  const takenBy = useMemo(() => labelDayOwners(cities), [cities]);


  // ВЫХОДНЫЕ — ЭТОЙ КОМАНДЫ (владелец: «по четвергам выходной — значит в
  // четверг метку ставить нельзя, там пересекутся метка выходного и метка
  // дня»). Раз метка принадлежит команде, спрашивать надо её собственный
  // график, а не сводку по компании.
  const companyDaysOff = useMemo(
    () => teamDaysOff(teamId ? schedules[teamId] : undefined),
    [schedules, teamId],
  );

  const actions = useLabelActions({ cities, teamId, usage, setEditing });
  const busy = actions.busy;

  return (
    <Screen edges={["top"]}>
      {/* Подзаголовок называет КОМАНДУ, а не раздел: метки теперь её
          собственность, и человек обязан видеть, чьи он правит. */}
      <ScreenHeader title="Метки" subtitle={teamName ?? undefined} />

      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : error ? (
        <EmptyState
          fill
          state="error"
          subtitle={error instanceof Error ? error.message : undefined}
          action={{
            label: "Повторить",
            onPress: () => {
              void Promise.all([
                citiesQuery.refetch(),
                teamsQuery.refetch(),
                dayCitiesQuery.refetch(),
              ]);
            },
          }}
        />
      ) : cities.length === 0 ? (
        <EmptyState
          fill
          icon={<Bookmark color={t.accent} size={28} />}
          title="Меток пока нет"
        />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 24 }}
          // Пока строку тянут, страница не должна уезжать под пальцем.
          scrollEnabled={!dragging}
        >
          {/* КАЖДАЯ МЕТКА — СВОЯ КАРТОЧКА, А НЕ СТРОКА ОБЩЕГО ПОЛОТНА
              (владелец 2026-08-30: «раздели в метках так же, как в услугах —
              разделитель не волосина, а полноценный блок»).
              Ровно та же конструкция, что у прайса: не `SectionCard` со швами
              внутри, а `spaced`-список, где строка сама себе поверхность —
              свой радиус, свой фон, свой зазор. Разделять их нечем, потому что
              они и так раздельные.
              Дело не только во вкусе: волосяной шов рвался под пальцем. У
              строки, которую смахивают или тянут, фон уезжает, у соседней
              остаётся — и линия повисает между ними ничьей. Тот же счёт
              владелец предъявил услугам 29 августа. */}
          <View style={{ marginHorizontal: GUTTER, marginTop: 8 }}>
            <ReorderList
              items={cities}
              rowHeight={ROW_H}
              spaced
              labelFor={(city) => city.name}
              rangeFor={(index) => (readOnly ? [index, index] : [0, cities.length - 1])}
              // Ручка внутри строки: строка ещё и смахивается влево, а колонка
              // ручки снаружи не уезжает — «Удалить» упиралось бы в неё.
              handleInside
              onReorder={actions.reorderLabels}
              onDraggingChange={setDragging}
            >
              {(city, _index, handle) => (
                <LabelRow
                  city={city}
                  handle={handle}
                  readOnly={readOnly}
                  onEdit={() => setEditing({ mode: "edit", city })}
                  onRemove={() => actions.remove(city)}
                  onLeading={() => actions.toggleState(city)}
                />
              )}
            </ReorderList>
          </View>
        </ScrollView>
      )}

      {/* ГЛАВНОЕ ДЕЙСТВИЕ ЭКРАНА — ВНИЗУ (LOCKED 2026-08-27, владелец: «когда
          открываю метку дня — кнопка снизу, как услуга, как и везде»).
          Кнопка стоит ВСЕГДА, а не только в пустом состоянии: метки заводят
          пачкой, и после первой не должно приходиться доскролливать список,
          чтобы завести вторую. Ровно тот же приём, что на экране услуг. */}
      {readOnly ? null : (
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 }}>
          <GradientButton
            label="Добавить метку"
            onPress={() => setEditing({ mode: "create" })}
          />
        </View>
      )}

      <LabelEditSheet
        editing={editing}
        takenBy={takenBy}
        daysOff={companyDaysOff}
        busy={busy}
        onClose={() => setEditing(null)}
        onCreate={actions.add}
        onUpdate={actions.edit}
        templates={labelTemplates}
      />
    </Screen>
  );
}
