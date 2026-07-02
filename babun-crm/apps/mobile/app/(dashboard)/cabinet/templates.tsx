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
import { formatEUR } from "@babun/shared/common/utils/money";
import { Screen } from "@/components/ui/Screen";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useFinanceCategories } from "@/features/finances/queries";
import {
  useDeleteTemplate,
  useFinanceTemplates,
  useInsertTemplate,
} from "@/features/finances/templates-queries";

export default function TemplatesScreen() {
  const { data: templates = [], isLoading } = useFinanceTemplates();
  const { data: categories = [] } = useFinanceCategories();
  const insert = useInsertTemplate();
  const del = useDeleteTemplate();
  const t = useThemeColors();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const cats = useMemo(
    () => categories.filter((c) => c.type === kind),
    [categories, kind],
  );
  // Comma decimals («12,50» from the ru decimal-pad) must pass the same
  // normalisation as add(), otherwise the button never enables.
  const canSave =
    !!name.trim() && Number(amount.replace(",", ".")) > 0 && !insert.isPending;

  const add = async () => {
    try {
      await insert.mutateAsync({
        name: name.trim(),
        kind,
        amount: Number(amount.replace(",", ".")) || 0,
        category_id: categoryId,
      });
      setName("");
      setAmount("");
      setCategoryId(null);
      setOpen(false);
    } catch (e) {
      // Sheet stays open — nothing entered is lost.
      Alert.alert("Ошибка", (e as Error).message);
    }
  };

  const confirmDelete = (id: string, label: string) =>
    Alert.alert("Удалить шаблон?", label, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: () =>
          del.mutate(id, { onError: (e) => Alert.alert("Ошибка", e.message) }),
      },
    ]);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title="Шаблоны операций"
        right={
          <Pressable
            onPress={() => setOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Добавить шаблон"
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
          data={templates}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ flexGrow: 1, paddingTop: 8 }}
          renderItem={({ item }) => (
            <View className="flex-row items-center px-4 py-3">
              <View className="flex-1 pr-2">
                <Text
                  className="text-base font-semibold"
                  style={{ color: t.ink }}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                <Text className="text-xs" style={{ color: t.faint }}>
                  {item.kind === "expense" ? "Расход" : "Доход"}
                </Text>
              </View>
              <Text
                className="mr-3 text-base font-bold tabular-nums"
                style={{ color: item.kind === "expense" ? t.danger : t.success }}
              >
                {formatEUR(Number(item.amount))}
              </Text>
              <Pressable
                onPress={() => confirmDelete(item.id, item.name)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Удалить шаблон ${item.name}`}
              >
                <Trash2 color={t.danger} size={ICON.sm} />
              </Pressable>
            </View>
          )}
          ItemSeparatorComponent={() => <Divider inset={16} />}
          ListEmptyComponent={
            <EmptyState
              fill
              title="Нет шаблонов"
              subtitle="Частые операции (Аренда, Бензин…) — добавьте через +"
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
        />
        <View
          className="rounded-t-3xl p-5 pb-8"
          style={{ backgroundColor: t.surface }}
        >
          <Text className="mb-3 text-lg font-bold" style={{ color: t.ink }}>
            Новый шаблон
          </Text>
          <SegmentedControl
            options={[
              { value: "expense", label: "Расход", color: t.danger },
              { value: "income", label: "Доход", color: t.success },
            ]}
            value={kind}
            onChange={(k) => {
              setKind(k);
              setCategoryId(null);
            }}
            style={{ marginBottom: 12 }}
          />
          <Field label="Название" value={name} onChangeText={setName} placeholder="Аренда" autoFocus />
          <Field
            label="Сумма €"
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
            keyboardType="decimal-pad"
          />
          {cats.length > 0 ? (
            <View className="mb-3 flex-row flex-wrap gap-2">
              {cats.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
                  className="rounded-full px-3 py-1.5"
                  style={{
                    backgroundColor:
                      categoryId === c.id
                        ? t.accent
                        : t.fill,
                  }}
                >
                  <Text
                    className="text-sm"
                    style={{ color: categoryId === c.id ? t.onAccent : t.sub }}
                  >
                    {c.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Button label="Создать" onPress={add} disabled={!canSave} loading={insert.isPending} />
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
