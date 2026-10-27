import {
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";
import type { Equipment } from "@babun/shared/local/equipment";
import { KeyboardLift } from "@/components/ui/KeyboardLift";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { AppearanceField } from "@/components/ui/picker-fields";
import { LATIN_KEYBOARD } from "@/lib/keyboard";
import { useThemeColors } from "@/theme/colors";

/** The add / edit form of a stock item. */
export function InventoryEditorSheet({
  open,
  onClose,
  editing,
  teams,
  name,
  setName,
  category,
  setCategory,
  serial,
  setSerial,
  teamId,
  setTeamId,
  color,
  setColor,
  notes,
  setNotes,
  saving,
  onSubmit,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  editing: Equipment | null;
  teams: readonly { id: string; name: string }[];
  name: string;
  setName: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  serial: string;
  setSerial: (value: string) => void;
  teamId: string | null;
  setTeamId: (value: string | null) => void;
  /** "" — без цвета. */
  color: string;
  setColor: (value: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  saving: boolean;
  onSubmit: () => void;
  /** Удалить позицию из редактора; лист закрывается после ответа сервера. */
  onDelete: () => void;
}) {
  const th = useThemeColors();
  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardLift
        style={{ flex: 1 }}
      >
        <Pressable
          className="flex-1"
          style={{ backgroundColor: th.scrim }}
          onPress={onClose}
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
                keyboardType={LATIN_KEYBOARD}
                autoCorrect={false}
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
          <AppearanceField
            color={color || null}
            onColorChange={setColor}
            label="Цвет"
          />
          <Field
            label="Заметки"
            value={notes}
            onChangeText={setNotes}
            placeholder="—"
          />
          <Button
            label={editing ? "Сохранить" : "Добавить"}
            onPress={onSubmit}
            disabled={!name.trim() || saving}
            loading={saving}
          />
          {editing ? (
            <Pressable
              onPress={onDelete}
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
      </KeyboardLift>
    </Modal>
  );
}
