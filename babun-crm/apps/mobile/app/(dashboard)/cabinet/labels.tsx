import { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { MapPin } from "lucide-react-native";
import { PRESET_COLORS } from "@babun/shared/common/utils/colors";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { AddRow } from "@/components/ui/AddRow";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useThemeColors } from "@/theme/colors";
import { useToast } from "@/components/ui/Toast";
import { useDayCities } from "@/features/calendar/day-cities";
import { useRenameLabelCascade } from "@/features/reference/label-cascade";
import {
  teamCities,
  useCities,
  useCreateCity,
  useDeleteCity,
  useTeams,
  useUpdateCity,
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

const FALLBACK_COLOR = "#8E8E93";

type Editing =
  | { mode: "create" }
  | { mode: "edit"; city: City };

export default function LabelsScreen() {
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
  const cascade = useRenameLabelCascade();

  const [editing, setEditing] = useState<Editing | null>(null);

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

  const usageLine = (name: string): string => {
    const u = usage.get(name);
    if (!u || (u.teams === 0 && u.days === 0)) return "не используется";
    const parts: string[] = [];
    if (u.teams > 0) parts.push(`команд: ${u.teams}`);
    if (u.days > 0) parts.push(`дней: ${u.days}`);
    return parts.join(" · ");
  };

  const alertError = (e: unknown) =>
    Alert.alert("Ошибка", e instanceof Error ? e.message : "Не удалось сохранить");

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
          Alert.alert(
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
    Alert.alert(
      "Удалить метку?",
      used
        ? `«${city.name}» исчезнет из выбора. Команды и дни, где она уже назначена, останутся с серой меткой.`
        : `«${city.name}» будет скрыта из библиотеки.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteCity.mutateAsync(city.id);
              setEditing(null);
              toast("Метка удалена");
            } catch (e) {
              alertError(e);
            }
          },
        },
      ],
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
          subtitle="Лимассол, Германия, День ног — метка вешается на день тапом по шапке даты в календаре и красит колонку своим цветом."
          action={{ label: "Добавить метку", onPress: () => setEditing({ mode: "create" }) }}
        />
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
          <SectionCard>
            {cities.map((city, i) => (
              <View key={city.id}>
                {i > 0 ? <Divider inset={44} /> : null}
                <Pressable
                  onPress={() => setEditing({ mode: "edit", city })}
                  accessibilityRole="button"
                  accessibilityLabel={`Метка ${city.name}, редактировать`}
                  className="flex-row items-center px-4 py-3 active:opacity-60"
                >
                  <View
                    style={{
                      height: 12,
                      width: 12,
                      borderRadius: 6,
                      backgroundColor: city.color ?? FALLBACK_COLOR,
                    }}
                  />
                  <View className="ml-3 min-w-0 flex-1">
                    <Text className="text-base" style={{ color: t.ink }} numberOfLines={1}>
                      {city.name}
                    </Text>
                    <Text className="text-xs" style={{ color: t.faint }}>
                      {usageLine(city.name)}
                    </Text>
                  </View>
                </Pressable>
              </View>
            ))}
            <Divider inset={44} />
            <AddRow
              label="Добавить метку"
              onPress={() => setEditing({ mode: "create" })}
            />
          </SectionCard>

          <Text className="mx-4 mt-3 text-xs leading-4" style={{ color: t.faint }}>
            Метка вешается на день тапом по шапке даты в календаре. Наборы
            меток команды и её основная метка — в настройках команды
            (Кабинет → Команды → Метки).
          </Text>
        </ScrollView>
      )}

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
      isEdit ? editing.city.color ?? FALLBACK_COLOR : PRESET_COLORS[0].value,
    );
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
          className="rounded-t-3xl p-5 pb-8"
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

          <ColorPicker value={color} onChange={setColor} />

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
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
