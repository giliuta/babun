import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ClientTag } from "@babun/shared/local/clients";
import { Button } from "@/components/ui/Button";
import { useThemeColors } from "@/theme/colors";
import {
  EMPTY_FILTER,
  STATUS_OPTIONS,
  type ClientsFilter,
} from "./filter";

function Chip({
  label,
  active,
  color,
  onPress,
}: {
  label: string;
  active: boolean;
  color?: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderColor: active ? t.accent : t.separator,
        backgroundColor: active
          ? t.dark ? `${t.accent}2e` : `${t.accent}14`
          : t.surface,
      }}
      className="mb-2 mr-2 flex-row items-center gap-1.5 rounded-full border px-3 py-1.5"
    >
      {color ? (
        <View
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }}
        />
      ) : null}
      <Text
        style={{ color: active ? t.accent : t.sub }}
        className="text-sm font-medium"
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const t = useThemeColors();
  return (
    <View className="pt-3">
      <Text
        style={{ color: t.faint }}
        className="mb-2 text-xs font-semibold uppercase tracking-wider"
      >
        {title}
      </Text>
      <View className="flex-row flex-wrap">{children}</View>
    </View>
  );
}

export function ClientsFilterSheet({
  visible,
  filter,
  onChange,
  onClose,
  tags,
  cities,
}: {
  visible: boolean;
  filter: ClientsFilter;
  onChange: (f: ClientsFilter) => void;
  onClose: () => void;
  tags: ClientTag[];
  cities: string[];
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();

  const toggleTag = (id: string) =>
    onChange({
      ...filter,
      tagIds: filter.tagIds.includes(id)
        ? filter.tagIds.filter((x) => x !== id)
        : [...filter.tagIds, id],
    });
  const toggleCity = (c: string) =>
    onChange({
      ...filter,
      cities: filter.cities.includes(c)
        ? filter.cities.filter((x) => x !== c)
        : [...filter.cities, c],
    });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={{ flex: 1, backgroundColor: t.scrim }} onPress={onClose} />
      <View
        style={{ backgroundColor: t.surface }}
        className="absolute bottom-0 left-0 right-0 max-h-[80%] rounded-t-3xl"
      >
        <View className="items-center pt-2">
          <View style={{ backgroundColor: t.separator }} className="h-1 w-10 rounded-full" />
        </View>
        <View className="flex-row items-center justify-between px-5 py-3">
          <Text style={{ color: t.ink }} className="text-lg font-bold">Фильтры</Text>
          <Pressable onPress={() => onChange(EMPTY_FILTER)}>
            <Text style={{ color: t.accent }} className="text-sm font-medium">Сбросить</Text>
          </Pressable>
        </View>

        <ScrollView className="px-5" contentContainerStyle={{ paddingBottom: 8 }}>
          <Section title="Статус">
            {STATUS_OPTIONS.map((s) => (
              <Chip
                key={s.key}
                label={s.label}
                active={filter.status === s.key}
                onPress={() => onChange({ ...filter, status: s.key })}
              />
            ))}
          </Section>

          {tags.length ? (
            <Section title="Тег">
              {tags.map((tg) => (
                <Chip
                  key={tg.id}
                  label={tg.name}
                  color={tg.color}
                  active={filter.tagIds.includes(tg.id)}
                  onPress={() => toggleTag(tg.id)}
                />
              ))}
            </Section>
          ) : null}

          {cities.length ? (
            <Section title="Город">
              {cities.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  active={filter.cities.includes(c)}
                  onPress={() => toggleCity(c)}
                />
              ))}
            </Section>
          ) : null}
        </ScrollView>

        {/* Bottom-pinned sheet → the home-indicator inset must be added
            explicitly or the button lands in the system gesture zone. */}
        <View
          style={{
            borderTopColor: t.separator,
            borderTopWidth: 1,
            paddingBottom: Math.max(16, insets.bottom + 8),
          }}
          className="px-4 pt-4"
        >
          <Button label="Показать" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
