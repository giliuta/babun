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
import { Package, Plus, Trash2 } from "lucide-react-native";
import {
  createBlankEquipment,
  type Equipment,
} from "@babun/shared/local/equipment";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useToast } from "@/components/ui/Toast";
import { useTeams } from "@/features/reference/queries";
import { useEquipment, useSaveEquipment } from "@/features/inventory/queries";

export default function InventoryScreen() {
  const th = useThemeColors();
  const { data: items = [], isLoading } = useEquipment();
  const { data: teams = [] } = useTeams();
  const save = useSaveEquipment();
  const toast = useToast();

  const teamName = useMemo(
    () => new Map(teams.map((t) => [t.id, t.name])),
    [teams],
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Equipment | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [serial, setSerial] = useState("");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const openNew = () => {
    setEditing(null);
    setName("");
    setCategory("");
    setSerial("");
    setTeamId(null);
    setNotes("");
    setOpen(true);
  };
  const openEdit = (e: Equipment) => {
    setEditing(e);
    setName(e.name);
    setCategory(e.category ?? "");
    setSerial(e.serial ?? "");
    setTeamId(e.assigned_team_id);
    setNotes(e.notes ?? "");
    setOpen(true);
  };

  const submit = () => {
    if (!name.trim()) return;
    const base = editing ?? createBlankEquipment();
    const next: Equipment = {
      ...base,
      name: name.trim(),
      category: category.trim() || undefined,
      serial: serial.trim() || undefined,
      assigned_team_id: teamId,
      notes: notes.trim() || undefined,
    };
    const list = editing
      ? items.map((i) => (i.id === editing.id ? next : i))
      : [...items, next];
    save.mutate(
      { list },
      {
        // Sheet closes only on success — a failed save keeps the input.
        onSuccess: () => {
          setOpen(false);
          toast(editing ? "Сохранено" : "Добавлено");
        },
        onError: (e) => Alert.alert("Ошибка", e.message),
      },
    );
  };

  const remove = (id: string) =>
    Alert.alert("Удалить позицию?", "", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: () =>
          // removeIds carries the explicit deletion — the server must never
          // derive it from a (possibly stale) full snapshot.
          save.mutate(
            { list: items.filter((i) => i.id !== id), removeIds: [id] },
            { onError: (e) => Alert.alert("Ошибка", e.message) },
          ),
      },
    ]);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title="Склад"
        right={
          <Pressable
            onPress={openNew}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Добавить позицию"
            className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
          >
            <Plus color={th.accent} size={ICON.md} />
          </Pressable>
        }
      />
      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ flexGrow: 1, paddingTop: 8 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openEdit(item)}
              className="flex-row items-center px-4 py-3 active:opacity-60"
            >
              <View
                className="mr-3 h-9 w-9 items-center justify-center rounded-xl"
                style={{ backgroundColor: (item.color ?? th.accent) + "1f" }}
              >
                <Package color={item.color ?? th.accent} size={ICON.sm} />
              </View>
              <View className="flex-1 pr-2">
                <Text className="text-base font-semibold" style={{ color: th.ink }} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text className="text-sm" style={{ color: th.sub }} numberOfLines={1}>
                  {[
                    item.category,
                    item.serial && `№ ${item.serial}`,
                    item.assigned_team_id
                      ? teamName.get(item.assigned_team_id)
                      : "на полке",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              <Pressable
                onPress={() => remove(item.id)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Удалить ${item.name}`}
              >
                <Trash2 color={th.danger} size={ICON.sm} />
              </Pressable>
            </Pressable>
          )}
          ItemSeparatorComponent={() => <Divider inset={64} />}
          ListEmptyComponent={
            <EmptyState
              fill
              title="Склад пуст"
              subtitle="Инструменты, расходники, приборы — добавьте через +"
            />
          }
        />
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        <Pressable className="flex-1" style={{ backgroundColor: th.scrim }} onPress={() => setOpen(false)} />
        <View
          className="rounded-t-3xl p-5 pb-8"
          style={{ backgroundColor: th.surface }}
        >
          <Text className="mb-3 text-lg font-bold" style={{ color: th.ink }}>
            {editing ? "Позиция" : "Новая позиция"}
          </Text>
          <Field label="Название" value={name} onChangeText={setName} placeholder="Манометр" autoFocus />
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Field label="Категория" value={category} onChangeText={setCategory} placeholder="Прибор" />
            </View>
            <View className="flex-1">
              <Field label="Серийный №" value={serial} onChangeText={setSerial} placeholder="—" />
            </View>
          </View>
          {teams.length > 0 ? (
            <>
              <Text className="mb-2 text-xs font-medium" style={{ color: th.sub }}>Бригада</Text>
              <View className="mb-3 flex-row flex-wrap gap-2">
                {[{ id: null as string | null, name: "На полке" }, ...teams].map((t) => (
                  <Chip
                    key={t.id ?? "shelf"}
                    label={t.name}
                    radio
                    selected={teamId === t.id}
                    onPress={() => setTeamId(t.id)}
                  />
                ))}
              </View>
            </>
          ) : null}
          <Field label="Заметки" value={notes} onChangeText={setNotes} placeholder="—" />
          <Button
            label={editing ? "Сохранить" : "Добавить"}
            onPress={submit}
            disabled={!name.trim() || save.isPending}
            loading={save.isPending}
          />
          {editing ? (
            <Pressable
              onPress={() => {
                remove(editing.id);
                setOpen(false);
              }}
              className="mt-1 items-center py-3 active:opacity-70"
            >
              <Text className="text-base font-medium" style={{ color: th.danger }}>Удалить</Text>
            </Pressable>
          ) : null}
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
