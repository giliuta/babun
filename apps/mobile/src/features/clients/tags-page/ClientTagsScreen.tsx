import { useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { EyeOff, RotateCcw, Trash2 } from "lucide-react-native";
import type { ClientTag } from "@babun/shared/local/clients";
import { useDataRole } from "@/session/tenant";
import { otherTeamTemplates } from "@/components/ui/TemplatePicker";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { ReorderList } from "@/components/ui/ReorderList";
import {
  AppearanceTile,
  appearanceRowFill,
} from "@/components/ui/AppearanceSheet";
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
import { useClientSettingLevelsOf } from "@/features/clients/use-client-settings";
import { tagWriteWords } from "@/features/clients/tag-write-words";
import { useTeams } from "@/features/reference/queries";
import { TagSheet, type Editing } from "./TagSheet";

// ТЕГИ КЛИЕНТОВ — ПО РЕЦЕПТУ «МЕТКИ».
//
// Своя вёрстка справочника не годится: сырой `Modal animationType="slide"` со
// своим грабером `h-1 w-9`, удаление текстовой кнопкой внутри листа, имя и
// цвет двумя раздельными полями, пустое состояние самодельным блоком с
// объясняющим абзацем — канон такого не допускает, как и кнопку добавления
// строкой ВНУТРИ списка. Всё то же, что у «Меток», «Типов объектов» и «Типов
// событий»:
// строка 52pt с точкой цвета, свайп влево — «Удалить» с подтверждением,
// редактор — канонический `BottomSheet` с `NameColorField`, главное действие
// — кнопкой внизу экрана (теги заводят пачкой, и после первого не должно приходиться доскролливать список ради второго).
//
// ПОРЯДОК — ПЕРЕТАСКИВАНИЕМ (`ReorderList`): его хранит колонка
// `client_tags.position`; скрытые теги — в конце, при равных позициях —
// по алфавиту.

const ROW_H = 52;

export function ClientTagsScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const tagsQuery = useClientTags();
  // ТЕГИ КОМАНДЫ (закреплены за командой). Команда
  // едет адресом из настроек клиентов; без неё — первая команда.
  const { team } = useLocalSearchParams<{ team?: string }>();
  const { data: ownTeams = [] } = useTeams();
  const teamId =
    (team && ownTeams.some((tm) => tm.id === team) ? team : null) ??
    ownTeams[0]?.id ??
    null;
  // «ТОЛЬКО ВИДИТ» (как метки в «Настройках команды»): ни
  // кнопки внизу, ни свайпов, ни ручек, строка не открывает редактор.
  const levels = useClientSettingLevelsOf()(teamId);
  const readOnly = levels.tags !== "write";
  const showTags = levels.tags !== "hidden";
  // Включён ли блок «Тег» на карточке — на странице «Блоки клиентов»; здесь только справочник тегов.
  const teamName = ownTeams.find((tm) => tm.id === teamId)?.name;
  const createTag = useCreateClientTag();
  const updateTag = useUpdateClientTag();
  const deleteTag = useDeleteClientTag();
  const setHidden = useSetClientTagHidden();
  const reorderTags = useReorderClientTags();
  const [dragging, setDragging] = useState(false);

  const [editing, setEditing] = useState<Editing | null>(null);

  // ПОРЯДОК СПИСКА: сначала видимые в порядке владельца, скрытые — в конце.
  // Имя разводит только равные позиции (у давних тегов позиция проставлена
  // миграцией по алфавиту).
  // ШАБЛОНЫ ИЗ ДРУГИХ КОМАНД (как у услуг). Только владелец.
  const isOwner = useDataRole().data === "owner";
  const tagTemplates = useMemo(
    () =>
      isOwner
        ? otherTeamTemplates(tagsQuery.data ?? [], {
            teamId,
            teamOf: (x) => x.team_id,
            nameOf: (x) => x.name,
          }).map((x) => ({
            key: x.id,
            name: x.name,
            color: x.color ?? null,
            icon: x.icon ?? null,
            sub: ownTeams.find((tm) => tm.id === x.team_id)?.name,
            value: x,
          }))
        : [],
    [isOwner, tagsQuery.data, teamId, ownTeams],
  );
  const tags = useMemo(
    () =>
      [...(tagsQuery.data ?? [])]
        // Тег без команды (до разбивки тегов по командам) видят все.
        .filter((tag) => !tag.team_id || tag.team_id === teamId)
        .sort(
        (a, b) =>
          Number(a.hidden ?? false) - Number(b.hidden ?? false) ||
          (a.position ?? 0) - (b.position ?? 0) ||
          a.name.localeCompare(b.name, "ru", { sensitivity: "base" }),
      ),
    [tagsQuery.data, teamId],
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
        if (!teamId) throw new Error("Сначала заведите календарь.");
        await createTag.mutateAsync({
          name,
          color: draft.color,
          icon: draft.icon,
          teamId,
        });
        toast("Тег создан", "success");
      }
      setEditing(null);
    } catch (error) {
      notify(
        "Не удалось сохранить тег",
        tagWriteWords((error as Error).message),
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
        tagWriteWords((error as Error).message),
      );
    }
  };

  const reorder = async (ids: string[]) => {
    try {
      await reorderTags.mutateAsync(ids);
    } catch (error) {
      notify(
        "Не удалось сохранить порядок",
        tagWriteWords((error as Error).message),
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
            tagWriteWords((error as Error).message),
          );
        }
      },
    );

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Теги" subtitle={teamName} />

      {!showTags ? (
        <View style={{ flex: 1 }} />
      ) : tagsQuery.isLoading ? (
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
          action={
            readOnly
              ? undefined
              : {
                  label: "Добавить тег",
                  onPress: () => setEditing({ mode: "create" }),
                }
          }
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
              rangeFor={(index) => (readOnly ? [index, index] : [0, tags.length - 1])}
              // Ручка ВНУТРИ строки: строка ещё и смахивается, а колонка ручки
              // снаружи не уезжает — «Удалить» упиралось бы в неё.
              handleInside
              onReorder={reorder}
              onDraggingChange={setDragging}
            >
              {(tag, _index, handle) => (
                <SwipeRow
                  label={readOnly ? undefined : "Удалить"}
                  color={t.danger}
                  icon={Trash2}
                  accessibilityLabel={`Удалить тег ${tag.name}`}
                  onAction={readOnly ? undefined : () => remove(tag)}
                  // ЛЕВАЯ КРОМКА — СОСТОЯНИЕ, ПРАВАЯ — РАЗРУШЕНИЕ. Закон общий
                  // для всех справочников и держится тестом
                  // `swipe-edge-contract.test.ts`.
                  leading={readOnly ? undefined : {
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
                      backgroundColor: appearanceRowFill(tag.color, false, {
                        rest: t.surface,
                        pressed: t.pressed,
                      }),
                      opacity: tag.hidden ? 0.45 : 1,
                    }}
                  >
                    <Pressable
                      disabled={readOnly}
                      onPress={() => setEditing({ mode: "edit", tag })}
                      accessibilityRole={readOnly ? "text" : "button"}
                      accessibilityLabel={readOnly ? `Тег ${tag.name}` : `Тег ${tag.name}, переименовать`}
                      accessibilityHint="Открывает название, цвет и значок"
                      style={({ pressed }) => ({
                        flex: 1,
                        height: ROW_H,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        paddingLeft: 16,
                        // ЗАЛИВКУ ДЕРЖИТ ВСЯ СТРОКА, А НЕ ЕЁ ПОЛОВИНА: цвет
                        // стоит на внешней строке, здесь остаётся только
                        // отклик на палец. Иначе две заливки складывались, и
                        // колонка ручки выходила светлее остального.
                        backgroundColor: pressed ? t.pressed : "transparent",
                      })}
                    >
                      {/* ПЛИТКА ВИДА, А НЕ ТОЧКА 12pt: у тега есть и значок, и он тот же, что у метки и типа объекта. */}
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

      {!readOnly && !tagsQuery.isLoading && !tagsQuery.isError && tags.length > 0 ? (
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
        onClose={() => setEditing(null)}
        onSubmit={submit}
        templates={tagTemplates}
      />
    </Screen>
  );
}
