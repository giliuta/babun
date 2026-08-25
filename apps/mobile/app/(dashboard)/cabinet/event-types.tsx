import { useState, type ComponentType } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Switch,
  Text,
  View,
} from "react-native";
import {
  Bell,
  Book,
  Briefcase,
  Calendar,
  Car,
  Coffee,
  Dumbbell,
  Gift,
  GraduationCap,
  Heart,
  Home,
  Moon,
  Music,
  Navigation,
  Phone,
  Plane,
  ShoppingBag,
  Star,
  Stethoscope,
  Tag,
  Trash2,
  Users,
} from "lucide-react-native";
import {
  generatePersonalEventTypeId,
  type PersonalEventTypeIcon,
} from "@babun/shared/local/personal-event-types";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import { Screen } from "@/components/ui/Screen";
import { ColorField } from "@/components/ui/picker-fields";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AddRow } from "@/components/ui/AddRow";
import { Divider } from "@/components/ui/Divider";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  usePersonalEventTypes,
  useSavePersonalEventTypes,
} from "@/features/settings/local-settings";

// Palette unified on the shared PRESET_COLORS (see ColorPicker); the old
// local SWATCHES list is gone — default stays синий.
const DEFAULT_COLOR = PRESET_COLOR_CYCLE[1].value;

type IconCmp = ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

// Полный набор иконок модели PersonalEventTypeIcon (веб-паритет пикера).
const EVENT_ICONS: Record<PersonalEventTypeIcon, IconCmp> = {
  coffee: Coffee,
  briefcase: Briefcase,
  navigation: Navigation,
  moon: Moon,
  plane: Plane,
  bell: Bell,
  heart: Heart,
  star: Star,
  dumbbell: Dumbbell,
  book: Book,
  music: Music,
  "graduation-cap": GraduationCap,
  stethoscope: Stethoscope,
  car: Car,
  home: Home,
  users: Users,
  phone: Phone,
  "shopping-bag": ShoppingBag,
  gift: Gift,
  calendar: Calendar,
  tag: Tag,
};
const ICON_KEYS = Object.keys(EVENT_ICONS) as PersonalEventTypeIcon[];

export default function EventTypesScreen() {
  const t = useThemeColors();
  const typesQuery = usePersonalEventTypes();
  const types = typesQuery.data ?? [];
  const save = useSavePersonalEventTypes();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [icon, setIcon] = useState<PersonalEventTypeIcon>("tag");
  const [allDay, setAllDay] = useState(false);
  const [duration, setDuration] = useState("60");

  const add = () => {
    if (!label.trim()) return;
    save.mutate(
      {
        types: [
          ...types,
          {
            id: generatePersonalEventTypeId(),
            label: label.trim(),
            icon,
            color,
            defaultDuration: allDay ? 720 : Number(duration) || 60,
            allDay,
            order: types.length,
          },
        ],
      },
      {
        // Sheet closes only on success — a failed save keeps the input.
        onSuccess: () => {
          setLabel("");
          setDuration("60");
          setIcon("tag");
          setAllDay(false);
          setOpen(false);
        },
        onError: (e) => Alert.alert("Ошибка", e.message),
      },
    );
  };
  const remove = (id: string) => {
    if (save.isPending) return;
    // removeIds carries the explicit deletion — the server must never
    // derive it from a (possibly stale) full snapshot.
    save.mutate(
      { types: types.filter((t) => t.id !== id), removeIds: [id] },
      { onError: (e) => Alert.alert("Ошибка", e.message) },
    );
  };
  // Web parity: confirm before deleting an event type (was an instant tap).
  const confirmRemove = (id: string, itemLabel: string) =>
    Alert.alert("Удалить тип события?", itemLabel, [
      { text: "Отмена", style: "cancel" },
      { text: "Удалить", style: "destructive", onPress: () => remove(id) },
    ]);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Типы событий" />
      {typesQuery.isLoading ? (
        <EmptyState state="loading" fill />
      ) : typesQuery.isError ? (
        <EmptyState
          state="error"
          fill
          subtitle={
            typesQuery.error instanceof Error
              ? typesQuery.error.message
              : undefined
          }
          action={{
            label: "Повторить",
            onPress: () => void typesQuery.refetch(),
          }}
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={types}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ flexGrow: 1, paddingTop: 8 }}
          renderItem={({ item }) => {
            const Icon = EVENT_ICONS[item.icon] ?? Tag;
            return (
            <View className="flex-row items-center px-4 py-3">
              <View
                className="mr-3 h-7 w-7 items-center justify-center rounded-full"
                style={{ backgroundColor: item.color }}
              >
                <Icon color="#fff" size={15} strokeWidth={2.2} />
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold" style={{ color: t.ink }}>
                  {item.label}
                </Text>
                <Text className="text-xs" style={{ color: t.faint }}>
                  {item.allDay ? "Весь день" : `${item.defaultDuration} мин`}
                </Text>
              </View>
              <Pressable
                onPress={() => confirmRemove(item.id, item.label)}
                disabled={save.isPending}
                accessibilityRole="button"
                accessibilityLabel={`Удалить ${item.label}`}
                accessibilityState={{ disabled: save.isPending }}
                className="h-11 w-11 items-center justify-center"
                style={{ opacity: save.isPending ? 0.4 : 1 }}
              >
                <Trash2 color={t.danger} size={ICON.sm} />
              </Pressable>
            </View>
            );
          }}
          ItemSeparatorComponent={() => <Divider inset={56} />}
          ListFooterComponent={
            types.length > 0 ? (
              <>
                <Divider inset={56} />
                <AddRow label="Добавить тип" onPress={() => setOpen(true)} />
              </>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              fill
              title="Нет типов событий"
              action={{ label: "Добавить тип", onPress: () => setOpen(true) }}
            />
          }
        />
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        <Pressable
          className="flex-1"
          style={{ backgroundColor: t.scrim }}
          onPress={() => setOpen(false)}
          accessible={false}
        />
        <View className="rounded-t-[10px] p-5 pb-8" style={{ backgroundColor: t.surface }}>
          <Text className="mb-3 text-lg font-bold" style={{ color: t.ink }}>Новый тип события</Text>
          <Field label="Название" value={label} onChangeText={setLabel} placeholder="Обед" autoFocus />
          <ColorField value={color} onChange={setColor} />
          <Text className="mb-1.5 mt-3 text-[13px] font-medium" style={{ color: t.sub }}>
            Иконка
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {ICON_KEYS.map((key) => {
              const Icon = EVENT_ICONS[key];
              const selected = icon === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setIcon(key)}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel={`Иконка ${key}`}
                  accessibilityState={{ selected }}
                  className="h-9 w-9 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: selected ? color : t.fill,
                  }}
                >
                  <Icon color={selected ? "#fff" : t.sub} size={16} strokeWidth={2.2} />
                </Pressable>
              );
            })}
          </View>
          <View className="mt-4 flex-row items-center justify-between">
            <Text className="text-base" style={{ color: t.ink }}>Весь день</Text>
            <Switch
              value={allDay}
              onValueChange={setAllDay}
              trackColor={{ true: t.accent }}
            />
          </View>
          {!allDay ? (
            <Field
              label="Длительность, мин"
              value={duration}
              onChangeText={setDuration}
              placeholder="60"
              keyboardType="number-pad"
            />
          ) : null}
          <Button
            label="Добавить"
            onPress={add}
            disabled={!label.trim() || save.isPending}
            loading={save.isPending}
          />
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
