import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { EyeOff, RotateCcw, Trash2 } from "lucide-react-native";
import type { ClientTag } from "@babun/shared/local/clients";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { GradientButton } from "@/components/ui/GradientButton";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { ReorderList } from "@/components/ui/ReorderList";
import { NameColorField } from "@/components/ui/picker-fields";
import { AppearanceTile } from "@/components/ui/AppearanceSheet";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import { notify } from "@/lib/notify";
import { confirmThen } from "@/lib/confirm";
import {
  useClientTags,
  useCreateClientTag,
  useDeleteClientTag,
  useReorderClientTags,
  useSetClientTagHidden,
  useUpdateClientTag,
} from "@/features/clients/queries";

// ТЕГИ КЛИЕНТОВ — ПО РЕЦЕПТУ «МЕТКИ» (сведено 2026-09-10).
//
// Экран был последним справочником со своей вёрсткой: редактор — сырой
// `Modal animationType="slide"` со своим грабером `h-1 w-9` и своим нижним
// отступом, удаление — текстовой кнопкой внутри этого листа, имя и цвет —
// двумя раздельными полями, пустое состояние — самодельным блоком с
// объясняющим абзацем («Создайте теги для сегментов: VIP…»), которого канон
// не допускает вовсе, а кнопка добавления стояла строкой ВНУТРИ списка.
//
// Теперь всё то же, что у «Меток», «Типов объектов» и «Типов событий»:
// строка 52pt с точкой цвета, свайп влево — «Удалить» с подтверждением,
// редактор — канонический `BottomSheet` с `NameColorField`, главное действие
// — кнопкой внизу экрана (LOCKED 2026-08-27: теги заводят пачкой, и после
// первого не должно приходиться доскролливать список ради второго).
//
// ПЕРЕТАСКИВАНИЯ ЗДЕСЬ НЕТ, И ЭТО НЕ ЗАБЫВЧИВОСТЬ: у `client_tags` нет
// колонки порядка (проверено по схеме — id, name, color, tenant_id), а
// заводить её ради сортировки — отдельное решение владельца с миграцией на
// боевую базу. Пока список идёт по алфавиту, и это честно.

const DEFAULT_COLOR = PRESET_COLOR_CYCLE[2].value;
const ROW_H = 52;

type Editing = { mode: "create" } | { mode: "edit"; tag: ClientTag };

export default function ClientTagsScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const tagsQuery = useClientTags();
  const createTag = useCreateClientTag();
  const updateTag = useUpdateClientTag();
  const deleteTag = useDeleteClientTag();
  const setHidden = useSetClientTagHidden();
  const reorderTags = useReorderClientTags();
  const [dragging, setDragging] = useState(false);

  const [editing, setEditing] = useState<Editing | null>(null);

  // ПОРЯДОК СПИСКА: сначала видимые в порядке владельца, скрытые — в конце.
  // Имя разводит только равные позиции (у тегов, заведённых до 2026-09-10,
  // позиция проставлена миграцией по алфавиту).
  const tags = useMemo(
    () =>
      [...(tagsQuery.data ?? [])].sort(
        (a, b) =>
          Number(a.hidden ?? false) - Number(b.hidden ?? false) ||
          (a.position ?? 0) - (b.position ?? 0) ||
          a.name.localeCompare(b.name, "ru", { sensitivity: "base" }),
      ),
    [tagsQuery.data],
  );
  const busy =
    createTag.isPending || updateTag.isPending || deleteTag.isPending;

  const submit = async (draft: {
    name: string;
    color: string;
    icon: string | null;
  }) => {
    const name = draft.name.trim();
    if (!name || busy || !editing) return;
    try {
      if (editing.mode === "edit") {
        await updateTag.mutateAsync({
          id: editing.tag.id,
          patch: { name, color: draft.color, icon: draft.icon },
        });
        toast("Тег обновлён", "success");
      } else {
        await createTag.mutateAsync({
          name,
          color: draft.color,
          icon: draft.icon,
        });
        toast("Тег создан", "success");
      }
      setEditing(null);
    } catch (error) {
      notify(
        "Не удалось сохранить тег",
        (error as Error).message || "Проверьте соединение и попробуйте ещё раз.",
      );
    }
  };

  // СКРЫТАЯ СТРОКА ГАСНЕТ И ПАДАЕТ В КОНЕЦ, А НЕ ИСЧЕЗАЕТ: исчезнувшая
  // читается как удалённая (закон справочника, `swipe-edge-contract.test`).
  const toggleHidden = async (tag: ClientTag) => {
    try {
      await setHidden.mutateAsync({ id: tag.id, hidden: !tag.hidden });
      toast(tag.hidden ? "Тег снова в списке" : "Тег скрыт", "success");
    } catch (error) {
      notify(
        "Не удалось изменить тег",
        (error as Error).message || "Проверьте соединение и попробуйте ещё раз.",
      );
    }
  };

  const reorder = async (ids: string[]) => {
    try {
      await reorderTags.mutateAsync(ids);
    } catch (error) {
      notify(
        "Не удалось сохранить порядок",
        (error as Error).message || "Проверьте соединение и попробуйте ещё раз.",
      );
    }
  };

  // РАЗРУШИТЕЛЬНОЕ ЖИВЁТ НА КРОМКЕ ЖЕСТА И ПЕРЕСПРАШИВАЕТ: тег исчезает из
  // карточек всех клиентов, и вернуть его нечем.
  const remove = (tag: ClientTag) =>
    confirmThen(
      "Удалить тег?",
      {
        message: `«${tag.name}» исчезнет из карточек всех клиентов. Отменить это действие нельзя.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      async () => {
        try {
          await deleteTag.mutateAsync(tag.id);
          toast("Тег удалён", "success");
        } catch (error) {
          notify(
            "Не удалось удалить тег",
            (error as Error).message ||
              "Проверьте соединение и попробуйте ещё раз.",
          );
        }
      },
    );

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
      ) : tags.length === 0 ? (
        <EmptyState
          fill
          title="Тегов пока нет"
          action={{
            label: "Добавить тег",
            onPress: () => setEditing({ mode: "create" }),
          }}
        />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 12 }}
          scrollEnabled={!dragging}
        >
          <View style={{ paddingHorizontal: GUTTER }}>
            <ReorderList
              items={tags}
              rowHeight={ROW_H}
              spaced
              labelFor={(tag) => tag.name}
              // Ручка ВНУТРИ строки: строка ещё и смахивается, а колонка ручки
              // снаружи не уезжает — «Удалить» упиралось бы в неё.
              handleInside
              onReorder={reorder}
              onDraggingChange={setDragging}
            >
              {(tag, _index, handle) => (
                <SwipeRow
                  label="Удалить"
                  color={t.danger}
                  icon={Trash2}
                  accessibilityLabel={`Удалить тег ${tag.name}`}
                  onAction={() => remove(tag)}
                  // ЛЕВАЯ КРОМКА — СОСТОЯНИЕ, ПРАВАЯ — РАЗРУШЕНИЕ. Закон общий
                  // для всех справочников и держится тестом
                  // `swipe-edge-contract.test.ts`.
                  leading={{
                    label: tag.hidden ? "Показать" : "Скрыть",
                    color: tag.hidden ? t.success : t.warning,
                    icon: tag.hidden ? RotateCcw : EyeOff,
                    accessibilityLabel: `${
                      tag.hidden ? "Показать" : "Скрыть"
                    } тег ${tag.name}`,
                    onAction: () => toggleHidden(tag),
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: t.surface,
                      opacity: tag.hidden ? 0.45 : 1,
                    }}
                  >
                    <Pressable
                      onPress={() => setEditing({ mode: "edit", tag })}
                      accessibilityRole="button"
                      accessibilityLabel={`Тег ${tag.name}, переименовать`}
                      accessibilityHint="Открывает название, цвет и значок"
                      style={({ pressed }) => ({
                        flex: 1,
                        height: ROW_H,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        paddingLeft: 16,
                        backgroundColor: pressed ? t.pressed : t.surface,
                      })}
                    >
                      {/* ПЛИТКА ВИДА, А НЕ ТОЧКА 12pt: у тега с 2026-09-10 есть
                          и значок, и он тот же, что у метки и типа объекта. */}
                      <AppearanceTile
                        color={tag.color || null}
                        icon={tag.icon}
                        size={28}
                      />
                      <Text
                        numberOfLines={1}
                        maxFontSizeMultiplier={1.3}
                        style={{ flexShrink: 1, fontSize: 16, color: t.ink }}
                      >
                        {tag.name}
                      </Text>
                    </Pressable>
                    {/* Ручка СНАРУЖИ нажимаемой области: вложенная внутрь, она
                        отдавала бы короткий тап строке и открывала правку
                        вместо перетаскивания. */}
                    {handle}
                  </View>
                </SwipeRow>
              )}
            </ReorderList>
          </View>
        </ScrollView>
      )}

      {!tagsQuery.isLoading && !tagsQuery.isError && tags.length > 0 ? (
        <View
          style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 16 }}
        >
          <GradientButton
            label="Добавить тег"
            onPress={() => setEditing({ mode: "create" })}
          />
        </View>
      ) : null}

      <TagSheet
        editing={editing}
        busy={busy}
        onClose={() => (busy ? undefined : setEditing(null))}
        onSubmit={submit}
      />
    </Screen>
  );
}

/** Редактор тега — канонический лист: имя с цветом одной строкой, одна
 *  кнопка внизу. Удаление здесь не живёт: оно на кромке свайпа (закон о двух
 *  окнах — вопрос, заданный из листа, не показался бы вовсе). */
function TagSheet({
  editing,
  busy,
  onClose,
  onSubmit,
}: {
  editing: Editing | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: { name: string; color: string; icon: string | null }) => void;
}) {
  const isEdit = editing?.mode === "edit";
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [icon, setIcon] = useState<string | null>(null);
  // key-remount через editing==null → null; локальный стейт инициализируем от
  // editing при каждом открытии (паттерн «render-time reset», как у меток).
  const [seeded, setSeeded] = useState<Editing | null>(null);
  if (editing !== seeded) {
    setSeeded(editing);
    setName(isEdit ? editing.tag.name : "");
    setColor(isEdit ? editing.tag.color || DEFAULT_COLOR : DEFAULT_COLOR);
    setIcon(isEdit ? (editing.tag.icon ?? null) : null);
  }

  return (
    <BottomSheet
      visible={editing !== null}
      onClose={onClose}
      title={isEdit ? "Тег" : "Новый тег"}
      avoidKeyboard
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          <Button
            label={isEdit ? "Сохранить" : "Создать тег"}
            disabled={!name.trim() || busy}
            loading={busy}
            onPress={() => onSubmit({ name, color, icon })}
          />
        </View>
      }
    >
      <NameColorField
        name={name}
        onNameChange={setName}
        color={color}
        onColorChange={setColor}
        icon={icon}
        onIconChange={setIcon}
        autoFocus={!isEdit}
      />
    </BottomSheet>
  );
}
