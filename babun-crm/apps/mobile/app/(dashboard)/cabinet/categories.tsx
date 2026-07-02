import { useMemo, useState } from "react";
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
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import { PRESET_COLORS } from "@babun/shared/common/utils/colors";
import { Screen } from "@/components/ui/Screen";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  useDeleteCategory,
  useFinanceCategories,
  useInsertCategory,
} from "@/features/finances/queries";

// Palette unified on the shared PRESET_COLORS (see ColorPicker); the old
// tailwind-hued SWATCHES are gone — default stays индиго.
const DEFAULT_COLOR = PRESET_COLORS[2].value;

export default function CategoriesScreen() {
  const th = useThemeColors();
  const { data: cats = [], isLoading } = useFinanceCategories();
  const insert = useInsertCategory();
  const del = useDeleteCategory();

  const [type, setType] = useState<"expense" | "income">("expense");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);

  const filtered = useMemo(
    () => cats.filter((c) => c.type === type),
    [cats, type],
  );

  const add = async () => {
    if (!name.trim()) return;
    try {
      await insert.mutateAsync({ name: name.trim(), type, color });
      setName("");
      setOpen(false);
    } catch (e) {
      // Sheet stays open — nothing entered is lost.
      Alert.alert("Ошибка", (e as Error).message);
    }
  };

  const confirmDelete = (c: FinanceCategory) => {
    if (!c.tenant_id) {
      Alert.alert("Системная категория", "Стандартную категорию нельзя удалить.");
      return;
    }
    Alert.alert("Удалить категорию?", c.name, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: () =>
          del.mutate(c.id, { onError: (e) => Alert.alert("Ошибка", e.message) }),
      },
    ]);
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title="Категории"
        right={
          <Pressable
            onPress={() => setOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Добавить категорию"
            className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
          >
            <Plus color={th.accent} size={ICON.md} />
          </Pressable>
        }
      />

      <SegmentedControl
        options={[
          { value: "expense", label: "Расходы", color: th.danger },
          { value: "income", label: "Доходы", color: th.success },
        ]}
        value={type}
        onChange={setType}
        style={{ marginHorizontal: 16, marginTop: 12 }}
      />

      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={filtered}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ flexGrow: 1, paddingTop: 8 }}
          renderItem={({ item }) => (
            <View className="flex-row items-center px-4 py-3">
              <View
                className="mr-3 h-7 w-7 rounded-full"
                style={{ backgroundColor: item.color ?? th.faint }}
              />
              <Text className="flex-1 text-base" style={{ color: th.ink }}>{item.name}</Text>
              {item.tenant_id ? (
                <Pressable
                  onPress={() => confirmDelete(item)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Удалить ${item.name}`}
                >
                  <Trash2 color={th.danger} size={ICON.sm} />
                </Pressable>
              ) : (
                <Text className="text-xs" style={{ color: th.faint }}>станд.</Text>
              )}
            </View>
          )}
          ItemSeparatorComponent={() => <Divider inset={56} />}
          ListEmptyComponent={
            <EmptyState fill title="Нет категорий — добавьте через +" />
          }
        />
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        <Pressable className="flex-1" style={{ backgroundColor: th.scrim }} onPress={() => setOpen(false)} />
        <View className="rounded-t-3xl p-5 pb-8" style={{ backgroundColor: th.surface }}>
          <Text className="mb-3 text-lg font-bold" style={{ color: th.ink }}>
            Новая категория · {type === "expense" ? "расход" : "доход"}
          </Text>
          <Field
            label="Название"
            value={name}
            onChangeText={setName}
            placeholder="Напр. Бензин"
            autoFocus
          />
          <ColorPicker value={color} onChange={setColor} />
          <Button
            label="Создать"
            onPress={add}
            disabled={!name.trim() || insert.isPending}
            loading={insert.isPending}
          />
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
