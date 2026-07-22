import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { Check, Search, X } from "lucide-react-native";
import { EmptyState } from "@/components/ui/EmptyState";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

export interface EntityOption {
  id: string;
  title: string;
  subtitle?: string;
}

export function EntityPickerSheet({
  visible,
  title,
  options,
  selectedId,
  allowEmpty = true,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: EntityOption[];
  selectedId: string | null;
  allowEmpty?: boolean;
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    if (!needle) return options;
    return options.filter((option) =>
      `${option.title} ${option.subtitle ?? ""}`.toLocaleLowerCase("ru").includes(needle),
    );
  }, [options, query]);

  const close = () => {
    setQuery("");
    onClose();
  };
  const pick = (id: string | null) => {
    onPick(id);
    close();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View className="flex-1" style={{ backgroundColor: t.canvas }}>
        <View
          className="flex-row items-center px-2 py-1"
          style={{ backgroundColor: t.surface, borderBottomWidth: 1, borderBottomColor: t.separator }}
        >
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Закрыть"
            className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
          >
            <X color={t.body} size={ICON.md} />
          </Pressable>
          <Text className="flex-1 text-center text-[17px] font-semibold" style={{ color: t.ink }}>
            {title}
          </Text>
          <View className="h-11 w-11" />
        </View>

        <View
          className="mx-3 my-3 flex-row items-center rounded-xl px-3"
          style={{ minHeight: 44, backgroundColor: t.fill }}
        >
          <Search color={t.faint} size={ICON.sm} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Поиск"
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance="light"
            autoCorrect={false}
            accessibilityLabel={`Поиск: ${title}`}
            className="ml-2 flex-1 text-base"
            style={{ color: t.ink }}
          />
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(option) => option.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 24 }}
          ListHeaderComponent={
            allowEmpty ? (
              <PickerRow
                title="Не выбрано"
                selected={selectedId === null}
                onPress={() => pick(null)}
              />
            ) : null
          }
          ListEmptyComponent={<EmptyState title="Ничего не найдено" />}
          renderItem={({ item }) => (
            <PickerRow
              title={item.title}
              subtitle={item.subtitle}
              selected={selectedId === item.id}
              onPress={() => pick(item.id)}
            />
          )}
        />
      </View>
    </Modal>
  );
}

function PickerRow({
  title,
  subtitle,
  selected,
  onPress,
}: Omit<EntityOption, "id"> & { selected: boolean; onPress: () => void }) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={{ selected }}
      className="flex-row items-center px-4 py-2.5 active:opacity-60"
      style={{ minHeight: 52, backgroundColor: t.surface, borderBottomWidth: 1, borderBottomColor: t.separator }}
    >
      <View className="flex-1 pr-3">
        <Text className="text-base" style={{ color: t.ink }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="mt-0.5 text-[13px]" style={{ color: t.sub }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {selected ? <Check color={t.accent} size={ICON.sm} strokeWidth={2.7} /> : null}
    </Pressable>
  );
}
