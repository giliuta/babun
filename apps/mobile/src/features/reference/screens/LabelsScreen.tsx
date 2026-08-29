import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { MapPin, Star, Trash2 } from "lucide-react-native";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import { NameColorField } from "@/components/ui/picker-fields";
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
  useUpdateCity,
  useUpdateTeam,
  type City,
} from "@/features/reference/queries";

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

export function LabelsScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const citiesQuery = useCities();
  const teamsQuery = useTeams();
  const dayCitiesQuery = useDayCities();
  const cities = useMemo(() => citiesQuery.data ?? [], [citiesQuery.data]);
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const dayCities = useMemo(
    () => dayCitiesQuery.data ?? {},
    [dayCitiesQuery.data],
  );
  const isLoading =
    citiesQuery.isLoading || teamsQuery.isLoading || dayCitiesQuery.isLoading;
  const error = citiesQuery.error || teamsQuery.error || dayCitiesQuery.error;
  const createCity = useCreateCity();
  const updateCity = useUpdateCity();
  const deleteCity = useDeleteCity();
  const reorder = useReorderCities();
  const updateTeam = useUpdateTeam();
  const cascade = useRenameLabelCascade();

  const [editing, setEditing] = useState<Editing | null>(null);
  const [dragging, setDragging] = useState(false);

  // ОСНОВНАЯ МЕТКА — та, что стоит на КАЖДОМ дне сама (владелец 2026-08-17:
  // «ставлю звёздочку, делаю её основной — и тогда она проставляет
  // автоматически на всех днях»). Механика в продукте уже была: календарь
  // читает метку дня как «явная (day_cities) → основная команды
  // (teams.default_city)», поэтому звезда ничего не пишет по дням — она
  // задаёт ФОЛБЭК. Иначе снятие звезды пришлось бы разгребать по тысяче дат.
  //
  // Метки общие на компанию, поэтому и звезда общая: она ставится всем
  // календарям сразу. Звезда горит, только если у ВСЕХ команд основная одна и
  // та же — при разнобое (кто-то поставил свою в настройках команды) список
  // молчит, а не выбирает за человека, чья правда важнее.
  const defaultName = useMemo(() => {
    if (teams.length === 0) return null;
    // Пустая строка — это тоже «не выбрано»: в проде у одной команды лежит
    // `''` из веб-мастера, и без нормализации она считалась бы четвёртым
    // мнением о том, какая метка основная.
    const names = new Set(teams.map((tm) => tm.default_city || null));
    return names.size === 1 ? ([...names][0] ?? null) : null;
  }, [teams]);

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
      if (team.default_city) names.add(team.default_city);
      for (const n of names) bump(n, "teams");
    }
    for (const name of Object.values(dayCities)) bump(name, "days");
    return m;
  }, [teams, dayCities]);

  const alertError = (e: unknown) =>
    notify("Ошибка", e instanceof Error ? e.message : "Не удалось сохранить");

  const setDefault = (city: City) => {
    const next = defaultName === city.name ? null : city.name;
    const targets = teams.filter((tm) => (tm.default_city || null) !== next);
    if (targets.length === 0) return;
    void Promise.all(
      targets.map((tm) =>
        updateTeam.mutateAsync({ id: tm.id, patch: { default_city: next } }),
      ),
    )
      .then(() =>
        toast(next ? `Основная метка: ${next}` : "Основная метка снята"),
      )
      .catch(alertError);
  };

  const add = async (name: string, color: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const existing = cities.find(
        (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (existing) {
        // Уже в библиотеке — просто обновляем цвет.
        await updateCity.mutateAsync({ id: existing.id, patch: { color } });
      } else {
        await createCity.mutateAsync({ name: trimmed, color });
      }
      setEditing(null);
      toast("Метка добавлена");
    } catch (e) {
      alertError(e); // шит остаётся открытым — ввод не теряется
    }
  };

  const edit = async (city: City, newName: string, color: string) => {
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
        await updateCity.mutateAsync({ id: collision.id, patch: { color } });
        await deleteCity.mutateAsync(city.id);
      } else {
        await updateCity.mutateAsync({
          id: city.id,
          patch: { name: trimmed, color },
        });
      }
      if (renamed) {
        const failures = await cascade.run(city.name, target);
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

  const remove = (city: City) => {
    const u = usage.get(city.name);
    const used = u && (u.teams > 0 || u.days > 0);
    confirmThen(
      "Удалить метку?",
      {
        message: used
          ? `«${city.name}» исчезнет из выбора. Команды и дни, где она уже назначена, останутся с серой меткой.`
          : `«${city.name}» будет скрыта из библиотеки.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      async () => {
        try {
          await deleteCity.mutateAsync(city.id);
          setEditing(null);
          toast("Метка удалена");
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
      <ScreenHeader title="Метки" subtitle="Календарь" />

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
              {(city, _index, handle) => (
                <SwipeRow
                  label="Удалить"
                  color={t.danger}
                  icon={Trash2}
                  accessibilityLabel={`Удалить метку ${city.name}`}
                  onAction={() => remove(city)}
                  // ЗВЕЗДА ЖИВЁТ В ЖЕСТЕ, А НЕ В СТРОКЕ (владелец 2026-08-17):
                  // кнопка в каждой строке — это колонка кнопок, которая
                  // спорит с именем за ширину, хотя нажимают её раз в год.
                  // Тянут вправо — как «прочитано» в почте.
                  leading={{
                    label: defaultName === city.name ? "Снять" : "Основная",
                    color: t.accent,
                    icon: Star,
                    accessibilityLabel:
                      defaultName === city.name
                        ? `Снять основную метку ${city.name}`
                        : `Сделать ${city.name} основной меткой`,
                    onAction: () => setDefault(city),
                  }}
                >
                  {/* Содержимое кромки — РЯД: сама строка тянется, ручка едет
                      вместе с ней. Без явного направления `SwipeRow` сложил бы
                      их столбиком и удвоил высоту строки. */}
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
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
                    {/* ОСНОВНУЮ ВИДНО БЕЗ ЖЕСТА — звёздочка стоит ОТМЕТКОЙ у
                        имени, а не кнопкой: нажимать её незачем (ставит и
                        снимает свайп), а ответ «какая метка стоит на всех
                        днях» обязан читаться со списка. */}
                    {defaultName === city.name ? (
                      <Star
                        size={14}
                        strokeWidth={2}
                        color={t.accent}
                        fill={t.accent}
                        style={{ marginLeft: 6 }}
                      />
                    ) : null}
                    <View style={{ flex: 1, minWidth: 8 }} />
                  </Pressable>
                  {/* Ручка — СНАРУЖИ нажимаемой области: вложенная внутрь, она
                      отдавала бы короткий тап строке и открывала редактор
                      вместо перетаскивания. */}
                  {handle}
                  </View>
                </SwipeRow>
              )}
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
        busy={busy}
        onClose={() => setEditing(null)}
        onCreate={add}
        onUpdate={edit}
        onRemove={remove}
      />
    </Screen>
  );
}

function LabelSheet({
  editing,
  busy,
  onClose,
  onCreate,
  onUpdate,
  onRemove,
}: {
  editing: Editing | null;
  busy: boolean;
  onClose: () => void;
  onCreate: (name: string, color: string) => void;
  onUpdate: (city: City, newName: string, color: string) => void;
  onRemove: (city: City) => void;
}) {
  const t = useThemeColors();
  const isEdit = editing?.mode === "edit";
  // key-remount через editing==null → null; локальный стейт инициализируем
  // от editing при каждом открытии (паттерн «render-time reset»).
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(FALLBACK_COLOR);
  const [seeded, setSeeded] = useState<Editing | null>(null);

  if (editing !== seeded) {
    setSeeded(editing);
    setName(isEdit ? editing.city.name : "");
    setColor(
      isEdit ? editing.city.color ?? FALLBACK_COLOR : PRESET_COLOR_CYCLE[0].value,
    );
  }

  const canSubmit = name.trim().length > 0 && !busy;

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
              isEdit ? onUpdate(editing.city, name, color) : onCreate(name, color)
            }
            disabled={!canSubmit}
            loading={busy}
          />
          {isEdit ? (
            <Pressable
              onPress={() => onRemove(editing.city)}
              accessibilityRole="button"
              accessibilityLabel="Удалить метку"
              className="mt-1 items-center py-3 active:opacity-70"
            >
              <Text style={{ fontSize: 16, fontWeight: "500", color: t.danger }}>
                Удалить метку
              </Text>
            </Pressable>
          ) : null}
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
    </BottomSheet>
  );
}
