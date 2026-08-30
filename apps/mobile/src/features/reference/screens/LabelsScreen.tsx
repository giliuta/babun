import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { getStorage } from "@babun/shared/storage";
import { Pressable, ScrollView, Text, View } from "react-native";
import { EyeOff, MapPin, RotateCcw, Trash2, X } from "lucide-react-native";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import { NameColorField } from "@/components/ui/picker-fields";
import { FieldLabel } from "@/components/ui/Field";

import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { GradientButton } from "@/components/ui/GradientButton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ReorderList } from "@/components/ui/ReorderList";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { WeekProjection } from "@/features/reference/WeekProjection";
import { useThemeColors } from "@/theme/colors";
import { useToast } from "@/components/ui/Toast";
import { useDayCities } from "@/features/calendar/day-cities";
import { useAllTeamSchedules } from "@/features/reference/team-schedule";
import { allDays, ISO_BY_KEY } from "@/features/calendar/schedule-days";
import { useRenameLabelCascade } from "@/features/reference/label-cascade";
import { notify } from "@/lib/notify";
import { confirmThen } from "@/lib/confirm";
import {
  useCities,
  useCreateCity,
  useDeleteCity,
  useReorderCities,
  useTeams,
  usePurgeExpiredCities,
  useUpdateCity,
  type City,
} from "@/features/reference/queries";

/** Что лист отдаёт наружу при сохранении. Объектом, а не пятью позиционными
 *  аргументами: имя, цвет, дни и заливка — один ответ на один вопрос «какая
 *  это метка», и порядок в вызове не должен быть частью правды. */
interface LabelDraft {
  name: string;
  color: string;
  weekdays: number[];
  tintDay: boolean;
}

/** Полное имя дня по ISO-номеру — для объяснения, почему день не берётся. */
const WEEKDAY_FULL_BY_ISO: Record<number, string> = {
  1: "Понедельник",
  2: "Вторник",
  3: "Среда",
  4: "Четверг",
  5: "Пятница",
  6: "Суббота",
  7: "Воскресенье",
};

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

const FALLBACK_COLOR = "#8E8E93";
/** Высота строки фиксирована: по ней перетаскивание считает, через сколько
 *  соседей перелетел палец. */
const ROW_H = 52;

type Editing =
  | { mode: "create" }
  | { mode: "edit"; city: City };

export function LabelsScreen({ teamId: forced }: { teamId?: string | null } = {}) {
  // ЭКРАН ПРИНАДЛЕЖИТ КОМАНДЕ (владелец 2026-08-29: «метка закрепляется за
  // командой; если у меня команда два — значит и метка команды два»).
  //
  // Команда приходит параметром из настроек календаря, а если её нет —
  // берётся та, что открыта в самом календаре (тот же ключ MMKV, что у
  // экрана настроек). Абстрактной «первой» здесь быть не может: человек
  // правит метки того календаря, в котором работает.
  const params = useLocalSearchParams<{ team?: string }>();
  const persistedTeam = getStorage().get<{ teamId?: string | null }>(
    "calendar.view",
  )?.teamId;
  const t = useThemeColors();
  const toast = useToast();
  const teamsQuery = useTeams();
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  // Явно переданная команда (маршрут Кабинет → Команды → метки) побеждает:
  // там человек стоит В КОНКРЕТНОЙ команде, и подставлять ей ту, что открыта
  // в календаре, значило бы править чужой список.
  const teamId =
    forced ??
    (Array.isArray(params.team) ? params.team[0] : params.team) ??
    persistedTeam ??
    teams[0]?.id ??
    null;
  const teamName =
    teams.find((x) => x.id === teamId)?.name ?? teams[0]?.name ?? null;
  // ВКЛЮЧАЯ СКРЫТЫЕ: они остаются в списке серыми, как выключенные услуги.
  // Раньше `useCities()` их отфильтровывал, и скрытая метка исчезала с экрана
  // совсем — вернуть её было нечем.
  const citiesQuery = useCities({ includeInactive: true, teamId });
  const dayCitiesQuery = useDayCities();
  const schedulesQuery = useAllTeamSchedules();
  // Живые сверху, скрытые под ними, удалённые в самом хвосте — тем же
  // порядком, что у услуг. Удалённая остаётся ВИДНОЙ: обещание «можно
  // вернуть 30 дней» без двери было бы враньём.
  const cities = useMemo(() => {
    const all = citiesQuery.data ?? [];
    return [
      ...all.filter((c) => c.is_active && !c.deleted_at),
      ...all.filter((c) => !c.is_active && !c.deleted_at),
      ...all.filter((c) => c.deleted_at),
    ];
  }, [citiesQuery.data]);

  // Обещанные 30 дней истекают здесь: крона нет, а зачистка обязана когда-то
  // случиться. Открытие экрана — тот же момент, где удаляют.
  const purgeExpired = usePurgeExpiredCities();
  useEffect(() => {
    void purgeExpired();
  }, [purgeExpired]);
  const dayCities = useMemo(
    () => dayCitiesQuery.data ?? {},
    [dayCitiesQuery.data],
  );
  const schedules = useMemo(() => schedulesQuery.data ?? {}, [schedulesQuery.data]);
  const isLoading =
    citiesQuery.isLoading || teamsQuery.isLoading || dayCitiesQuery.isLoading;
  const error = citiesQuery.error || teamsQuery.error || dayCitiesQuery.error;
  const createCity = useCreateCity();
  const updateCity = useUpdateCity();
  const deleteCity = useDeleteCity();
  const reorder = useReorderCities();
  const cascade = useRenameLabelCascade();

  const [editing, setEditing] = useState<Editing | null>(null);
  const [dragging, setDragging] = useState(false);

  // Использование метки: на скольких днях она уже стоит рукой.
  //
  // СЧЁТЧИК КОМАНД УБРАН (2026-08-30). Он складывался по `teams.cities` —
  // легаси-списку имён, подобранных команде из ОБЩЕГО справочника. С 29
  // августа метка принадлежит ровно одной команде, подбор снесён, и список
  // застыл пустым: «сколько команд подключили» всегда давало ноль, а сам
  // вопрос перестал существовать — ответ на него теперь всегда «одна, эта».
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const name of Object.values(dayCities)) {
      m.set(name, (m.get(name) ?? 0) + 1);
    }
    return m;
  }, [dayCities]);

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
  const takenBy = useMemo(() => {
    const m = new Map<number, { name: string; color: string | null }>();
    for (const c of cities) {
      if (!c.is_active || c.deleted_at) continue;
      for (const d of c.weekdays ?? []) {
        if (!m.has(d)) m.set(d, { name: c.name, color: c.color });
      }
    }
    return m;
  }, [cities]);


  // ВЫХОДНЫЕ — ЭТОЙ КОМАНДЫ (владелец: «по четвергам выходной — значит в
  // четверг метку ставить нельзя, там пересекутся метка выходного и метка
  // дня»). Раз метка принадлежит команде, спрашивать надо её собственный
  // график, а не сводку по компании.
  const companyDaysOff = useMemo(() => {
    const schedule = teamId ? schedules[teamId] : undefined;
    if (!schedule) return new Set<number>();
    const off = new Set<number>();
    for (const { key, day } of allDays(schedule)) {
      if (!day.is_working) off.add(ISO_BY_KEY[key]);
    }
    return off;
  }, [schedules, teamId]);

  const alertError = (e: unknown) =>
    notify("Ошибка", e instanceof Error ? e.message : "Не удалось сохранить");

  const add = async ({ name, color, weekdays, tintDay }: LabelDraft) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const existing = cities.find(
        (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (existing) {
        // Уже в библиотеке — просто обновляем цвет.
        await updateCity.mutateAsync({
          id: existing.id,
          patch: { color, weekdays, tint_day: tintDay },
        });
      } else {
        if (!teamId) return;
        await createCity.mutateAsync({
          name: trimmed,
          color,
          weekdays,
          tintDay,
          teamId,
        });
      }
      setEditing(null);
      toast("Метка добавлена");
    } catch (e) {
      alertError(e); // шит остаётся открытым — ввод не теряется
    }
  };

  const edit = async (
    city: City,
    { name: newName, color, weekdays, tintDay }: LabelDraft,
  ) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      const renamed = trimmed !== city.name;
      const collision =
        renamed && trimmed.toLowerCase() !== city.name.toLowerCase()
          ? cities.find((c) => c.name.toLowerCase() === trimmed.toLowerCase())
          : undefined;
      let target = trimmed;
      if (collision) {
        // Слияние с существующей меткой: цвет уходит в целевую, старая
        // запись скрывается, ссылки переезжают на целевое имя.
        target = collision.name;
        await updateCity.mutateAsync({
          id: collision.id,
          patch: { color, weekdays, tint_day: tintDay },
        });
        await deleteCity.mutateAsync(city.id);
      } else {
        await updateCity.mutateAsync({
          id: city.id,
          patch: { name: trimmed, color, weekdays, tint_day: tintDay },
        });
      }
      if (renamed) {
        const failures = teamId
          ? await cascade.run(teamId, city.name, target)
          : [];
        if (failures.length > 0) {
          notify(
            "Метка переименована частично",
            `Не удалось обновить: ${failures.join(", ")}. Проверьте сеть и повторите переименование.`,
          );
        }
      }
      setEditing(null);
      toast("Метка обновлена");
    } catch (e) {
      alertError(e);
    }
  };

  // УДАЛЕНИЕ ОТЛОЖЕНО НА 30 ДНЕЙ (владелец 2026-08-29: «удалить — это спустя
  // 30 дней; она уйдёт как удаление, и 30 дней должно пройти»).
  //
  // Метка адресуется ИМЕНЕМ (`day_cities.city`, `clients.city`), связи с
  // таблицей нет — база удалению не мешает. Поэтому мгновенное «Удалить»
  // рвёт не ссылку, а СМЫСЛ: день остаётся с именем, у которого больше нет
  // ни цвета, ни строки в справочнике. Тридцать дней — окно, в котором
  // ошибку видно и она обратима (канон, LOCKED 2026-08-29).
  const remove = (city: City) => {
    const used = (usage.get(city.name) ?? 0) > 0;
    confirmThen(
      "Удалить метку?",
      {
        message: used
          ? `«${city.name}» исчезнет из выбора. Дни, где она уже стоит, сохранят её имя. Совсем удалится через 30 дней — до тех пор можно вернуть.`
          : `«${city.name}» удалится совсем через 30 дней. До тех пор её можно вернуть.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      async () => {
        try {
          await updateCity.mutateAsync({
            id: city.id,
            patch: { deleted_at: new Date().toISOString(), is_active: false },
          });
          toast("Метка удалена — вернуть можно 30 дней");
        } catch (e) {
          alertError(e);
        }
      },
    );
  };

  const busy =
    createCity.isPending ||
    updateCity.isPending ||
    deleteCity.isPending ||
    cascade.pending;

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
          icon={<MapPin color={t.accent} size={28} />}
          title="Меток пока нет"
        />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 24 }}
          // Пока строку тянут, страница не должна уезжать под пальцем.
          scrollEnabled={!dragging}
        >
          <SectionCard>
            <ReorderList
              items={cities}
              rowHeight={ROW_H}
              labelFor={(city) => city.name}
              // Ручка внутри строки: строка ещё и смахивается влево, а колонка
              // ручки снаружи не уезжает — «Удалить» упиралось бы в неё.
              handleInside
              onReorder={(ids) =>
                reorder.mutate(ids, {
                  onError: alertError,
                })
              }
              onDraggingChange={setDragging}
            >
              {(city, _index, handle) => {
                const deleted = !!city.deleted_at;
                const hidden = !city.is_active && !deleted;
                return (
                <SwipeRow
                  label="Удалить"
                  color={t.danger}
                  icon={Trash2}
                  accessibilityLabel={`Удалить метку ${city.name}`}
                  onAction={() => remove(city)}
                  // СЛЕВА — «СКРЫТЬ», КАК У УСЛУГ (владелец 2026-08-29).
                  // Здесь была «Основная» — звезда, ставившая метку фолбэком
                  // на все дни всех команд. Она уходит: то же самое будет
                  // выражаться недельным расписанием («по вторникам —
                  // Греция»), где видно, ЧТО и КОГДА, а не одна метка на всё
                  // сразу.
                  //
                  // Стороны те же, что у услуг: справа «Удалить», слева
                  // «Скрыть». Разрушительное действие на постоянном месте.
                  // ТРИ СОСТОЯНИЯ СТРОКИ — ТРИ РАЗНЫХ ЛЕВЫХ ДЕЙСТВИЯ:
                  //   живая    → «Скрыть»   (перестаёт предлагаться);
                  //   скрытая  → «Показать» (возвращается в выбор);
                  //   удалённая→ «Вернуть»  (снимается пометка на удаление).
                  // Подпись обязана называть то, что произойдёт: до правки
                  // удалённая предлагала «Скрыть», а по нажатию возвращалась.
                  leading={{
                    label: deleted
                      ? "Вернуть"
                      : hidden
                        ? "Показать"
                        : "Скрыть",
                    color: deleted || hidden ? t.success : t.warning,
                    icon: deleted || hidden ? RotateCcw : EyeOff,
                    accessibilityLabel: deleted
                      ? `Вернуть удалённую метку ${city.name}`
                      : hidden
                        ? `Показать метку ${city.name}`
                        : `Скрыть метку ${city.name}`,
                    onAction: () =>
                      updateCity.mutate(
                        {
                          id: city.id,
                          patch: deleted
                            ? { deleted_at: null, is_active: true }
                            : { is_active: !hidden },
                        },
                        {
                          onSuccess: () =>
                            toast(
                              deleted
                                ? "Метка возвращена"
                                : hidden
                                  ? "Метка показана"
                                  : "Метка скрыта",
                            ),
                          onError: alertError,
                        },
                      ),
                  }}
                >
                  {/* Содержимое кромки — РЯД: сама строка тянется, ручка едет
                      вместе с ней. Без явного направления `SwipeRow` сложил бы
                      их столбиком и удвоил высоту строки. */}
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      // Скрытая не исчезает и не кричит — просто тише живых.
                      opacity: deleted ? 0.3 : hidden ? 0.45 : 1,
                      backgroundColor: t.surface,
                    }}
                  >
                  <Pressable
                    onPress={() => setEditing({ mode: "edit", city })}
                    accessibilityRole="button"
                    accessibilityLabel={`Метка ${city.name}, редактировать`}
                    style={({ pressed }) => ({
                      flex: 1,
                      height: ROW_H,
                      flexDirection: "row",
                      alignItems: "center",
                      paddingLeft: 16,
                      backgroundColor: pressed ? t.pressed : t.surface,
                    })}
                  >
                    <View
                      style={{
                        height: 12,
                        width: 12,
                        borderRadius: 6,
                        backgroundColor: city.color ?? FALLBACK_COLOR,
                      }}
                    />
                    <Text
                      numberOfLines={1}
                      style={{
                        flexShrink: 1,
                        marginLeft: 12,
                        fontSize: 16,
                        color: t.ink,
                      }}
                    >
                      {city.name}
                    </Text>
                    <View style={{ flex: 1, minWidth: 8 }} />
                  </Pressable>
                  {/* Ручка — СНАРУЖИ нажимаемой области: вложенная внутрь, она
                      отдавала бы короткий тап строке и открывала редактор
                      вместо перетаскивания. */}
                  {handle}
                  </View>
                </SwipeRow>
                );
              }}
            </ReorderList>
          </SectionCard>
        </ScrollView>
      )}

      {/* ГЛАВНОЕ ДЕЙСТВИЕ ЭКРАНА — ВНИЗУ (LOCKED 2026-08-27, владелец: «когда
          открываю метку дня — кнопка снизу, как услуга, как и везде»).
          Кнопка стоит ВСЕГДА, а не только в пустом состоянии: метки заводят
          пачкой, и после первой не должно приходиться доскролливать список,
          чтобы завести вторую. Ровно тот же приём, что на экране услуг. */}
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 }}>
        <GradientButton
          label="Добавить метку"
          onPress={() => setEditing({ mode: "create" })}
        />
      </View>

      <LabelSheet
        editing={editing}
        takenBy={takenBy}
        daysOff={companyDaysOff}
        busy={busy}
        onClose={() => setEditing(null)}
        onCreate={add}
        onUpdate={edit}
      />
    </Screen>
  );
}

function LabelSheet({
  editing,
  takenBy,
  daysOff,
  busy,
  onClose,
  onCreate,
  onUpdate,
}: {
  editing: Editing | null;
  /** День недели → метка, которая его уже держит, вместе с её цветом. */
  takenBy: Map<number, { name: string; color: string | null }>;
  /** Дни, в которые не работает эта команда. */
  daysOff: Set<number>;
  busy: boolean;
  onClose: () => void;
  onCreate: (draft: LabelDraft) => void;
  onUpdate: (city: City, draft: LabelDraft) => void;
}) {
  const t = useThemeColors();
  const isEdit = editing?.mode === "edit";
  // key-remount через editing==null → null; локальный стейт инициализируем
  // от editing при каждом открытии (паттерн «render-time reset»).
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(FALLBACK_COLOR);
  // ДНИ НЕДЕЛИ — НЕОБЯЗАТЕЛЬНЫЙ ПАРАМЕТР, как «＋ Описание» у услуги. Пусто =
  // «ставлю руками»; это и есть поведение по умолчанию, поэтому блока сразу
  // нет — он появляется по кнопке.
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [hasWeekdays, setHasWeekdays] = useState(false);
  /** Заливать ли колонку дня цветом метки (владелец 2026-08-30: «не все
   *  метки должны подсвечиваться»). Имя на дате остаётся в любом случае. */
  const [tintDay, setTintDay] = useState(true);
  /** Почему день не берётся. Пишется под плитками, а не плашкой сверху:
   *  ответ обязан стоять там, где задан вопрос. */
  const [blockNote, setBlockNote] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<Editing | null>(null);

  if (editing !== seeded) {
    setSeeded(editing);
    setName(isEdit ? editing.city.name : "");
    setColor(
      isEdit ? editing.city.color ?? FALLBACK_COLOR : PRESET_COLOR_CYCLE[0].value,
    );
    const days = isEdit
      ? (editing.city.weekdays ?? []).filter((d) => d >= 1 && d <= 7)
      : [];
    setWeekdays(days);
    setHasWeekdays(days.length > 0);
    setTintDay(isEdit ? editing.city.tint_day ?? true : true);
  }

  const canSubmit = name.trim().length > 0 && !busy;

  // У ДНЯ ОДНА МЕТКА. Разрешить второй встать в тот же день — значит сделать
  // календарь недетерминированным: какая из двух покрасит понедельник,
  // зависело бы от порядка строк в ответе базы.
  //
  // Свой собственный день занятым не считаем: иначе метка отбирала бы день у
  // самой себя и её нельзя было бы пересохранить.
  const ownName = isEdit ? editing.city.name : null;
  // Кто держит день, решает сама проекция: у неё для этого уже есть и
  // `takenBy`, и `daysOff`, и имя метки. Второй счётчик здесь разошёлся бы
  // с первым.

  // ЛИСТ — КАНОНИЧЕСКИЙ `BottomSheet`, а не самописный `Modal animationType
  // ="slide"` (владелец 2026-08-17: «какая-то серая плашка поднимается вверх,
  // выглядит ужасно — сделай как везде»). Разница видна пальцем: у примитива
  // скрим гаснет на месте, лист приезжает пружиной, есть грабер и свайп вниз,
  // а системная «слайд-модалка» тащила вверх ВЕСЬ серый прямоугольник экрана.
  return (
    <BottomSheet
      visible={editing !== null}
      onClose={onClose}
      title={isEdit ? "Метка" : "Новая метка"}
      avoidKeyboard
      footer={
        <>
          <Button
            label={isEdit ? "Сохранить" : "Создать"}
            onPress={() => {
              const draft: LabelDraft = { name, color, weekdays, tintDay };
              if (isEdit) onUpdate(editing.city, draft);
              else onCreate(draft);
            }}
            disabled={!canSubmit}
            loading={busy}
          />
          {/* КНОПКИ «УДАЛИТЬ МЕТКУ» ЗДЕСЬ НЕТ (владелец 2026-08-30: «убираем,
              удалять будем только смахом вправо»).

              Она к тому же НЕ РАБОТАЛА: `confirmThen` рисуется
              `ChoiceSheetHost`, а тот показывает СВОЙ `BottomSheet` — второй
              `Modal`. На iOS окно, поданное пока предыдущее ещё закрывается,
              не появляется вовсе и об этом не сообщает; кнопка выглядела
              сломанной. Лечить это закрытием листа перед вопросом было можно,
              но незачем: удаление уже живёт на кромке свайпа, где список не в
              `Modal` и подтверждение показывается честно.

              Одно действие — одно место. */}
        </>
      }
    >
      {/* ТА ЖЕ СТРОКА, ЧТО У КАЛЕНДАРЯ И УСЛУГИ (владелец 2026-08-29:
          «делаем как везде по архитектуре»): цвет точкой слева, имя справа,
          один элемент вместо двух. Здесь стояли поле «Название» и отдельная
          строка «Цвет» — та самая пара, которую 27 августа уже свели в одну
          у календаря, а потом у услуги; метка осталась последней.

          ПОДСКАЗКИ НЕТ. «Лимассол, Германия, День ног…» подсказывала не
          формат, а СМЫСЛ — что вообще писать в метку, — и на пустом поле
          читалась как уже введённое значение. Метка это свободный текст,
          объяснять его примерами незачем. */}
      {/* БЕЗ СВОЕЙ ОБЁРТКИ: этот лист идёт с `padded` по умолчанию и уже
          добавляет `GUTTER` сам. Своя обёртка складывалась с его отступом, и
          поле метки выходило на 32pt уже, чем такое же поле в услуге, — а
          услуга гасит собственный отступ листа (`padded={false}`) и ставит
          `GUTTER` руками. Ширина обязана совпадать: это одна и та же строка
          в двух местах продукта. */}
      <NameColorField
        label="Название"
        name={name}
        onNameChange={setName}
        color={color}
        onColorChange={setColor}
        autoFocus
      />

      {/* В КАКИЕ ДНИ МЕТКА ВСТАЁТ САМА (владелец 2026-08-29: «сюда закинь
          выбор недели, чтобы автоматически метка проставлялась»).
          Заменяет «основную метку» — ту, что красила ВСЕ дни разом и была
          невидима с календаря. Здесь видно и ЧТО, и КОГДА.

          ПРОШЛОЕ НЕ ТРОГАЕТСЯ (канон, LOCKED 2026-08-29): расписание
          считается только для дат сегодня и вперёд, а прошедший день
          показывает то, что на нём фактически было. Поэтому смена дней не
          перекрашивает историю. */}
      {hasWeekdays ? (
        <View style={{ marginTop: 14, marginBottom: 4 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <FieldLabel text="Всегда по этим дням" />
            <Pressable
              onPress={() => {
                setHasWeekdays(false);
                setWeekdays([]);
                setBlockNote(null);
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Убрать автоматическую постановку"
              style={({ pressed }) => ({
                paddingBottom: 6,
                opacity: pressed ? 0.4 : 1,
              })}
            >
              <X color={t.faint} size={16} strokeWidth={2} />
            </Pressable>
          </View>

          {/* НЕДЕЛЯ ОДНИМ РЯДОМ БОЧОНКОВ (владелец 2026-08-30: «я хочу, чтоб
              это был один единый блок-бочонок… вместо чисел понедельник,
              вторник»). Плитка-переключатель и корешок метки под ней были
              двумя рядами про один и тот же день: сверху «выбрано» заливкой,
              снизу «будет так» настоящим тегом. Теперь это один элемент —
              колонка календаря, в которой вместо числа стоит день. */}
          <WeekProjection
            weekdays={weekdays}
            color={color}
            name={name}
            ownName={ownName}
            takenBy={takenBy}
            daysOff={daysOff}
            onToggle={(day) => {
              setBlockNote(null);
              setWeekdays(
                weekdays.includes(day)
                  ? weekdays.filter((x) => x !== day)
                  : [...weekdays, day].sort((a, b) => a - b),
              );
            }}
            // ЗАНЯТЫЙ ДЕНЬ НЕ МОЛЧИТ. Он и так называет хозяина корешком, но
            // корешок мелкий — тап повторяет это словами, целиком.
            onBlocked={(day, reason) =>
              setBlockNote(
                reason === "off"
                  ? `${WEEKDAY_FULL_BY_ISO[day]} — выходной у команды`
                  : `${WEEKDAY_FULL_BY_ISO[day]} занят меткой «${reason.holder}». У дня одна метка.`,
              )
            }
          />

          {blockNote ? (
            <Text
              maxFontSizeMultiplier={1.2}
              style={{
                marginTop: 8,
                fontSize: 13,
                lineHeight: 18,
                color: t.sub,
              }}
            >
              {blockNote}
            </Text>
          ) : null}
        </View>
      ) : (
        <Pressable
          // БЛОК ОТКРЫВАЕТСЯ ПУСТЫМ (владелец 2026-08-30: «когда нажимаю на
          // кнопку, оно не сразу всё горит, а можно выбирать»).
          //
          // Раньше зажигались все свободные дни — по его же просьбе от 29
          // августа «надо каждый день, выберу все; гасят лишние, а не
          // набирают с нуля». С зеркалом это перестало работать: блок
          // открывался УЖЕ С ГОТОВЫМ ответом, и неделя внизу мгновенно
          // заполнялась меткой на все семь дней — расписание, которого
          // человек не выбирал, показанное как решённое. Набрать три дня из
          // пустоты короче, чем погасить четыре из семи, и честнее: пустая
          // неделя внизу говорит правду — пока не выбрано ничего.
          onPress={() => setHasWeekdays(true)}
          hitSlop={8}
          accessibilityRole="button"
          // КНОПКА И ЗАГОЛОВОК РАЗНЫМИ СЛОВАМИ — НАМЕРЕННО. Заголовок
          // «Всегда по этим дням» работает только когда плитки уже под ним:
          // «этим» обязано на что-то указывать. В кнопке плиток ещё нет, и
          // то же слово указывало бы в пустоту — проверено на экране.
          // Кнопка говорит, ЧТО добавляешь; заголовок — что это значит.
          accessibilityLabel="По дням недели: в какие дни метка ставится сама"
          // ПОДНЯТА И ОТСТАВЛЕНА ОТ КНОПКИ (владелец 2026-08-30: «слишком
          // низко опущена — поднять выше и дать пространство до „Сохранить"»).
          // Прижатая к футеру, строчка читалась его частью: глаз видел две
          // кнопки подряд, хотя это приписка к форме и главное действие.
          style={({ pressed }) => ({
            alignSelf: "flex-start",
            paddingTop: 2,
            paddingBottom: 6,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 15, fontWeight: "500", color: t.accent }}
          >
            ＋ По дням недели
          </Text>
        </Pressable>
      )}

      {/* ПОДСВЕЧИВАТЬ ДЕНЬ — РЕШЕНИЕ САМОЙ МЕТКИ (владелец 2026-08-30: «не все
          дни надо подсвечивать, не все метки должны подсвечиваться»).

          СТОИТ ПОД ГРАФИКОМ, а не над ним: сперва «когда метка встаёт», потом
          «как она при этом выглядит». Обратный порядок спрашивал бы про вид
          того, чего ещё нет.

          ЭТО НЕ ВТОРОЙ ТУМБЛЕР РЯДОМ С КОМАНДНЫМ. Командный
          `tint_days_by_label` гасит заливку во всём календаре разом, и
          переключателя для него на мобильном нет вовсе — так что доступ к
          решению «красить или нет» появляется здесь впервые, и сразу на
          верном уровне: красить ли день, зависит от того, ЧТО за метка. */}
      <View
        style={{
          marginTop: 6,
          paddingTop: 6,
          // ВОЗДУХ ДО «СОХРАНИТЬ» (тот же счёт, что владелец предъявил
          // «Графику недели» 2026-08-30). Прижатая к футеру строка читается
          // его частью — а это приписка к форме, не второе главное действие.
          marginBottom: 12,
          borderTopWidth: 1,
          borderTopColor: t.separator,
        }}
      >
        <SwitchRow
          inset={false}
          label="Подсвечивать день"
          hint="Заливка колонки в календаре"
          value={tintDay}
          onChange={setTintDay}
        />
      </View>
    </BottomSheet>
  );
}
