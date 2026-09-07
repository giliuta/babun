import { useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { Package, Trash2 } from "lucide-react-native";
import {
  createBlankEquipment,
  type Equipment,
} from "@babun/shared/local/equipment";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AddRow } from "@/components/ui/AddRow";
import { Divider } from "@/components/ui/Divider";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ColorField } from "@/components/ui/picker-fields";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useToast } from "@/components/ui/Toast";
import { useTeams } from "@/features/reference/queries";
import { useEquipment, useSaveEquipment } from "@/features/inventory/queries";
import { useCurrentRole } from "@/features/settings/tenant";
import { notify } from "@/lib/notify";
import { confirmThen } from "@/lib/confirm";

// Экран склада переиспользуется в двух местах (не дублируем CRUD):
//  · глобальный /cabinet/inventory (весь склад, InventoryScreen ниже),
//  · обёртка «оборудование одной команды» снесена 2026-08-30 вместе с
//    разделом «Команды» в Кабинете; склад остался общим.
// С lockedTeamId список сужается до позиций ЭТОЙ команды
// (assigned_team_id === id), а новая позиция создаётся уже привязанной.
export default function InventoryScreen() {
  return <InventoryList />;
}

export function InventoryList({
  lockedTeamId,
}: { lockedTeamId?: string } = {}) {
  const th = useThemeColors();
  const { data: role } = useCurrentRole();
  const owner = role === "owner";
  const {
    data: allItems = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useEquipment();
  const teamsQuery = useTeams();
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const save = useSaveEquipment();
  const toast = useToast();

  const teamName = useMemo(
    () => new Map(teams.map((t) => [t.id, t.name])),
    [teams],
  );
  const team = lockedTeamId
    ? teams.find((t) => t.id === lockedTeamId)
    : undefined;

  // Per-team контекст: только позиции этой команды (web parity —
  // assigned_team_id === id). Глобальный экран показывает всё.
  const items = useMemo(
    () =>
      lockedTeamId
        ? allItems.filter((i) => i.assigned_team_id === lockedTeamId)
        : allItems,
    [allItems, lockedTeamId],
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Equipment | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [serial, setSerial] = useState("");
  const [teamId, setTeamId] = useState<string | null>(null);
  // Цвет позиции (web parity: инвентарь на вебе красит плитку флота).
  // "" = без цвета — плитка падает на акцент темы.
  const [color, setColor] = useState("");
  const [notes, setNotes] = useState("");

  const openNew = () => {
    if (!owner) return;
    setEditing(null);
    setName("");
    setCategory("");
    setSerial("");
    // На создании из хаба команды — заранее привязываем команду.
    setTeamId(lockedTeamId ?? null);
    setColor("");
    setNotes("");
    setOpen(true);
  };
  const openEdit = (e: Equipment) => {
    if (!owner) return;
    setEditing(e);
    setName(e.name);
    setCategory(e.category ?? "");
    setSerial(e.serial ?? "");
    setTeamId(e.assigned_team_id);
    setColor(e.color ?? "");
    setNotes(e.notes ?? "");
    setOpen(true);
  };

  const submit = () => {
    if (!owner || !name.trim()) return;
    const base = editing ?? createBlankEquipment();
    const next: Equipment = {
      ...base,
      name: name.trim(),
      category: category.trim() || undefined,
      serial: serial.trim() || undefined,
      assigned_team_id: teamId,
      color: color || undefined,
      notes: notes.trim() || undefined,
    };
    // Пишем поверх ПОЛНОГО списка (allItems), а не отфильтрованного по
    // команде: save перезаписывает весь MMKV-кэш и переиндексирует position
    // по порядку массива — подмена subset'ом стёрла бы чужие позиции склада.
    const list = editing
      ? allItems.map((i) => (i.id === editing.id ? next : i))
      : [...allItems, next];
    save.mutate(
      { list, upsertIds: [next.id] },
      {
        // Sheet closes only on success — a failed save keeps the input.
        onSuccess: () => {
          setOpen(false);
          toast(editing ? "Сохранено" : "Добавлено");
        },
        onError: (e) => notify("Ошибка", e.message),
      },
    );
  };

  // onConfirm — side effect (закрыть шит редактора) СТРОГО после
  // подтверждения: «Отмена» в конфирме оставляет редактор открытым и
  // не теряет несохранённые правки полей.
  const remove = (id: string, onConfirm?: () => void) => {
    if (!owner) return;
    confirmThen(
      "Удалить позицию?",
      {
        message: "",
        confirmLabel: "Удалить",
        destructive: true,
      },
      () => {
        // removeIds carries the explicit deletion — the server must never
        // derive it from a (possibly stale) full snapshot. list=allItems
        // (без удаляемой) сохраняет остальной склад в кэше и позициях.
        save.mutate(
          {
            list: allItems.filter((i) => i.id !== id),
            removeIds: [id],
            upsertIds: [],
          },
          {
            // Keep the editor and its context visible when the canonical
            // delete fails. Closing before this callback discarded the
            // sheet even though the row still existed on the server.
            onSuccess: () => onConfirm?.(),
            onError: (e) => notify("Ошибка", e.message),
          },
        );
      },
    );
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title={lockedTeamId ? "Оборудование" : "Склад"}
        subtitle={team ? team.name : undefined}
      />
      {isLoading || teamsQuery.isLoading ? (
        <EmptyState state="loading" fill />
      ) : isError || teamsQuery.isError ? (
        <EmptyState
          state="error"
          fill
          subtitle={
            (error || teamsQuery.error) instanceof Error
              ? ((error || teamsQuery.error) as Error).message
              : undefined
          }
          action={{
            label: isFetching ? "Проверяем…" : "Повторить",
            onPress: () => void Promise.all([refetch(), teamsQuery.refetch()]),
          }}
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ flexGrow: 1, paddingTop: 8 }}
          renderItem={({ item }) => {
            const content = (
              <>
                <View
                  className="mr-3 h-9 w-9 items-center justify-center rounded-[10px]"
                  style={{ backgroundColor: (item.color ?? th.accent) + "1f" }}
                >
                  <Package color={item.color ?? th.accent} size={ICON.sm} />
                </View>
                <View className="flex-1 pr-2">
                  <Text
                    className="text-base font-semibold"
                    style={{ color: th.ink }}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  <Text
                    className="text-sm"
                    style={{ color: th.sub }}
                    numberOfLines={1}
                  >
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
              </>
            );
            return (
              <View className="flex-row items-center">
                {owner ? (
                  <Pressable
                    onPress={() => openEdit(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Изменить ${item.name}`}
                    className="min-h-[56px] flex-1 flex-row items-center px-4 py-3 active:opacity-60"
                  >
                    {content}
                  </Pressable>
                ) : (
                  <View className="min-h-[56px] flex-1 flex-row items-center px-4 py-3">
                    {content}
                  </View>
                )}
                {owner ? (
                  <Pressable
                    onPress={() => remove(item.id)}
                    className="mr-1 h-11 w-11 items-center justify-center"
                    accessibilityRole="button"
                    accessibilityLabel={`Удалить ${item.name}`}
                  >
                    <Trash2 color={th.danger} size={ICON.sm} />
                  </Pressable>
                ) : null}
              </View>
            );
          }}
          ItemSeparatorComponent={() => <Divider inset={64} />}
          ListHeaderComponent={
            !owner ? (
              <View
                className="mx-4 mb-2 rounded-[10px] px-3 py-2"
                style={{ backgroundColor: th.fill }}
              >
                <Text style={{ fontSize: 13, lineHeight: 18, color: th.sub }}>
                  Только просмотр. Изменять склад может владелец.
                </Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            owner && items.length > 0 ? (
              <>
                <Divider inset={64} />
                <AddRow label="Добавить позицию" onPress={openNew} />
              </>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              fill
              title={
                lockedTeamId
                  ? "За командой пока ничего нет"
                  : role === "master"
                    ? "Нет назначенного оборудования"
                    : "Склад пуст"
              }
              subtitle={
                lockedTeamId
                  ? "Добавьте инструмент, машину или прибор — они появятся тут и на общем складе."
                  : "Инструменты, расходники, приборы — держите под рукой"
              }
              action={
                owner
                  ? { label: "Добавить позицию", onPress: openNew }
                  : undefined
              }
            />
          }
        />
      )}

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            className="flex-1"
            style={{ backgroundColor: th.scrim }}
            onPress={() => setOpen(false)}
            accessible={false}
          />
          <View
            className="rounded-t-[10px] p-5 pb-8"
            style={{ backgroundColor: th.surface }}
          >
            <Text className="mb-3 text-lg font-bold" style={{ color: th.ink }}>
              {editing ? "Позиция" : "Новая позиция"}
            </Text>
            <Field
              label="Название"
              value={name}
              onChangeText={setName}
              placeholder="Манометр"
              autoFocus
            />
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Field
                  label="Категория"
                  value={category}
                  onChangeText={setCategory}
                  placeholder="Прибор"
                />
              </View>
              <View className="flex-1">
                <Field
                  label="Серийный №"
                  value={serial}
                  onChangeText={setSerial}
                  placeholder="—"
                />
              </View>
            </View>
            {teams.length > 0 ? (
              <>
                <Text
                  className="mb-2 text-xs font-medium"
                  style={{ color: th.sub }}
                >
                  Команда
                </Text>
                <View className="mb-3 flex-row flex-wrap gap-2">
                  {[
                    { id: null as string | null, name: "На полке" },
                    ...teams,
                  ].map((t) => (
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
            <ColorField value={color || null} onChange={setColor} />
            <Field
              label="Заметки"
              value={notes}
              onChangeText={setNotes}
              placeholder="—"
            />
            <Button
              label={editing ? "Сохранить" : "Добавить"}
              onPress={submit}
              disabled={!name.trim() || save.isPending}
              loading={save.isPending}
            />
            {editing ? (
              <Pressable
                onPress={() => remove(editing.id, () => setOpen(false))}
                accessibilityRole="button"
                accessibilityLabel={`Удалить ${editing.name}`}
                className="mt-1 items-center py-3 active:opacity-70"
              >
                <Text
                  className="text-base font-medium"
                  style={{ color: th.danger }}
                >
                  Удалить
                </Text>
              </Pressable>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
