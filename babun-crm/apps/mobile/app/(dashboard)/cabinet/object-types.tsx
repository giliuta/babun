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

export default function ObjectTypesScreen() {
  const t = useThemeColors();
  const { data: labels = [], isLoading } = useLocationLabels();
  const save = useSaveLocationLabels();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const add = () => {
    if (!name.trim()) return;
    save.mutate([...labels, { id: `loclbl-${Date.now()}`, name: name.trim() }]);
    setName("");
    setOpen(false);
  };
  const remove = (id: string) => save.mutate(labels.filter((l) => l.id !== id));
  // Web parity: confirm before deleting a reference type (was an instant,
  // unrecoverable tap).
  const confirmRemove = (id: string, itemName: string) =>
    Alert.alert("Удалить тип объекта?", itemName, [
      { text: "Отмена", style: "cancel" },
      { text: "Удалить", style: "destructive", onPress: () => remove(id) },
    ]);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Типы объектов" />
      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={labels}
          keyExtractor={(l) => l.id}
          contentContainerStyle={{ flexGrow: 1, paddingTop: 8 }}
          renderItem={({ item }) => (
            <View className="flex-row items-center px-4 py-3">
              <Text className="flex-1 text-base" style={{ color: t.ink }}>{item.name}</Text>
              <Pressable
                onPress={() => confirmRemove(item.id, item.name)}
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
              subtitle="Дом, Офис, Вилла… — пресеты для объектов клиента"
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
        <Pressable className="flex-1" style={{ backgroundColor: t.scrim }} onPress={() => setOpen(false)} />
        <View className="rounded-t-3xl p-5 pb-8" style={{ backgroundColor: t.surface }}>
          <Text className="mb-3 text-lg font-bold" style={{ color: t.ink }}>Новый тип</Text>
          <Field label="Название" value={name} onChangeText={setName} placeholder="Вилла" autoFocus />
          <Button label="Добавить" onPress={add} disabled={!name.trim()} />
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
