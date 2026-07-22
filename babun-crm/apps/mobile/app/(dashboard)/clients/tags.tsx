import { Fragment, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { ChevronRight, Tags } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ClientTag } from "@babun/shared/local/clients";
import { PRESET_COLORS } from "@babun/shared/common/utils/colors";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { AddRow } from "@/components/ui/AddRow";
import { Field } from "@/components/ui/Field";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  useClientTags,
  useCreateClientTag,
  useDeleteClientTag,
  useUpdateClientTag,
} from "@/features/clients/queries";

const DEFAULT_COLOR = PRESET_COLORS[2]?.value ?? "#5E5CE6";

export default function ClientTagsScreen() {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const tagsQuery = useClientTags();
  const createTag = useCreateClientTag();
  const updateTag = useUpdateClientTag();
  const deleteTag = useDeleteClientTag();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClientTag | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);

  const tags = useMemo(
    () =>
      [...(tagsQuery.data ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, "ru", { sensitivity: "base" }),
      ),
    [tagsQuery.data],
  );
  const busy =
    createTag.isPending || updateTag.isPending || deleteTag.isPending;

  const openCreate = () => {
    setEditing(null);
    setName("");
    setColor(DEFAULT_COLOR);
    setOpen(true);
  };

  const openEdit = (tag: ClientTag) => {
    setEditing(tag);
    setName(tag.name);
    setColor(tag.color || DEFAULT_COLOR);
    setOpen(true);
  };

  const closeEditor = () => {
    if (busy) return;
    setOpen(false);
    setEditing(null);
  };

  const submit = async () => {
    const normalizedName = name.trim();
    if (!normalizedName || busy) return;
    try {
      if (editing) {
        await updateTag.mutateAsync({
          id: editing.id,
          patch: { name: normalizedName, color },
        });
        toast("Тег обновлён", "success");
      } else {
        await createTag.mutateAsync({ name: normalizedName, color });
        toast("Тег создан", "success");
      }
      setOpen(false);
      setEditing(null);
      setName("");
    } catch (error) {
      Alert.alert(
        "Не удалось сохранить тег",
        (error as Error).message ||
          "Проверьте соединение и попробуйте ещё раз.",
      );
    }
  };

  const confirmDelete = () => {
    if (!editing || busy) return;
    const tag = editing;
    Alert.alert(
      "Удалить тег?",
      `«${tag.name}» исчезнет из карточек всех клиентов. Отменить это действие нельзя.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteTag.mutateAsync(tag.id);
              setOpen(false);
              setEditing(null);
              toast("Тег удалён", "success");
            } catch (error) {
              Alert.alert(
                "Не удалось удалить тег",
                (error as Error).message ||
                  "Проверьте соединение и попробуйте ещё раз.",
              );
            }
          },
        },
      ],
    );
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Теги клиентов" />

      {tagsQuery.isLoading ? (
        <EmptyState state="loading" fill />
      ) : tagsQuery.isError ? (
        <EmptyState
          state="error"
          fill
          subtitle={
            tagsQuery.error instanceof Error
              ? tagsQuery.error.message
              : undefined
          }
          action={{
            label: "Повторить",
            onPress: () => void tagsQuery.refetch(),
          }}
        />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <SectionEyebrow>Справочник</SectionEyebrow>
          <SectionCard>
            {tags.length > 0 ? (
              <>
                {tags.map((tag, index) => (
                  <Fragment key={tag.id}>
                    {index > 0 ? <Divider inset={60} /> : null}
                    <Pressable
                      onPress={() => openEdit(tag)}
                      accessibilityRole="button"
                      accessibilityLabel={`Тег ${tag.name}, изменить`}
                      accessibilityHint="Открывает название и выбор цвета"
                      className="min-h-[56px] flex-row items-center px-4 py-2"
                      style={({ pressed }) => ({
                        backgroundColor: pressed ? t.pressed : "transparent",
                      })}
                    >
                      <View
                        className="mr-3 h-8 w-8 rounded-full border-2"
                        style={{
                          backgroundColor: tag.color || t.faint,
                          borderColor: t.surface,
                        }}
                      />
                      <Text
                        className="flex-1 text-base font-medium"
                        style={{ color: t.ink }}
                        numberOfLines={2}
                      >
                        {tag.name}
                      </Text>
                      <ChevronRight
                        color={t.chevron}
                        size={ICON.sm}
                        strokeWidth={2.2}
                      />
                    </Pressable>
                  </Fragment>
                ))}
                <Divider inset={16} />
                <AddRow label="Добавить тег" onPress={openCreate} />
              </>
            ) : (
              <View>
                <View className="items-center px-6 pb-4 pt-6">
                  <View
                    className="mb-3 h-12 w-12 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: `${t.accent}14` }}
                  >
                    <Tags color={t.accent} size={ICON.md} strokeWidth={2} />
                  </View>
                  <Text
                    className="text-center text-base font-semibold"
                    style={{ color: t.ink }}
                  >
                    Тегов пока нет
                  </Text>
                  <Text
                    className="mt-1 text-center text-[13px] leading-5"
                    style={{ color: t.sub }}
                  >
                    Создайте теги для сегментов: VIP, постоянные клиенты или
                    особые условия обслуживания.
                  </Text>
                </View>
                <Divider inset={16} />
                <AddRow label="Добавить тег" onPress={openCreate} />
              </View>
            )}
          </SectionCard>

          <Text
            className="mx-5 mt-3 text-[13px] leading-5"
            style={{ color: t.faint }}
          >
            Теги видны в карточках и фильтрах клиентов. Нажмите на тег, чтобы
            изменить его название или цвет.
          </Text>
        </ScrollView>
      )}

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={closeEditor}
      >
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            className="flex-1"
            style={{ backgroundColor: t.scrim }}
            onPress={closeEditor}
            accessible={false}
          />
          <View
            accessibilityViewIsModal
            className="rounded-t-3xl px-5 pt-4"
            style={{
              backgroundColor: t.surface,
              paddingBottom: Math.max(insets.bottom, 24),
            }}
          >
            <View
              className="mx-auto mb-4 h-1 w-9 rounded-full"
              style={{ backgroundColor: t.separator }}
            />
            <Text className="mb-4 text-xl font-bold" style={{ color: t.ink }}>
              {editing ? "Изменить тег" : "Новый тег"}
            </Text>
            <Field
              label="Название"
              value={name}
              onChangeText={setName}
              placeholder="Например, Постоянный клиент"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
              editable={!busy}
              maxLength={80}
            />
            <ColorPicker value={color} onChange={setColor} disabled={busy} />
            <Button
              label={editing ? "Сохранить" : "Создать тег"}
              onPress={() => void submit()}
              disabled={!name.trim() || busy}
              loading={createTag.isPending || updateTag.isPending}
            />
            {editing ? (
              <Pressable
                onPress={confirmDelete}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Удалить тег ${editing.name}`}
                className="mt-1 min-h-11 items-center justify-center px-4"
                style={{ opacity: busy ? 0.45 : 1 }}
              >
                <Text
                  className="text-base font-medium"
                  style={{ color: t.danger }}
                >
                  Удалить тег
                </Text>
              </Pressable>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
