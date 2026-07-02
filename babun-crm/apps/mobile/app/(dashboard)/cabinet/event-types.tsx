import { useState } from "react";
import { Alert, FlatList, Modal, Pressable, Text, View } from "react-native";
import { Plus, Trash2 } from "lucide-react-native";
import { generatePersonalEventTypeId } from "@babun/shared/local/personal-event-types";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  usePersonalEventTypes,
  useSavePersonalEventTypes,
} from "@/features/settings/local-settings";

const SWATCHES = [
  "#FF9500", "#007AFF", "#AF52DE", "#34C759",
  "#FF3B30", "#5856D6", "#8E8E93", "#FF2D55",
];

export default function EventTypesScreen() {
  const t = useThemeColors();
  const { data: types = [], isLoading } = usePersonalEventTypes();
  const save = useSavePersonalEventTypes();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(SWATCHES[1]);
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
            icon: "tag",
            color,
            defaultDuration: Number(duration) || 60,
            allDay: false,
            order: types.length,
          },
        ],
      },
      {
        // Sheet closes only on success — a failed save keeps the input.
        onSuccess: () => {
          setLabel("");
          setDuration("60");
          setOpen(false);
        },
        onError: (e) => Alert.alert("Ошибка", e.message),
      },
    );
  };
  const remove = (id: string) =>
    // removeIds carries the explicit deletion — the server must never
    // derive it from a (possibly stale) full snapshot.
    save.mutate(
      { types: types.filter((t) => t.id !== id), removeIds: [id] },
      { onError: (e) => Alert.alert("Ошибка", e.message) },
    );

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title="Типы событий"
        right={
          <Pressable
            onPress={() => setOpen(true)}
            hitSlop={8}
            className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
          >
            <Plus color={t.accent} size={ICON.md} />
          </Pressable>
        }
      />
      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={types}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ flexGrow: 1, paddingTop: 8 }}
          renderItem={({ item }) => (
            <View className="flex-row items-center px-4 py-3">
              <View
                className="mr-3 h-7 w-7 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <View className="flex-1">
                <Text className="text-base font-semibold" style={{ color: t.ink }}>
                  {item.label}
                </Text>
                <Text className="text-xs" style={{ color: t.faint }}>
                  {item.allDay ? "Весь день" : `${item.defaultDuration} мин`}
                </Text>
              </View>
              <Pressable onPress={() => remove(item.id)} hitSlop={8}>
                <Trash2 color={t.danger} size={ICON.sm} />
              </Pressable>
            </View>
          )}
          ItemSeparatorComponent={() => <Divider inset={56} />}
          ListEmptyComponent={
            <EmptyState fill title="Нет типов событий" />
          }
        />
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1" style={{ backgroundColor: t.scrim }} onPress={() => setOpen(false)} />
        <View className="absolute bottom-0 left-0 right-0 rounded-t-3xl p-5 pb-8" style={{ backgroundColor: t.surface }}>
          <Text className="mb-3 text-lg font-bold" style={{ color: t.ink }}>Новый тип события</Text>
          <Field label="Название" value={label} onChangeText={setLabel} placeholder="Обед" autoFocus />
          <Text className="mb-2 text-xs font-medium" style={{ color: t.sub }}>Цвет</Text>
          <View className="mb-4 flex-row flex-wrap gap-3">
            {SWATCHES.map((c) => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                className={`h-9 w-9 rounded-full ${color === c ? "border-2" : ""}`}
                style={{ backgroundColor: c, ...(color === c ? { borderColor: t.ink } : null) }}
              />
            ))}
          </View>
          <Field
            label="Длительность, мин"
            value={duration}
            onChangeText={setDuration}
            placeholder="60"
            keyboardType="number-pad"
          />
          <Button
            label="Добавить"
            onPress={add}
            disabled={!label.trim() || save.isPending}
            loading={save.isPending}
          />
        </View>
      </Modal>
    </Screen>
  );
}
