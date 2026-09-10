import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Trash2 } from "lucide-react-native";
import type { ClientTag } from "@babun/shared/local/clients";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { GradientButton } from "@/components/ui/GradientButton";
import { SwipeRow } from "@/components/ui/SwipeRow";
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

  const [editing, setEditing] = useState<Editing | null>(null);

  const tags = useMemo(
    () =>
      [...(tagsQuery.data ?? [])].sort((a, b) =>
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
        >
          <View style={{ paddingHorizontal: GUTTER, gap: 8 }}>
            {tags.map((tag) => (
              <SwipeRow
                key={tag.id}
                label="Удалить"
                color={t.danger}
                icon={Trash2}
                accessibilityLabel={`Удалить тег ${tag.name}`}
                onAction={() => remove(tag)}
              >
                <Pressable
                  onPress={() => setEditing({ mode: "edit", tag })}
                  accessibilityRole="button"
                  accessibilityLabel={`Тег ${tag.name}, переименовать`}
                  accessibilityHint="Открывает название и выбор цвета"
                  style={({ pressed }) => ({
                    height: ROW_H,
                    flexDirection: "row",
                    alignItems: "center",
                    paddingLeft: 16,
                    borderRadius: t.radius.card,
                    backgroundColor: pressed ? t.pressed : t.surface,
                  })}
                >
                  {/* ПЛИТКА ВИДА, А НЕ ТОЧКА 12pt: у тега с 2026-09-10 есть и
                      значок, и он тот же, что у метки, услуги и типа объекта.
                      Точка умела показать только цвет. */}
                  <AppearanceTile color={tag.color || null} icon={tag.icon} size={28} />
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.3}
                    style={{
                      flexShrink: 1,
                      marginLeft: 12,
                      fontSize: 16,
                      color: t.ink,
                    }}
                  >
                    {tag.name}
                  </Text>
                </Pressable>
              </SwipeRow>
            ))}
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
