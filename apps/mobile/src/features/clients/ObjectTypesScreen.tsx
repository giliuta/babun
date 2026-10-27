import { useMemo, useState } from "react";
import { useDataRole } from "@/session/tenant";
import { otherTeamTemplates } from "@/components/ui/TemplatePicker";
import { useLocalSearchParams } from "expo-router";
import { useClientSettingLevel } from "@/features/clients/use-client-settings";
import { useTeams } from "@/features/reference/queries";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Tag, Trash2 } from "lucide-react-native";
import {
  generateLocationLabelId,
  type LocationLabel,
} from "@babun/shared/local/location-labels";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useTeamName } from "@/session/team-name";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  AppearanceTile,
  appearanceRowFill,
} from "@/components/ui/AppearanceSheet";
import { GradientButton } from "@/components/ui/GradientButton";
import { PageFooter } from "@/components/ui/PageFooter";
import { ReorderList } from "@/components/ui/ReorderList";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import { notify } from "@/lib/notify";
import { confirmThen } from "@/lib/confirm";
import { useClients } from "@/features/clients/queries";
import {
  useLocationLabels,
  useSaveLocationLabels,
} from "@/features/settings/local-settings";
import { TypeSheet, type Editing, type TypeDraft } from "./object-types/TypeSheet";

// ТИПЫ ОБЪЕКТОВ — СПРАВОЧНИК ПО ОБЩЕМУ КАНОНУ («ОДИН ДИЗАЙН НА ВСЕ СПИСКИ»):
// ровно то же, что у меток и услуг:
//   • строка — имя и ручка перетаскивания, порядок задаёт человек;
//   • удаление — СМАХНУТЬ ВЛЕВО, с подтверждением; корзины в строке нет
//     (она занимала место всегда и стояла под тем же пальцем, что и правка);
//   • тап по строке — правка листом снизу, там же переименование;
//   • «Добавить тип» — кнопка ВНИЗУ и всегда: типы заводят пачкой.
//
// ЦВЕТА У ТИПА НЕТ и не заводится: его никто не читает — ни строка объекта,
// ни чипы выбора (DS: «цвет сущности заводится только вместе с читателем»).
//
// ПЕРЕИМЕНОВАНИЕ НЕ ТРОГАЕТ ЗАВЕДЁННЫЕ ОБЪЕКТЫ. У объекта тип хранится
// СТРОКОЙ — снимком того слова, которым его назвали (тот же закон, что у
// услуги в записи). Справочник — про то, что предлагать дальше.

/** Высота строки: по ней перетаскивание считает, через сколько соседей
 *  перелетел палец. Та же, что у меток. */
const ROW_H = 52;

export function ObjectTypesScreen() {
  const t = useThemeColors();
  const toast = useToast();
  // ТИПЫ ОБЪЕКТОВ КОМАНДЫ — закреплены за командой.
  // Команда едет адресом из настроек клиентов; без неё — первая команда.
  const { team } = useLocalSearchParams<{ team?: string }>();
  const { data: ownTeams = [] } = useTeams();
  const teamId =
    (team && ownTeams.some((tm) => tm.id === team) ? team : null) ??
    ownTeams[0]?.id ??
    null;
  const teamName = useTeamName();
  const teamRaw = ownTeams.find((tm) => tm.id === teamId)?.name;
  const teamTitle = teamRaw ? teamName(teamRaw) : undefined;
  // «ТОЛЬКО ВИДИТ» (права партнёра): ни кнопки внизу, ни свайпов, ни ручек,
  // строка не открывает редактор. Вне вкладки «Клиенты» (Кабинет, запись) —
  // правка.
  const readOnly = useClientSettingLevel("objects", teamId) !== "write";
  // ШАБЛОНЫ ИЗ ДРУГИХ КОМАНД (как у услуг). Только владелец.
  const isOwner = useDataRole().data === "owner";
  const labelsData = useLocationLabels(null).data;
  const allLabels = useMemo(() => labelsData ?? [], [labelsData]);
  const typeTemplates = useMemo(
    () =>
      isOwner
        ? otherTeamTemplates(allLabels, {
            teamId,
            teamOf: (x) => x.teamId,
            nameOf: (x) => x.name,
          }).map((x) => ({
            key: x.id,
            name: x.name,
            color: x.color ?? null,
            icon: x.icon ?? null,
            sub: teamName(ownTeams.find((tm) => tm.id === x.teamId)?.name),
            value: x,
          }))
        : [],
    [isOwner, allLabels, teamId, ownTeams, teamName],
  );
  const {
    data: labels = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useLocationLabels(teamId);
  const save = useSaveLocationLabels(teamId);
  const { data: clients = [] } = useClients();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dragging, setDragging] = useState(false);

  // Сколько объектов уже носят это имя — чтобы вопрос об удалении говорил
  // правду, а не пугал вообще.
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const client of clients) {
      for (const loc of client.locations ?? []) {
        const name = (loc.label ?? "").trim();
        if (!name) continue;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return counts;
  }, [clients]);

  const write = async (next: LocationLabel[], failure: string) => {
    try {
      await save.mutateAsync(next);
      return true;
    } catch (e) {
      notify(failure, e instanceof Error ? e.message : "Повторите попытку.");
      return false;
    }
  };

  const duplicate = (name: string, exceptId?: string) =>
    labels.some(
      (label) =>
        label.id !== exceptId &&
        label.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );

  const submit = async (draft: TypeDraft) => {
    const value = draft.name.trim();
    if (!value || !editing) return;
    const exceptId = editing.mode === "edit" ? editing.label.id : undefined;
    if (duplicate(value, exceptId)) {
      notify("Такой тип уже есть", "Введите другое название.");
      return;
    }
    const next =
      editing.mode === "edit"
        ? labels.map((label) =>
            label.id === exceptId
              ? { ...label, name: value, color: draft.color, icon: draft.icon }
              : label,
          )
        : [
            ...labels,
            {
              id: generateLocationLabelId(),
              name: value,
              color: draft.color,
              icon: draft.icon,
            },
          ];
    const ok = await write(
      next,
      editing.mode === "edit"
        ? "Не удалось переименовать тип"
        : "Не удалось сохранить тип",
    );
    if (ok) setEditing(null);
  };

  const remove = (label: LocationLabel) => {
    const used = usage.get(label.name.trim()) ?? 0;
    confirmThen(
      "Удалить тип объекта?",
      {
        message: used
          ? // Объект показывает тип по справочнику: без строки в нём тип у
            // объекта пропадает (домик без слова) — говорим правду.
            `«${label.name}» исчезнет из выбора, а объекты этого типа (${used}) останутся без типа.`
          : `«${label.name}» исчезнет из выбора.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      async () => {
        const ok = await write(
          labels.filter((item) => item.id !== label.id),
          "Не удалось удалить тип",
        );
        if (ok) toast("Тип удалён");
      },
    );
  };

  const reorder = (ids: string[]) => {
    const byId = new Map(labels.map((label) => [label.id, label]));
    const next = ids
      .map((id) => byId.get(id))
      .filter((label): label is LocationLabel => label != null);
    if (next.length !== labels.length) return;
    void write(next, "Не удалось изменить порядок");
  };

  return (
    <Screen edges={["top"]}>
      {/* Имя команды — тем же правилом показа, что везде: команда, названная
          почтой, читается «Babun», а не адресом. */}
      <ScreenHeader title="Типы объектов" subtitle={teamTitle} />

      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : isError ? (
        <EmptyState
          state="error"
          fill
          subtitle={error instanceof Error ? error.message : undefined}
          action={{ label: "Повторить", onPress: () => void refetch() }}
        />
      ) : labels.length === 0 ? (
        // ГОТОВОГО НАБОРА НЕТ: каждый человек сам создаёт свой тип объекта.
        // Пустое состояние — только слова: «Добавить тип» стоит внизу, там же,
        // где у полного списка.
        <EmptyState fill title="Типов пока нет" />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 12 }}
          scrollEnabled={!dragging}
        >
          <View style={{ paddingHorizontal: 16 }}>
            <ReorderList
              items={labels}
              rowHeight={ROW_H}
              spaced
              labelFor={(label) => label.name}
              rangeFor={(index) => (readOnly ? [index, index] : [0, labels.length - 1])}
              // Ручка внутри строки: строка ещё и смахивается влево, а колонка
              // ручки снаружи не уезжает — «Удалить» упиралось бы в неё.
              handleInside
              onReorder={reorder}
              onDraggingChange={setDragging}
            >
              {(label, _index, handle) => (
                <SwipeRow
                  label={readOnly ? undefined : "Удалить"}
                  color={t.danger}
                  icon={Trash2}
                  accessibilityLabel={`Удалить тип ${label.name}`}
                  onAction={readOnly ? undefined : () => remove(label)}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: appearanceRowFill(label.color, false, {
                        rest: t.surface,
                        pressed: t.pressed,
                      }),
                    }}
                  >
                    <Pressable
                      disabled={readOnly}
                      onPress={() => setEditing({ mode: "edit", label })}
                      accessibilityRole={readOnly ? "text" : "button"}
                      accessibilityLabel={readOnly ? `Тип ${label.name}` : `Тип ${label.name}, переименовать`}
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
                      {/* ПЛИТКА ВИДА — как у типа события и категории: тип
                          объекта узнаётся в списке тем же способом, что и
                          соседний справочник в том же кабинете. */}
                      <AppearanceTile
                        color={label.color}
                        icon={label.icon}
                        // Без своего значка — тот же ярлык, что в выборе типа и
                        // в строке объекта: тип выглядит одинаково везде.
                        fallback={Tag}
                        size={28}
                      />
                      <Text
                        numberOfLines={1}
                        maxFontSizeMultiplier={1.3}
                        style={{ fontSize: 16, color: t.ink }}
                      >
                        {label.name}
                      </Text>
                    </Pressable>
                    {/* Ручка — СНАРУЖИ нажимаемой области: вложенная внутрь,
                        она отдавала бы короткий тап строке и открывала правку
                        вместо перетаскивания. */}
                    {handle}
                  </View>
                </SwipeRow>
              )}
            </ReorderList>
          </View>
        </ScrollView>
      )}

      {/* ГЛАВНОЕ ДЕЙСТВИЕ ЭКРАНА — ВНИЗУ И ВСЕГДА: пуст список или полон,
          кнопка на одном месте (AGENTS 7.1). Типы заводят пачкой, и после
          первого не должно приходиться доскролливать список ради второго. */}
      {!readOnly ? (
        <PageFooter>
          <GradientButton
            label="Добавить тип"
            onPress={() => setEditing({ mode: "create" })}
          />
        </PageFooter>
      ) : null}

      <TypeSheet
        editing={editing}
        busy={save.isPending}
        onClose={() => setEditing(null)}
        onSubmit={submit}
        templates={typeTemplates}
      />
    </Screen>
  );
}

export default ObjectTypesScreen;
