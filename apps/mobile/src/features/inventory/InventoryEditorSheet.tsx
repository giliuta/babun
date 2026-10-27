import { Pressable, Text, View } from "react-native";
import type { Equipment } from "@babun/shared/local/equipment";
import { BottomSheet } from "@/components/ui/BottomSheet";
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
  // ЛИСТ — КАНОНИЧЕСКИЙ `BottomSheet`: свой `Modal` не знал нижнего отступа
  // edge-to-edge, и на Android с кнопками навигации «Сохранить» и «Удалить»
  // ложились под «Назад / Домой». Шапка, скрим, клавиатура и отступ — его.
  const footer = (
    <>
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
          <Text className="text-base font-medium" style={{ color: th.danger }}>
            Удалить
          </Text>
        </Pressable>
      ) : null}
    </>
  );
  return (
    <BottomSheet
      visible={open}
      onClose={onClose}
      title={editing ? "Позиция" : "Новая позиция"}
      footer={footer}
      scroll
    >
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
          <Text className="mb-2 text-xs font-medium" style={{ color: th.sub }}>
            Команда
          </Text>
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
      <AppearanceField color={color || null} onColorChange={setColor} label="Цвет" />
      <Field label="Заметки" value={notes} onChangeText={setNotes} placeholder="—" />
    </BottomSheet>
  );
}
