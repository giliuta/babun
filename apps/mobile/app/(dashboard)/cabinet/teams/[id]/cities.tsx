import { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { MapPin, Star } from "lucide-react-native";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import { ColorField } from "@/components/ui/picker-fields";
import { Chip } from "@/components/ui/Chip";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { AddRow } from "@/components/ui/AddRow";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useToast } from "@/components/ui/Toast";
import {
  teamCities,
  useCities,
  useCreateCity,
  useTeam,
  useTeams,
  useUpdateCity,
  useUpdateTeam,
  type City,
} from "@/features/reference/queries";

// Метки команды — web parity teams/[id]/cities (BrigadeCitiesPage).
// Список меток команды = team.cities[] (имена). Цвет каждой метки берём
// из глобального справочника `cities` по имени (метка и город — одна
// сущность). Основная метка = team.default_city (★ красит день на
// календаре). Тумблер «Подсвечивать день» = team.tint_days_by_label.
// НЕ дублируем CRUD городов: имена храним в team.cities через useUpdateTeam,
// а библиотечные записи (цвет) — через useCreateCity/useUpdateCity.

const FALLBACK_COLOR = "#8E8E93";

type Editing =
  | { mode: "create" }
  | { mode: "edit"; name: string; color: string };

export default function TeamCitiesScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: team, isLoading: teamLoading } = useTeam(id);
  const { data: cities = [], isLoading: citiesLoading } = useCities();
  const { data: teams = [] } = useTeams();
  const update = useUpdateTeam();
  const createCity = useCreateCity();
  const updateCity = useUpdateCity();

  const [editing, setEditing] = useState<Editing | null>(null);

  const brigadeCityNames = useMemo(
    () => (team ? teamCities(team) : []),
    [team],
  );
  const defaultCity = team?.default_city ?? "";
  const effectiveBase =
    defaultCity && brigadeCityNames.includes(defaultCity) ? defaultCity : "";

  // Имя → запись библиотеки (цвет). Пропавшие из библиотеки имена получают
  // серую «призрачную» строку, чтобы её всё ещё можно было открыть/удалить.
  const rows = useMemo(
    () =>
      brigadeCityNames.map((name) => {
        const hit = cities.find((c) => c.name === name);
        return { name, color: hit?.color ?? FALLBACK_COLOR };
      }),
    [brigadeCityNames, cities],
  );

  // Метки других команд, ещё не добавленные сюда — быстрые подсказки в шите.
  const suggestions = useMemo<City[]>(() => {
    const inUse = new Set<string>();
    for (const tm of teams) {
      if (tm.id === id) continue;
      for (const n of teamCities(tm)) inUse.add(n);
    }
    return cities
      .filter(
        (c) =>
          inUse.has(c.name) &&
          !brigadeCityNames.some(
            (n) => n.toLowerCase() === c.name.toLowerCase(),
          ),
      )
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [cities, teams, id, brigadeCityNames]);

  const alertError = (e: unknown) =>
    Alert.alert("Ошибка", e instanceof Error ? e.message : "Не удалось сохранить");

  // default_city остаётся, только если ещё в списке; иначе сбрасываем в ""
  // (web parity: нет принудительного отката на первый элемент).
  const resolveBase = (next: string[], prev: string): string =>
    prev && next.includes(prev) ? prev : "";

  const persistCities = async (next: string[], prevBase: string) => {
    await update.mutateAsync({
      id: id as string,
      patch: {
        cities: next,
        default_city: resolveBase(next, prevBase),
      },
    });
  };

  const addCity = async (name: string, color: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      // Совпадение по имени — переиспользуем запись библиотеки; иначе
      // создаём новую с выбранным цветом (цвет метки консистентен между
      // командами).
      const existing = cities.find(
        (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
      );
      let resolvedName = trimmed;
      if (existing) {
        resolvedName = existing.name;
      } else {
        await createCity.mutateAsync({ name: trimmed, color });
      }
      if (!brigadeCityNames.includes(resolvedName)) {
        await persistCities([...brigadeCityNames, resolvedName], defaultCity);
      }
      setEditing(null);
      toast("Метка добавлена");
    } catch (e) {
      alertError(e); // шит остаётся открытым — ввод не теряется
    }
  };

  const editCity = async (oldName: string, newName: string, color: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      const current = cities.find((c) => c.name === oldName);
      const collision =
        trimmed.toLowerCase() !== oldName.toLowerCase()
          ? cities.find((c) => c.name.toLowerCase() === trimmed.toLowerCase())
          : undefined;
      if (collision) {
        // Переименование в уже существующую метку — цвет уходит в целевую
        // запись (старую библиотечную не трогаем: другие команды могут ещё
        // на неё ссылаться; здесь важен только рефренс по имени).
        await updateCity.mutateAsync({ id: collision.id, patch: { color } });
      } else if (current) {
        await updateCity.mutateAsync({
          id: current.id,
          patch: { name: trimmed, color },
        });
      } else if (trimmed !== oldName) {
        // «Призрачная» метка без записи в библиотеке — заводим её.
        await createCity.mutateAsync({ name: trimmed, color });
      }
      if (trimmed !== oldName) {
        const next = Array.from(
          new Set(brigadeCityNames.map((n) => (n === oldName ? trimmed : n))),
        );
        await update.mutateAsync({
          id: id as string,
          patch: {
            cities: next,
            default_city: defaultCity === oldName ? trimmed : defaultCity,
          },
        });
      }
      setEditing(null);
      toast("Метка обновлена");
    } catch (e) {
      alertError(e);
    }
  };

  const removeCity = (name: string) => {
    Alert.alert("Убрать метку?", `«${name}» останется в библиотеке городов.`, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Убрать",
        style: "destructive",
        onPress: async () => {
          try {
            await persistCities(
              brigadeCityNames.filter((n) => n !== name),
              defaultCity === name ? "" : defaultCity,
            );
            setEditing(null);
          } catch (e) {
            alertError(e);
          }
        },
      },
    ]);
  };

  const setBase = (name: string) => {
    // Toggle: повторный тап по звезде основной метки снимает её.
    const next = effectiveBase === name ? "" : name;
    update.mutate(
      { id: id as string, patch: { default_city: next } },
      { onError: alertError },
    );
  };

  const setTint = (next: boolean) => {
    update.mutate(
      { id: id as string, patch: { tint_days_by_label: next } },
      { onError: alertError },
    );
  };

  const isLoading = teamLoading || citiesLoading;

  if (isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Метки" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (!team) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Метки" />
        <EmptyState title="Команда не найдена" fill />
      </Screen>
    );
  }

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Метки" subtitle={team.name} />

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        {/* Тумблер тинта — когда выключен, столбец дня остаётся белым. */}
        <SectionCard>
          <View className="flex-row items-center px-4 py-3">
            <View className="flex-1 pr-3">
              <Text style={{ fontSize: 16, color: t.ink }}>
                Подсвечивать день цветом метки
              </Text>
              <Text style={{ fontSize: 12, color: t.faint, marginTop: 2 }}>
                Столбец дня окрашивается в цвет основной метки. Выключи —
                столбец остаётся белым.
              </Text>
            </View>
            <Switch
              value={team.tint_days_by_label ?? true}
              onValueChange={setTint}
              trackColor={{ true: t.accent }}
              accessibilityLabel="Подсвечивать день цветом метки"
            />
          </View>
        </SectionCard>

        {rows.length === 0 ? (
          <EmptyState
            icon={<MapPin color={t.accent} size={28} />}
            title="У команды пока нет меток"
            subtitle="Добавьте пару меток и пометьте одну звездой как основную — она автоматически появится под каждой датой своим цветом."
            action={{
              label: "Добавить метку",
              onPress: () => setEditing({ mode: "create" }),
            }}
          />
        ) : (
          <SectionCard className="mt-5">
            {rows.map((row, i) => (
              <View key={row.name}>
                {i > 0 ? <Divider inset={44} /> : null}
                <View className="flex-row items-center pl-4 pr-1">
                  <Pressable
                    onPress={() =>
                      setEditing({ mode: "edit", name: row.name, color: row.color })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Метка ${row.name}, редактировать`}
                    className="flex-1 flex-row items-center py-3.5 active:opacity-60"
                  >
                    <View
                      style={{
                        height: 12,
                        width: 12,
                        borderRadius: 6,
                        backgroundColor: row.color,
                      }}
                    />
                    <Text
                      className="ml-3 flex-1 text-base"
                      style={{ color: t.ink }}
                      numberOfLines={1}
                    >
                      {row.name}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setBase(row.name)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={
                      effectiveBase === row.name
                        ? `Снять основную метку ${row.name}`
                        : `Сделать ${row.name} основной`
                    }
                    className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
                  >
                    <Star
                      color={effectiveBase === row.name ? t.warning : t.chevron}
                      fill={effectiveBase === row.name ? t.warning : "none"}
                      size={ICON.sm}
                    />
                  </Pressable>
                </View>
              </View>
            ))}
            <Divider inset={44} />
            <AddRow
              label="Добавить метку"
              onPress={() => setEditing({ mode: "create" })}
            />
          </SectionCard>
        )}

        <Text className="mx-4 mt-3 text-xs leading-4" style={{ color: t.faint }}>
          {effectiveBase
            ? "Основная метка (★) автоматически красит новые даты своим цветом."
            : "Нет основной — под каждой датой серая плашка выбора метки. Выделите одну звездой."}
        </Text>
      </ScrollView>

      <LabelSheet
        editing={editing}
        suggestions={suggestions}
        busy={update.isPending || createCity.isPending || updateCity.isPending}
        onClose={() => setEditing(null)}
        onCreate={addCity}
        onUpdate={editCity}
        onRemove={removeCity}
      />
    </Screen>
  );
}

function LabelSheet({
  editing,
  suggestions,
  busy,
  onClose,
  onCreate,
  onUpdate,
  onRemove,
}: {
  editing: Editing | null;
  suggestions: City[];
  busy: boolean;
  onClose: () => void;
  onCreate: (name: string, color: string) => void;
  onUpdate: (oldName: string, newName: string, color: string) => void;
  onRemove: (name: string) => void;
}) {
  const t = useThemeColors();
  const isEdit = editing?.mode === "edit";
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(FALLBACK_COLOR);
  const [seeded, setSeeded] = useState<Editing | null>(null);

  if (editing !== seeded) {
    // Новый показ шита — засеять поля (паттерн «render-time reset»).
    setSeeded(editing);
    setName(isEdit ? editing.name : "");
    setColor(isEdit ? editing.color : PRESET_COLOR_CYCLE[0].value);
  }

  const canSubmit = name.trim().length > 0 && !busy;

  return (
    <Modal
      visible={editing !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          className="flex-1"
          style={{ backgroundColor: t.scrim }}
          onPress={onClose}
          accessible={false}
        />
        <View
          className="rounded-t-[10px] p-5 pb-8"
          style={{ backgroundColor: t.surface }}
        >
          <Text className="mb-3 text-lg font-bold" style={{ color: t.ink }}>
            {isEdit ? "Метка" : "Новая метка"}
          </Text>

          <Field
            label="Название"
            value={name}
            onChangeText={setName}
            placeholder="Лимассол, Германия, День ног…"
            autoFocus
          />

          <ColorField value={color} onChange={setColor} />

          {!isEdit && suggestions.length > 0 ? (
            <>
              <Text className="mb-2 text-xs font-medium" style={{ color: t.sub }}>
                Уже используются в командах
              </Text>
              <View className="mb-4 flex-row flex-wrap gap-2">
                {suggestions.slice(0, 8).map((c) => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    disabled={busy}
                    onPress={() => onCreate(c.name, c.color ?? FALLBACK_COLOR)}
                    accessibilityLabel={`Добавить метку ${c.name}`}
                    icon={
                      <View
                        style={{
                          height: 8,
                          width: 8,
                          borderRadius: 4,
                          backgroundColor: c.color ?? FALLBACK_COLOR,
                        }}
                      />
                    }
                  />
                ))}
              </View>
            </>
          ) : null}

          <Button
            label={isEdit ? "Сохранить" : "Создать"}
            onPress={() =>
              isEdit ? onUpdate(editing.name, name, color) : onCreate(name, color)
            }
            disabled={!canSubmit}
            loading={busy}
          />
          {isEdit ? (
            <Pressable
              onPress={() => onRemove(editing.name)}
              accessibilityRole="button"
              accessibilityLabel="Убрать метку из команды"
              className="mt-1 items-center py-3 active:opacity-70"
            >
              <Text style={{ fontSize: 16, fontWeight: "500", color: t.danger }}>
                Убрать из команды
              </Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
