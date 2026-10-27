import {
  TemplateList,
  TemplatesHeaderButton,
  useTemplatePicking,
  type TemplateItem,
} from "@/components/ui/TemplatePicker";
import { useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Trash2 } from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useGuardedClose } from "@/components/ui/use-guarded-close";
import { Button } from "@/components/ui/Button";
import { GradientButton } from "@/components/ui/GradientButton";
import { PageFooter } from "@/components/ui/PageFooter";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { ReorderList } from "@/components/ui/ReorderList";
import { NameField } from "@/components/ui/picker-fields";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import { notify } from "@/lib/notify";
import { isHumanText, tDynamic } from "@babun/shared/i18n/runtime";
import { confirmThen } from "@/lib/confirm";
import { teamSources, type ClientSource, sourceDisplayName } from "@/features/clients/acquisition-source";
import { useDataRole } from "@/session/tenant";
import { otherTeamTemplates } from "@/components/ui/TemplatePicker";
import {
  useClientSources,
  useCreateClientSource,
  useDeleteClientSource,
  useRenameClientSource,
  useReorderClientSources,
} from "@/features/clients/acquisition-sources";
import { CUSTOM_SOURCE_ICON, SOURCE_ICONS } from "@/features/clients/source-icons";
import { ClientSettingsRoute } from "@/features/clients/ClientSettingsRoute";
import { useClientSettingLevelsOf } from "@/features/clients/use-client-settings";
import { useTeams } from "@/features/reference/queries";

// ИСТОЧНИКИ — ОТКУДА ПРИХОДЯТ КЛИЕНТЫ: стандартные источники, которые
// можно править, удалять (хоть Instagram) и добавлять новые.
//
// Один справочник команды по рецепту «Тегов»: восемь готовых засеяны
// строками и ничем не отличаются от добавленных. Строка 52pt, тап —
// переименовать, свайп влево — «Удалить» с вопросом, ручка — порядок,
// «Добавить источник» — кнопкой внизу. Цвета у источника нет: значок — у
// готового его, у добавленного общий.
//
// Право — своё, «Источники» (`clients.settings_sources`): у каждой
// строки шестерёнки своё право.

const ROW_H = 52;

type Editing = { mode: "create" } | { mode: "edit"; source: ClientSource };

export default function ClientSourcesScreenRoute() {
  return (
    <ClientSettingsRoute row="sources">
      <ClientSourcesScreen />
    </ClientSettingsRoute>
  );
}

function ClientSourcesScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const query = useClientSources();
  const { team } = useLocalSearchParams<{ team?: string }>();
  const { data: ownTeams = [] } = useTeams({ display: true });
  const teamId =
    (team && ownTeams.some((tm) => tm.id === team) ? team : null) ??
    ownTeams[0]?.id ??
    null;
  const teamName = ownTeams.find((tm) => tm.id === teamId)?.name;
  const levels = useClientSettingLevelsOf()(teamId);
  const readOnly = levels.sources !== "write";

  const createSource = useCreateClientSource();
  const renameSource = useRenameClientSource();
  const deleteSource = useDeleteClientSource();
  const reorderSources = useReorderClientSources();
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);

  const list = useMemo(() => teamSources(query.data ?? [], teamId), [query.data, teamId]);
  // ШАБЛОНЫ ИЗ ДРУГИХ КОМАНД (как у услуг). Только владелец.
  const isOwner = useDataRole().data === "owner";
  const sourceTemplates = useMemo(
    () =>
      isOwner
        ? otherTeamTemplates(query.data ?? [], {
            teamId,
            teamOf: (x) => x.team_id,
            nameOf: (x) => sourceDisplayName(x),
          }).map((x) => ({
            key: x.id,
            name: sourceDisplayName(x),
            sub: ownTeams.find((tm) => tm.id === x.team_id)?.name,
            value: x,
          }))
        : [],
    [isOwner, query.data, teamId, ownTeams],
  );
  const busy = createSource.isPending || renameSource.isPending;
  // Текст сервера — только человеческий и переведённый; технический код
  // («PGRST…», «duplicate key…») человеку ничего не скажет.
  const failed = (title: string, error: unknown) => {
    const text = (error as Error)?.message ?? "";
    notify(title, isHumanText(text) ? tDynamic(text) : "Проверьте соединение и попробуйте ещё раз.");
  };

  const submit = async (name: string) => {
    if (!name.trim() || busy || !editing) return;
    try {
      if (editing.mode === "edit") {
        // Готовый источник показан на языке интерфейса; имя не тронули —
        // в базе остаётся исходное, иначе перевод лёг бы вместо него.
        if (name.trim() === sourceDisplayName(editing.source)) {
          setEditing(null);
          return;
        }
        await renameSource.mutateAsync({ id: editing.source.id, name });
        toast("Источник обновлён", "success");
      } else {
        if (!teamId) throw new Error("Сначала заведите календарь.");
        const last = list[list.length - 1];
        await createSource.mutateAsync({ name, teamId, position: (last?.position ?? -1) + 1 });
        toast("Источник добавлен", "success");
      }
      setEditing(null);
    } catch (error) {
      failed("Не удалось сохранить источник", error);
    }
  };

  const reorder = async (ids: string[]) => {
    try {
      await reorderSources.mutateAsync(ids);
    } catch (error) {
      failed("Не удалось сохранить порядок", error);
    }
  };

  const remove = (source: ClientSource) =>
    confirmThen(
      "Удалить источник?",
      {
        message: `Клиенты из «${sourceDisplayName(source)}» останутся без источника.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      async () => {
        try {
          await deleteSource.mutateAsync(source.id);
          toast("Источник удалён", "success");
        } catch (error) {
          failed("Не удалось удалить источник", error);
        }
      },
    );

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Источники" subtitle={teamName} />

      {levels.sources === "hidden" ? (
        <View style={{ flex: 1 }} />
      ) : query.isLoading ? (
        <EmptyState state="loading" fill />
      ) : query.isError ? (
        <EmptyState
          state="error"
          fill
          subtitle={
            query.error instanceof Error && isHumanText(query.error.message)
              ? query.error.message
              : undefined
          }
          action={{ label: "Повторить", onPress: () => void query.refetch() }}
        />
      ) : list.length === 0 ? (
        // Пустое состояние — только слова: «Добавить источник» внизу, там же,
        // где у полного списка (AGENTS 7.1).
        <EmptyState fill title="Источников пока нет" />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 12 }}
          scrollEnabled={!dragging}
        >
          <View style={{ paddingHorizontal: GUTTER }}>
            <ReorderList
              items={list}
              rowHeight={ROW_H}
              spaced
              labelFor={(s) => sourceDisplayName(s)}
              rangeFor={(index) => (readOnly ? [index, index] : [0, list.length - 1])}
              handleInside
              onReorder={reorder}
              onDraggingChange={setDragging}
            >
              {(source, _index, handle) => {
                const Icon = (source.key ? SOURCE_ICONS[source.key] : undefined) ?? CUSTOM_SOURCE_ICON;
                return (
                  <SwipeRow
                    label={readOnly ? undefined : "Удалить"}
                    color={t.danger}
                    icon={Trash2}
                    accessibilityLabel={`Удалить источник ${sourceDisplayName(source)}`}
                    onAction={readOnly ? undefined : () => remove(source)}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: t.surface }}>
                      <Pressable
                        disabled={readOnly}
                        onPress={() => setEditing({ mode: "edit", source })}
                        accessibilityRole={readOnly ? "text" : "button"}
                        accessibilityLabel={
                          readOnly
                            ? `Источник ${sourceDisplayName(source)}`
                            : `Источник ${sourceDisplayName(source)}, переименовать`
                        }
                        style={({ pressed }) => ({
                          flex: 1,
                          height: ROW_H,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 12,
                          paddingLeft: 16,
                          backgroundColor: pressed ? t.pressed : "transparent",
                        })}
                      >
                        <Icon size={20} strokeWidth={2} color={t.accent} />
                        <Text
                          numberOfLines={1}
                          maxFontSizeMultiplier={1.3}
                          style={{ flexShrink: 1, fontSize: 16, color: t.ink }}
                        >
                          {sourceDisplayName(source)}
                        </Text>
                      </Pressable>
                      {handle}
                    </View>
                  </SwipeRow>
                );
              }}
            </ReorderList>
          </View>
        </ScrollView>
      )}

      {/* ГЛАВНОЕ ДЕЙСТВИЕ — ВНИЗУ И ВСЕГДА: пуст список или полон. */}
      {!readOnly ? (
        <PageFooter>
          <GradientButton label="Добавить источник" onPress={() => setEditing({ mode: "create" })} />
        </PageFooter>
      ) : null}

      <SourceSheet
        editing={editing}
        busy={busy}
        onClose={() => (busy ? undefined : setEditing(null))}
        onSubmit={submit}
        templates={sourceTemplates}
      />
    </Screen>
  );
}

/** Редактор источника — только имя, одна кнопка внизу. Удаление — на кромке
 *  свайпа, как у всех справочников. */
function SourceSheet({
  editing,
  busy,
  onClose,
  onSubmit,
  templates,
}: {
  /** Шаблоны из других команд аккаунта (значок в шапке при создании). */
  templates?: readonly TemplateItem<ClientSource>[];
  editing: Editing | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const { picking, setPicking } = useTemplatePicking();
  const isEdit = editing?.mode === "edit";
  const [name, setName] = useState("");
  const [seeded, setSeeded] = useState<Editing | null>(null);
  const seedName = isEdit ? sourceDisplayName(editing.source) : "";
  if (editing !== seeded) {
    setSeeded(editing);
    setPicking(false);
    setName(seedName);
  }
  // НАБРАННОЕ НЕ ПРОПАДАЕТ ОТ СКРИМА И СВАЙПА — как у тега и метки: сначала
  // вопрос.
  const guard = useGuardedClose({
    dirty: editing !== null && name !== seedName,
    busy,
    onClose,
    message: "Набранное в источнике не сохранится.",
  });

  const applyTemplate = (tpl: ClientSource) => {
    setName(sourceDisplayName(tpl));
    setPicking(false);
  };

  return (
    <BottomSheet
      visible={editing !== null && !guard.hidden}
      onClose={guard.close}
      onExited={guard.onExited}
      title={isEdit ? "Источник" : "Новый источник"}
      avoidKeyboard
      footer={picking ? undefined : (<View style={{ paddingHorizontal: GUTTER }}>
          <Button
            label={isEdit ? "Сохранить" : "Добавить источник"}
            disabled={!name.trim() || busy}
            loading={busy}
            onPress={() => onSubmit(name)}
          />
        </View>)}
    
      headerAction={
        !isEdit && (templates?.length ?? 0) > 0 ? (
          <TemplatesHeaderButton picking={picking} onToggle={() => setPicking((v) => !v)} />
        ) : undefined
      }
    >
      {picking ? (
        <TemplateList items={templates ?? []} gutter={false} onPick={applyTemplate} />
      ) : (
      <>
      <NameField name={name} onNameChange={setName} autoFocus={!isEdit} maxLength={60} />
          </>
      )}
    </BottomSheet>
  );
}
