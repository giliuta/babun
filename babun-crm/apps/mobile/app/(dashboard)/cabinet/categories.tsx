import { useMemo, useState } from "react";
import { Alert, FlatList, Modal, Pressable, Text, View } from "react-native";
import { Plus, Trash2 } from "lucide-react-native";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import { Screen } from "@/components/ui/Screen";
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

const SWATCHES = [
  "#ef4444", "#f97316", "#eab308", "#10b981", "#06b6d4",
  "#4338ca", "#a855f7", "#ec4899", "#737373",
];

export default function CategoriesScreen() {
  const th = useThemeColors();
  const { data: cats = [], isLoading } = useFinanceCategories();
  const insert = useInsertCategory();
  const del = useDeleteCategory();

  const [type, setType] = useState<"expense" | "income">("expense");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[5]);

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
            className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
          >
            <Plus color={th.accent} size={ICON.md} />
          </Pressable>
        }
      />

      <View
        className="mx-4 mt-3 flex-row rounded-xl p-1"
        style={{ backgroundColor: th.dark ? "rgba(255,255,255,0.07)" : "#eef1f5" }}
      >
        {(["expense", "income"] as const).map((seg) => {
          const active = type === seg;
          return (
            <Pressable
              key={seg}
              onPress={() => setType(seg)}
              className="flex-1 items-center rounded-lg py-2"
              style={active ? { backgroundColor: th.surface } : undefined}
            >
              <Text
                className="text-sm font-semibold"
                style={{
                  color: active
                    ? seg === "expense"
                      ? th.danger
                      : th.success
                    : th.sub,
                }}
              >
                {seg === "expense" ? "Расходы" : "Доходы"}
              </Text>
            </Pressable>
          );
        })}
      </View>

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
                <Pressable onPress={() => confirmDelete(item)} hitSlop={8}>
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
        <Pressable className="flex-1" style={{ backgroundColor: th.scrim }} onPress={() => setOpen(false)} />
        <View className="absolute bottom-0 left-0 right-0 rounded-t-3xl p-5 pb-8" style={{ backgroundColor: th.surface }}>
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
          <Text className="mb-2 text-xs font-medium" style={{ color: th.sub }}>Цвет</Text>
          <View className="mb-4 flex-row flex-wrap gap-3">
            {SWATCHES.map((c) => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                className="h-9 w-9 rounded-full"
                style={{ backgroundColor: c, borderWidth: color === c ? 2 : 0, borderColor: th.ink }}
              />
            ))}
          </View>
          <Button
            label="Создать"
            onPress={add}
            disabled={!name.trim() || insert.isPending}
            loading={insert.isPending}
          />
        </View>
      </Modal>
    </Screen>
  );
}
