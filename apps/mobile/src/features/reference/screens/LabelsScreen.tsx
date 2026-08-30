import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { getStorage } from "@babun/shared/storage";
import { Pressable, ScrollView, Text, View } from "react-native";
import { EyeOff, MapPin, RotateCcw, Trash2, X } from "lucide-react-native";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import { NameColorField } from "@/components/ui/picker-fields";
import { FieldLabel } from "@/components/ui/Field";
import { WEEKDAY_LABELS } from "@babun/shared/local/services";

import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { GradientButton } from "@/components/ui/GradientButton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ReorderList } from "@/components/ui/ReorderList";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { useThemeColors } from "@/theme/colors";
import { useToast } from "@/components/ui/Toast";
import { useDayCities } from "@/features/calendar/day-cities";
import { useAllTeamSchedules } from "@/features/reference/team-schedule";
import { allDays, ISO_BY_KEY } from "@/features/calendar/schedule-days";
import { useRenameLabelCascade } from "@/features/reference/label-cascade";
import { notify } from "@/lib/notify";
import { confirmThen } from "@/lib/confirm";
import {
  teamCities,
  useCities,
  useCreateCity,
  useDeleteCity,
  useReorderCities,
  useTeams,
  usePurgeExpiredCities,
  useUpdateCity,
  type City,
} from "@/features/reference/queries";

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

  // Использование метки: сколько команд подключили + на скольких днях висит.
  const usage = useMemo(() => {
    const m = new Map<string, { teams: number; days: number }>();
    const bump = (name: string, key: "teams" | "days") => {
      const cur = m.get(name) ?? { teams: 0, days: 0 };
      cur[key] += 1;
      m.set(name, cur);
    };
    for (const team of teams) {
      const names = new Set(teamCities(team));
      for (const n of names) bump(n, "teams");
    }
    for (const name of Object.values(dayCities)) bump(name, "days");
    return m;
  }, [teams, dayCities]);

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
  const takenBy = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of cities) {
      if (!c.is_active || c.deleted_at) continue;
      for (const d of c.weekdays ?? []) if (!m.has(d)) m.set(d, c.name);
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

  const add = async (name: string, color: string, weekdays: number[]) => {
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
          patch: { color, weekdays },
        });
      } else {
        if (!teamId) return;
        await createCity.mutateAsync({
          name: trimmed,
          color,
          weekdays,
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
    newName: string,
    color: string,
    weekdays: number[],
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
          patch: { color, weekdays },
        });
        await deleteCity.mutateAsync(city.id);
      } else {
        await updateCity.mutateAsync({
          id: city.id,
          patch: { name: trimmed, color, weekdays },
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
    const u = usage.get(city.name);
    const used = u && (u.teams > 0 || u.days > 0);
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
  /** День недели → имя метки, которая его уже держит. */
  takenBy: Map<number, string>;
  /** Дни, в которые не работает НИ ОДНА команда. */
  daysOff: Set<number>;
  busy: boolean;
  onClose: () => void;
  onCreate: (name: string, color: string, weekdays: number[]) => void;
  onUpdate: (
    city: City,
    newName: string,
    color: string,
    weekdays: number[],
  ) => void;
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
  }

  const canSubmit = name.trim().length > 0 && !busy;

  // У ДНЯ ОДНА МЕТКА. Разрешить второй встать в тот же день — значит сделать
  // календарь недетерминированным: какая из двух покрасит понедельник,
  // зависело бы от порядка строк в ответе базы.
  //
  // Свой собственный день занятым не считаем: иначе метка отбирала бы день у
  // самой себя и её нельзя было бы пересохранить.
  const ownName = isEdit ? editing.city.name : null;
  const blockedBy = (day: number): string | null => {
    if (daysOff.has(day)) return "выходной";
    const holder = takenBy.get(day);
    return holder && holder !== ownName ? holder : null;
  };

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
            onPress={() =>
              isEdit
                ? onUpdate(editing.city, name, color, weekdays)
                : onCreate(name, color, weekdays)
            }
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
        <View style={{ marginTop: 14, marginBottom: 8 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <FieldLabel text="График недели" />
            <Pressable
              onPress={() => {
                setHasWeekdays(false);
                setWeekdays([]);
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
          <View style={{ flexDirection: "row", gap: 6 }}>
            {([1, 2, 3, 4, 5, 6, 7] as const).map((day) => {
              const blocked = blockedBy(day);
              const on = weekdays.includes(day) && !blocked;
              return (
                <Pressable
                  key={day}
                  onPress={() => {
                    // ЗАНЯТЫЙ ДЕНЬ НЕ МОЛЧИТ. Погашенная плитка без ответа
                    // читается как поломка; она обязана сказать, КЕМ занята.
                    if (blocked) {
                      setBlockNote(
                        blocked === "выходной"
                          ? `${WEEKDAY_FULL_BY_ISO[day]} — выходной у всех команд`
                          : `${WEEKDAY_FULL_BY_ISO[day]} занят меткой «${blocked}»`,
                      );
                      return;
                    }
                    setBlockNote(null);
                    setWeekdays(
                      on
                        ? weekdays.filter((x) => x !== day)
                        : [...weekdays, day].sort((a, b) => a - b),
                    );
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: !!blocked }}
                  accessibilityLabel={
                    blocked
                      ? `${WEEKDAY_LABELS[day]} — занят: ${blocked}`
                      : `${WEEKDAY_LABELS[day]} — ${on ? "ставится" : "не ставится"}`
                  }
                  style={({ pressed }) => ({
                    flex: 1,
                    height: 44,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: t.radius.card,
                    borderCurve: "continuous",
                    backgroundColor: on ? color : t.fill,
                    // Занятый гасится, но остаётся нажимаемым: тап — это его
                    // способ объяснить, почему он не берётся.
                    opacity: blocked ? 0.35 : pressed ? 0.6 : 1,
                  })}
                >
                  <Text
                    maxFontSizeMultiplier={1.2}
                    style={{
                      fontSize: 14,
                      fontWeight: on ? "700" : "500",
                      color: on ? "#ffffff" : t.faint,
                    }}
                  >
                    {WEEKDAY_LABELS[day]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
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
          onPress={() => {
            setHasWeekdays(true);
            // Все семь: «надо каждый день — выберу все» (владелец). Гасят из
            // них лишние, а не набирают нужные с нуля.
            // ВСЕ СВОБОДНЫЕ, а не все семь: занятые чужой меткой или общим
            // выходным всё равно не встанут, и подсвечивать их было бы
            // обещанием, которое сохранение не выполнит.
            if (weekdays.length === 0) {
              setWeekdays(
                [1, 2, 3, 4, 5, 6, 7].filter((d) => !blockedBy(d)),
              );
            }
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="График недели: в какие дни метка ставится сама"
          // ПОДНЯТА И ОТСТАВЛЕНА ОТ КНОПКИ (владелец 2026-08-30: «слишком
          // низко опущена — поднять выше и дать пространство до „Сохранить"»).
          // Прижатая к футеру, строчка читалась его частью: глаз видел две
          // кнопки подряд, хотя это приписка к форме и главное действие.
          style={({ pressed }) => ({
            alignSelf: "flex-start",
            paddingTop: 2,
            paddingBottom: 18,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 15, fontWeight: "500", color: t.accent }}
          >
            ＋ График недели
          </Text>
        </Pressable>
      )}
    </BottomSheet>
  );
}
