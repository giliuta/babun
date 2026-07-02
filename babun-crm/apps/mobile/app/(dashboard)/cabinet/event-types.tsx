import { useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { Plus, Trash2 } from "lucide-react-native";
import { generatePersonalEventTypeId } from "@babun/shared/local/personal-event-types";
import { PRESET_COLORS } from "@babun/shared/common/utils/colors";
import { Screen } from "@/components/ui/Screen";
import { ColorPicker } from "@/components/ui/ColorPicker";
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

// Palette unified on the shared PRESET_COLORS (see ColorPicker); the old
// local SWATCHES list is gone — default stays синий.
const DEFAULT_COLOR = PRESET_COLORS[1].value;

export default function EventTypesScreen() {
  const t = useThemeColors();
  const { data: types = [], isLoading } = usePersonalEventTypes();
  const save = useSavePersonalEventTypes();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
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
            accessibilityRole="button"
            accessibilityLabel="Добавить тип события"
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
              <Pressable
                onPress={() => remove(item.id)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Удалить ${item.label}`}
              >
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
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        <Pressable className="flex-1" style={{ backgroundColor: t.scrim }} onPress={() => setOpen(false)} />
        <View className="rounded-t-3xl p-5 pb-8" style={{ backgroundColor: t.surface }}>
          <Text className="mb-3 text-lg font-bold" style={{ color: t.ink }}>Новый тип события</Text>
          <Field label="Название" value={label} onChangeText={setLabel} placeholder="Обед" autoFocus />
          <ColorPicker value={color} onChange={setColor} />
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
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
