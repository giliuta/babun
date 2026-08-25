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
import { Trash2 } from "lucide-react-native";
import {
  generateLocationLabelId,
  HOME_SERVICE_LABELS_PRESET,
} from "@babun/shared/local/location-labels";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AddRow } from "@/components/ui/AddRow";
import { Divider } from "@/components/ui/Divider";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  useLocationLabels,
  useSaveLocationLabels,
} from "@/features/settings/local-settings";

export function ObjectTypesScreen() {
  const t = useThemeColors();
  const {
    data: labels = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useLocationLabels();
  const save = useSaveLocationLabels();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [seeding, setSeeding] = useState(false);

  // СТАНДАРТНЫЙ НАБОР ЗАВОДИТСЯ САМ (владелец 2026-08-02: «типы объектов
  // должны быть уже добавлены — дом, квартира, офис, как теги»). Пресет
  // пишется ОДИН РАЗ и только в пустой справочник: дальше это обычные записи,
  // которые владелец переименует или удалит. Раньше пустой справочник просто
  // объяснял, что «стандартные предлагаются при создании объекта» — то есть
  // настроить их было негде, пока не заведёшь первый вручную.
  const seedPreset = async () => {
    if (seeding || labels.length > 0) return;
    setSeeding(true);
    try {
      await save.mutateAsync(HOME_SERVICE_LABELS_PRESET);
    } catch (error) {
      Alert.alert(
        "Не удалось добавить стандартные типы",
        error instanceof Error ? error.message : "Повторите попытку.",
      );
    } finally {
      setSeeding(false);
    }
  };

  const add = async () => {
    const normalizedName = name.trim();
    if (!normalizedName) return;
    if (
      labels.some(
        (label) => label.name.toLowerCase() === normalizedName.toLowerCase(),
      )
    ) {
      Alert.alert("Такой тип уже есть", "Введите другое название.");
      return;
    }
    try {
      await save.mutateAsync([
        ...labels,
        { id: generateLocationLabelId(), name: normalizedName },
      ]);
      setName("");
      setOpen(false);
    } catch (error) {
      Alert.alert(
        "Не удалось сохранить тип",
        error instanceof Error ? error.message : "Повторите попытку.",
      );
    }
  };
  const remove = async (id: string) => {
    try {
      await save.mutateAsync(labels.filter((label) => label.id !== id));
    } catch (error) {
      Alert.alert(
        "Не удалось удалить тип",
        error instanceof Error ? error.message : "Повторите попытку.",
      );
    }
  };
  // Web parity: confirm before deleting a reference type (was an instant,
  // unrecoverable tap).
  const confirmRemove = (id: string, itemName: string) =>
    Alert.alert("Удалить тип объекта?", itemName, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: () => void remove(id),
      },
    ]);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Типы объектов" />
      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : isError ? (
        <EmptyState
          state="error"
          fill
          subtitle={error instanceof Error ? error.message : undefined}
          action={{ label: "Повторить", onPress: () => void refetch() }}
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={labels}
          keyExtractor={(l) => l.id}
          contentContainerStyle={{ flexGrow: 1, paddingTop: 8 }}
          renderItem={({ item }) => (
            <View className="flex-row items-center px-4 py-3">
              <Text className="flex-1 text-base" style={{ color: t.ink }}>
                {item.name}
              </Text>
              <Pressable
                onPress={() => confirmRemove(item.id, item.name)}
                disabled={save.isPending}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Удалить ${item.name}`}
              >
                <Trash2 color={t.danger} size={ICON.sm} />
              </Pressable>
            </View>
          )}
          ItemSeparatorComponent={() => <Divider inset={16} />}
          ListFooterComponent={
            labels.length > 0 ? (
              <>
                <Divider inset={16} />
                <AddRow label="Добавить тип" onPress={() => setOpen(true)} />
              </>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              fill
              title="Нет типов"
              subtitle="Стандартный набор — Дом, Квартира, Офис, Вилла. Заведите его одной кнопкой и правьте как свои: переименовать, удалить, добавить."
              action={{
                label: seeding ? "Добавляем…" : "Добавить стандартные",
                onPress: () => void seedPreset(),
              }}
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
          <Text className="mb-3 text-lg font-bold" style={{ color: t.ink }}>Новый тип</Text>
          <Field label="Название" value={name} onChangeText={setName} placeholder="Вилла" autoFocus />
          <Button
            label={save.isPending ? "Сохраняем…" : "Добавить"}
            onPress={() => void add()}
            disabled={!name.trim() || save.isPending}
          />
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
