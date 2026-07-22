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
import { Trash2 } from "lucide-react-native";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import { PRESET_COLORS } from "@babun/shared/common/utils/colors";
import { Screen } from "@/components/ui/Screen";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { AddRow } from "@/components/ui/AddRow";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  useDeleteCategory,
  useFinanceCategories,
  useInsertCategory,
  useUpdateCategory,
} from "@/features/finances/queries";

// Palette unified on the shared PRESET_COLORS (see ColorPicker); the old
// tailwind-hued SWATCHES are gone — default stays индиго.
const DEFAULT_COLOR = PRESET_COLORS[2].value;

export default function CategoriesScreen() {
  const th = useThemeColors();
  const { data: cats = [], isLoading, isError, error, refetch } =
    useFinanceCategories();
  const insert = useInsertCategory();
  const update = useUpdateCategory();
  const del = useDeleteCategory();

  const [type, setType] = useState<"expense" | "income">("expense");
  const [open, setOpen] = useState(false);
  // Правка своей категории (rename/цвет) — раньше единственным «редактором»
  // был деструктивный обход «удалить+создать», обнулявший category_id у
  // всей истории транзакций (аудит P1-8). Системные (tenant_id=null)
  // защищены RLS — их не открываем.
  const [editing, setEditing] = useState<FinanceCategory | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);

  const filtered = useMemo(
    () => cats.filter((c) => c.type === type),
    [cats, type],
  );

  const openCreate = () => {
    setEditing(null);
    setName("");
    setColor(DEFAULT_COLOR);
    setOpen(true);
  };
  const openEdit = (c: FinanceCategory) => {
    setEditing(c);
    setName(c.name);
    setColor(c.color ?? DEFAULT_COLOR);
    setOpen(true);
  };

  const submit = async () => {
    if (!name.trim()) return;
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          patch: { name: name.trim(), color },
        });
      } else {
        await insert.mutateAsync({ name: name.trim(), type, color });
      }
      setName("");
      setOpen(false);
      setEditing(null);
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
    Alert.alert(
      "Удалить категорию?",
      `«${c.name}» — прошлые операции останутся, но потеряют категорию в аналитике. Переименование безопаснее удаления.`,
      [
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
      <ScreenHeader title="Категории" />

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
      ) : isError ? (
        <EmptyState
          fill
          state="error"
          subtitle={error instanceof Error ? error.message : undefined}
          action={{ label: "Повторить", onPress: () => void refetch() }}
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={filtered}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ flexGrow: 1, paddingTop: 8 }}
          renderItem={({ item }) => (
            <View className="flex-row items-stretch">
              <Pressable
                onPress={item.tenant_id ? () => openEdit(item) : undefined}
                disabled={!item.tenant_id}
                accessible={!!item.tenant_id}
                accessibilityRole={item.tenant_id ? "button" : undefined}
                accessibilityLabel={
                  item.tenant_id ? `Категория ${item.name}, редактировать` : undefined
                }
                className={`min-h-[52px] flex-1 flex-row items-center py-3 pl-4 ${item.tenant_id ? "active:opacity-60" : ""}`}
              >
                <View
                  className="mr-3 h-7 w-7 rounded-full"
                  style={{ backgroundColor: item.color ?? th.faint }}
                />
                <Text className="flex-1 text-base" style={{ color: th.ink }}>{item.name}</Text>
              </Pressable>
              {item.tenant_id ? (
                <Pressable
                  onPress={() => confirmDelete(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Удалить ${item.name}`}
                  className="min-h-[52px] min-w-11 items-center justify-center pr-2 active:opacity-60"
                >
                  <Trash2 color={th.danger} size={ICON.sm} />
                </Pressable>
              ) : (
                <View className="min-h-[52px] justify-center pr-4">
                  <Text className="text-xs" style={{ color: th.faint }}>станд.</Text>
                </View>
              )}
            </View>
          )}
          ItemSeparatorComponent={() => <Divider inset={56} />}
          ListFooterComponent={
            filtered.length > 0 ? (
              <>
                <Divider inset={56} />
                <AddRow label="Добавить категорию" onPress={openCreate} />
              </>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              fill
              title={type === "expense" ? "Нет категорий расходов" : "Нет категорий доходов"}
              subtitle="Категории группируют операции — «Бензин», «Аренда», «Выручка»"
              action={{ label: "Добавить категорию", onPress: openCreate }}
            />
          }
        />
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        <Pressable className="flex-1" style={{ backgroundColor: th.scrim }} onPress={() => setOpen(false)} accessible={false} />
        <View className="rounded-t-3xl p-5 pb-8" style={{ backgroundColor: th.surface }}>
          <Text className="mb-3 text-lg font-bold" style={{ color: th.ink }}>
            {editing
              ? "Категория"
              : `Новая категория · ${type === "expense" ? "расход" : "доход"}`}
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
            label={editing ? "Сохранить" : "Создать"}
            onPress={submit}
            disabled={!name.trim() || insert.isPending || update.isPending}
            loading={insert.isPending || update.isPending}
          />
          {editing ? (
            <Pressable
              onPress={() => {
                setOpen(false);
                confirmDelete(editing);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Удалить категорию ${editing.name}`}
              className="mt-1 items-center py-3 active:opacity-70"
            >
              <Text style={{ fontSize: 16, fontWeight: "500", color: th.danger }}>
                Удалить категорию
              </Text>
            </Pressable>
          ) : null}
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
