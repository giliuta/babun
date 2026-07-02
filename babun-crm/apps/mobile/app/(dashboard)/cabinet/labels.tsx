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
import { MapPin, Plus, Star } from "lucide-react-native";
import { PRESET_COLORS } from "@babun/shared/common/utils/colors";
import { ColorPicker } from "@/components/ui/ColorPicker";
import type { CalendarSettings } from "@babun/shared/local/calendar-settings";
import { Chip } from "@/components/ui/Chip";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useToast } from "@/components/ui/Toast";
import {
  useCalendarSettings,
  useSaveCalendarSettings,
} from "@/features/settings/local-settings";
import {
  useCities,
  useCreateCity,
  useDeleteCity,
  useTeams,
  useUpdateCity,
  type City,
} from "@/features/reference/queries";

// Метки личного календаря — порт веб-страницы
// /dashboard/settings/calendar/labels (v492). Список имён живёт в
// calendar_settings.personal_labels (+ personal_default_label = основная);
// библиотека имён с цветами — таблица `cities` (метка и город — одна
// сущность, web parity). Свайпов нет — тап по строке открывает редактор,
// звезда справа переключает основную.

const FALLBACK_COLOR = "#8E8E93";

type Editing =
  | { mode: "create" }
  | { mode: "edit"; name: string; color: string };

export default function LabelsScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const { data: settings, isLoading: settingsLoading } = useCalendarSettings();
  const { data: cities = [], isLoading: citiesLoading } = useCities();
  const { data: teams = [] } = useTeams();
  const save = useSaveCalendarSettings();
  const createCity = useCreateCity();
  const updateCity = useUpdateCity();
  const deleteCity = useDeleteCity();

  const [editing, setEditing] = useState<Editing | null>(null);

  const personalLabels = useMemo(
    () => settings?.personalLabels ?? [],
    [settings],
  );
  const defaultLabel = settings?.personalDefaultLabel ?? "";
  const effectiveBase =
    defaultLabel && personalLabels.includes(defaultLabel) ? defaultLabel : "";

  // Имя → запись библиотеки (цвет). Пропавшие из библиотеки имена получают
  // серую «призрачную» строку, чтобы её всё ещё можно было открыть/удалить.
  const rows = useMemo(
    () =>
      personalLabels.map((name) => {
        const hit = cities.find((c) => c.name === name);
        return {
          name,
          color: hit?.color ?? FALLBACK_COLOR,
        };
      }),
    [personalLabels, cities],
  );

  // Метки, уже используемые бригадами (team.cities), но ещё не добавленные
  // в личный список — быстрые подсказки в шите «Новая метка» (web parity).
  const suggestions = useMemo<City[]>(() => {
    const inUse = new Set<string>();
    for (const team of teams) {
      const list = team.cities;
      if (Array.isArray(list)) {
        for (const n of list) if (typeof n === "string") inUse.add(n);
      }
    }
    return cities
      .filter(
        (c) =>
          inUse.has(c.name) &&
          !personalLabels.some(
            (n) => n.toLowerCase() === c.name.toLowerCase(),
          ),
      )
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [cities, teams, personalLabels]);

  const alertError = (e: unknown) =>
    Alert.alert("Ошибка", e instanceof Error ? e.message : "Не удалось сохранить");

  const resolveBase = (next: string[], prev: string): string =>
    prev && next.includes(prev) ? prev : "";

  const persist = async (nextLabels: string[], prevBase: string) => {
    // Массив уходит как есть (даже пустой) — репозиторий пишет [] как null,
    // но явная запись нужна, чтобы очистить хвост при удалении последней
    // метки (v493 web fix).
    const patch: Partial<CalendarSettings> = {
      personalLabels: nextLabels,
      personalDefaultLabel: resolveBase(nextLabels, prevBase),
    };
    await save.mutateAsync(patch);
  };

  const addLabel = async (name: string, color: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      // Совпадение по имени — переиспользуем запись библиотеки; иначе
      // создаём новую с выбранным цветом.
      const existing = cities.find(
        (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
      );
      let resolvedName = trimmed;
      if (existing) {
        resolvedName = existing.name;
      } else {
        await createCity.mutateAsync({ name: trimmed, color });
      }
      if (!personalLabels.includes(resolvedName)) {
        await persist([...personalLabels, resolvedName], defaultLabel);
      }
      setEditing(null);
      toast("Метка добавлена");
    } catch (e) {
      alertError(e); // шит остаётся открытым — ввод не теряется
    }
  };

  const editLabel = async (oldName: string, newName: string, color: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      const current = cities.find((c) => c.name === oldName);
      const collision =
        trimmed.toLowerCase() !== oldName.toLowerCase()
          ? cities.find((c) => c.name.toLowerCase() === trimmed.toLowerCase())
          : undefined;
      if (collision) {
        // Переименование в уже существующую метку — сливаем: цвет уходит в
        // целевую запись, старая скрывается (web parity).
        await updateCity.mutateAsync({ id: collision.id, patch: { color } });
        if (current) await deleteCity.mutateAsync(current.id);
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
        const nextLabels = Array.from(
          new Set(personalLabels.map((n) => (n === oldName ? trimmed : n))),
        );
        await save.mutateAsync({
          personalLabels: nextLabels,
          personalDefaultLabel:
            defaultLabel === oldName ? trimmed : defaultLabel,
        });
      }
      setEditing(null);
      toast("Метка обновлена");
    } catch (e) {
      alertError(e);
    }
  };

  const removeLabel = (name: string) => {
    Alert.alert("Убрать метку?", `«${name}» останется в библиотеке городов.`, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Убрать",
        style: "destructive",
        onPress: async () => {
          try {
            await persist(
              personalLabels.filter((n) => n !== name),
              defaultLabel === name ? "" : defaultLabel,
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
    save.mutate(
      { personalDefaultLabel: next },
      { onError: alertError },
    );
  };

  const isLoading = settingsLoading || citiesLoading;

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Метки" subtitle="Личный календарь" />

      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : rows.length === 0 ? (
        <EmptyState
          fill
          icon={<MapPin color={t.accent} size={28} />}
          title="В личном календаре пока нет меток"
          subtitle="Добавьте пару меток и пометьте одну звездой как основную — она автоматически появится под каждой датой своим цветом."
          action={{ label: "Добавить метку", onPress: () => setEditing({ mode: "create" }) }}
        />
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
          <SectionCard>
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
            <Pressable
              onPress={() => setEditing({ mode: "create" })}
              accessibilityRole="button"
              accessibilityLabel="Новая метка"
              className="flex-row items-center px-4 py-3.5 active:opacity-60"
            >
              <View
                style={{
                  height: 24,
                  width: 24,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  backgroundColor: t.dark
                    ? "rgba(90,134,255,0.16)"
                    : "rgba(44,91,224,0.10)",
                }}
              >
                <Plus color={t.accent} size={ICON.xs} />
              </View>
              <Text className="ml-3 text-base font-medium" style={{ color: t.accent }}>
                Новая метка
              </Text>
            </Pressable>
          </SectionCard>

          <Text className="mx-4 mt-3 text-xs leading-4" style={{ color: t.faint }}>
            Основная метка (★) автоматически красит новые даты своим цветом.
          </Text>
        </ScrollView>
      )}

      <LabelSheet
        editing={editing}
        suggestions={suggestions}
        busy={
          save.isPending ||
          createCity.isPending ||
          updateCity.isPending ||
          deleteCity.isPending
        }
        onClose={() => setEditing(null)}
        onCreate={addLabel}
        onUpdate={editLabel}
        onRemove={removeLabel}
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
  // key-remount через editing==null → null; локальный стейт инициализируем
  // от editing при каждом открытии.
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(FALLBACK_COLOR);
  const [seeded, setSeeded] = useState<Editing | null>(null);

  if (editing !== seeded) {
    // Новый показ шита — засеять поля (паттерн «render-time reset»).
    setSeeded(editing);
    setName(isEdit ? editing.name : "");
    setColor(isEdit ? editing.color : PRESET_COLORS[0].value);
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
          accessibilityLabel="Закрыть"
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
              accessibilityLabel="Убрать метку из личного календаря"
              className="mt-1 items-center py-3 active:opacity-70"
            >
              <Text style={{ fontSize: 16, fontWeight: "500", color: t.danger }}>
                Убрать из календаря
              </Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
