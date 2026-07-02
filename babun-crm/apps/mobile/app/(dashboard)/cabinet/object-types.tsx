import { useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { Plus, Trash2 } from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
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

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title="Типы объектов"
        right={
          <Pressable
            onPress={() => setOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Добавить тип объекта"
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
          data={labels}
          keyExtractor={(l) => l.id}
          contentContainerStyle={{ flexGrow: 1, paddingTop: 8 }}
          renderItem={({ item }) => (
            <View className="flex-row items-center px-4 py-3">
              <Text className="flex-1 text-base" style={{ color: t.ink }}>{item.name}</Text>
              <Pressable
                onPress={() => remove(item.id)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Удалить ${item.name}`}
              >
                <Trash2 color={t.danger} size={ICON.sm} />
              </Pressable>
            </View>
          )}
          ItemSeparatorComponent={() => <Divider inset={16} />}
          ListEmptyComponent={
            <EmptyState
              fill
              title="Нет типов"
              subtitle="Дом, Офис, Вилла… — пресеты для объектов клиента"
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
