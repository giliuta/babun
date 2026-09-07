import { useState, type ReactElement } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
  type KeyboardTypeOptions,
} from "react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { AddRow } from "@/components/ui/AddRow";
import { ColorField } from "@/components/ui/picker-fields";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useThemeColors } from "@/theme/colors";
import { notify } from "@/lib/notify";
import { confirmThen } from "@/lib/confirm";

export interface RefField {
  key: string;
  label: string;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  required?: boolean;
  /** "color" renders a swatch row instead of a text input. */
  type?: "text" | "color";
  /** Palette for type="color" (hex values). */
  colors?: string[];
  /** Pre-filled value when creating a new record. */
  defaultValue?: string;
}

// Generic reference-data screen: list + create/edit bottom-sheet + delete.
// When itemToValues + onUpdate are provided, tapping a row opens it for edit.
// Создание — по стандарту «Добавить»: строка AddRow под списком (не «+» в
// нав-баре); в пустом состоянии — CTA внутри EmptyState.
export function RefListScreen<T extends { id: string }>({
  title,
  items,
  isLoading,
  error,
  onRetry,
  fields = [],
  onCreate,
  onUpdate,
  onDelete,
  itemToValues,
  itemAccessibilityLabel,
  renderItem,
  emptyText,
  addLabel,
}: {
  title: string;
  items: T[];
  isLoading: boolean;
  /** Ошибка загрузки списка — сбой сети не должен выглядеть как «пусто». */
  error?: unknown;
  onRetry?: () => void;
  /** Необязательны вместе с `onCreate`: без создания форма не открывается. */
  fields?: RefField[];
  /** Необязателен: справочник, у которого создание живёт В ДРУГОМ месте,
   *  показывает только список (команды, 2026-08-27 — календарь заводится в
   *  настройках календаря). Без него не рисуются ни строка «Добавить», ни
   *  кнопка в пустом состоянии. */
  onCreate?: (values: Record<string, string>) => Promise<void>;
  onUpdate?: (id: string, values: Record<string, string>) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  itemToValues?: (item: T) => Record<string, string>;
  itemAccessibilityLabel?: (item: T) => string;
  renderItem: (item: T) => ReactElement;
  emptyText: string;
  /** Подпись строки создания: «Добавить команду», «Добавить город»… */
  addLabel?: string;
}) {
  const t = useThemeColors();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const editable = !!(itemToValues && onUpdate);
  const canSubmit = fields
    .filter((f) => f.required)
    .every((f) => (values[f.key] ?? "").trim().length > 0);

  const openCreate = () => {
    setEditing(null);
    const init: Record<string, string> = {};
    for (const f of fields) if (f.defaultValue) init[f.key] = f.defaultValue;
    setValues(init);
    setOpen(true);
  };
  const openEdit = (item: T) => {
    setEditing(item);
    setValues(itemToValues ? itemToValues(item) : {});
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setEditing(null);
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (editing && onUpdate) await onUpdate(editing.id, values);
      else await onCreate?.(values);
      close();
      setValues({});
    } catch (e) {
      // Keep the sheet open so nothing typed is lost — user can retry.
      notify("Ошибка", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!editing || !onDelete) return;
    confirmThen(
      "Удалить?",
      {
        message: "Запись будет скрыта из списка.",
        confirmLabel: "Удалить",
        destructive: true,
      },
      async () => {
        setBusy(true);
        try {
          await onDelete(editing.id);
          close();
        } catch (e) {
          notify("Ошибка", (e as Error).message);
        } finally {
          setBusy(false);
        }
      },
    );
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title={title} />

      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : error != null ? (
        <EmptyState
          fill
          state="error"
          subtitle={error instanceof Error ? error.message : undefined}
          action={onRetry ? { label: "Повторить", onPress: onRetry } : undefined}
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ flexGrow: 1 }}
          renderItem={({ item }) =>
            editable ? (
              <Pressable
                onPress={() => openEdit(item)}
                accessibilityRole="button"
                accessibilityLabel={itemAccessibilityLabel?.(item)}
                className="active:opacity-60"
              >
                {renderItem(item)}
              </Pressable>
            ) : (
              renderItem(item)
            )
          }
          ItemSeparatorComponent={() => <Divider inset={16} />}
          ListFooterComponent={
            items.length > 0 && onCreate && addLabel ? (
              <>
                <Divider inset={16} />
                <AddRow label={addLabel} onPress={openCreate} />
              </>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              fill
              title={emptyText}
              action={
                onCreate && addLabel
                  ? { label: addLabel, onPress: openCreate }
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
        onRequestClose={close}
      >
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        <Pressable
          className="flex-1"
          style={{ backgroundColor: t.scrim }}
          onPress={close}
          accessible={false}
        />
        <View
          className="rounded-t-[10px] p-5 pb-8"
          style={{ backgroundColor: t.surface }}
        >
          <Text style={{ marginBottom: 12, fontSize: 18, fontWeight: "700", color: t.ink }}>
            {editing ? "Изменить" : "Добавить"}
          </Text>
          {fields.map((f, i) =>
            f.type === "color" ? (
              <ColorField
                key={f.key}
                label={f.label}
                value={values[f.key]}
                onChange={(c) => setValues((s) => ({ ...s, [f.key]: c }))}
                colors={f.colors}
              />
            ) : (
              <Field
                key={f.key}
                label={f.label}
                value={values[f.key] ?? ""}
                onChangeText={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                placeholder={f.placeholder}
                keyboardType={f.keyboardType}
                autoFocus={i === 0}
              />
            ),
          )}
          <Button
            label={editing ? "Сохранить" : "Создать"}
            onPress={submit}
            disabled={!canSubmit || busy}
            loading={busy}
          />
          {editing && onDelete ? (
            <Pressable
              onPress={remove}
              accessibilityRole="button"
              accessibilityLabel="Удалить запись"
              className="mt-1 items-center py-3 active:opacity-70"
            >
              <Text style={{ fontSize: 16, fontWeight: "500", color: t.danger }}>Удалить</Text>
            </Pressable>
          ) : null}
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
