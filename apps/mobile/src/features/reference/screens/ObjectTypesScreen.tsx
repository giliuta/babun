import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Trash2 } from "lucide-react-native";
import {
  generateLocationLabelId,
  HOME_SERVICE_LABELS_PRESET,
  type LocationLabel,
} from "@babun/shared/local/location-labels";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { GradientButton } from "@/components/ui/GradientButton";
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

// ТИПЫ ОБЪЕКТОВ — СПРАВОЧНИК ПО ОБЩЕМУ КАНОНУ (владелец 2026-09-04:
// «наблюдай нашу архитектуру — то же самое сделаем, как в услугах или как в
// метках, полноценно»). До этого экран жил в старой вёрстке: плоский список с
// красной корзиной в каждой строке и «слайд-модалкой» вместо листа — тот самый
// долг, записанный в DS («ОДИН ДИЗАЙН НА ВСЕ СПИСКИ», LOCKED 2026-08-02:
// «метки/типы объектов/теги ещё в старой вёрстке»).
//
// Теперь ровно то же, что у меток и услуг:
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

type Editing = { mode: "create" } | { mode: "edit"; label: LocationLabel };

export function ObjectTypesScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const {
    data: labels = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useLocationLabels();
  const save = useSaveLocationLabels();
  const { data: clients = [] } = useClients();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dragging, setDragging] = useState(false);
  const [seeding, setSeeding] = useState(false);

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

  // СТАНДАРТНЫЙ НАБОР ЗАВОДИТСЯ САМ (владелец 2026-08-02: «типы объектов
  // должны быть уже добавлены — дом, квартира, офис, как теги»). Пресет
  // пишется ОДИН РАЗ и только в пустой справочник: дальше это обычные записи,
  // которые переименуют или удалят.
  const seedPreset = async () => {
    if (seeding || labels.length > 0) return;
    setSeeding(true);
    await write(HOME_SERVICE_LABELS_PRESET, "Не удалось добавить стандартные типы");
    setSeeding(false);
  };

  const duplicate = (name: string, exceptId?: string) =>
    labels.some(
      (label) =>
        label.id !== exceptId &&
        label.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );

  const submit = async (name: string) => {
    const value = name.trim();
    if (!value || !editing) return;
    const exceptId = editing.mode === "edit" ? editing.label.id : undefined;
    if (duplicate(value, exceptId)) {
      notify("Такой тип уже есть", "Введите другое название.");
      return;
    }
    const next =
      editing.mode === "edit"
        ? labels.map((label) =>
            label.id === exceptId ? { ...label, name: value } : label,
          )
        : [...labels, { id: generateLocationLabelId(), name: value }];
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
          ? `«${label.name}» исчезнет из выбора. Объекты, уже названные так (${used}), имя сохранят.`
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
      <ScreenHeader title="Типы объектов" />

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
        <EmptyState
          fill
          title="Типов пока нет"
          action={{
            label: seeding ? "Добавляем…" : "Добавить стандартные",
            onPress: () => void seedPreset(),
          }}
        />
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
              // Ручка внутри строки: строка ещё и смахивается влево, а колонка
              // ручки снаружи не уезжает — «Удалить» упиралось бы в неё.
              handleInside
              onReorder={reorder}
              onDraggingChange={setDragging}
            >
              {(label, _index, handle) => (
                <SwipeRow
                  label="Удалить"
                  color={t.danger}
                  icon={Trash2}
                  accessibilityLabel={`Удалить тип ${label.name}`}
                  onAction={() => remove(label)}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: t.surface,
                    }}
                  >
                    <Pressable
                      onPress={() => setEditing({ mode: "edit", label })}
                      accessibilityRole="button"
                      accessibilityLabel={`Тип ${label.name}, переименовать`}
                      style={({ pressed }) => ({
                        flex: 1,
                        height: ROW_H,
                        justifyContent: "center",
                        paddingLeft: 16,
                        backgroundColor: pressed ? t.pressed : t.surface,
                      })}
                    >
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

      {/* ГЛАВНОЕ ДЕЙСТВИЕ ЭКРАНА — ВНИЗУ И ВСЕГДА (LOCKED 2026-08-27): типы
          заводят пачкой, и после первого не должно приходиться доскролливать
          список ради второго. Тот же приём, что у меток и услуг. */}
      {!isLoading && !isError && labels.length > 0 ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 }}>
          <GradientButton
            label="Добавить тип"
            onPress={() => setEditing({ mode: "create" })}
          />
        </View>
      ) : null}

      <TypeSheet
        editing={editing}
        busy={save.isPending}
        onClose={() => setEditing(null)}
        onSubmit={submit}
      />
    </Screen>
  );
}

/** Правка типа — канонический `BottomSheet` с одним полем, как «Новая метка».
 *  Удаления здесь нет намеренно: оно живёт на кромке свайпа, а вопрос,
 *  заданный из листа, не показался бы вовсе (закон о двух окнах). */
function TypeSheet({
  editing,
  busy,
  onClose,
  onSubmit,
}: {
  editing: Editing | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const isEdit = editing?.mode === "edit";
  const [name, setName] = useState("");
  // Черновик берётся у той строки, которую открыли, и ровно один раз:
  // пока лист открыт, значением владеет поле.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const key = editing == null ? null : isEdit ? editing.label.id : "create";
  if (key !== seededFor) {
    setSeededFor(key);
    setName(editing?.mode === "edit" ? editing.label.name : "");
  }

  return (
    <BottomSheet
      visible={editing !== null}
      onClose={onClose}
      title={isEdit ? "Тип объекта" : "Новый тип"}
      avoidKeyboard
      footer={
        <Button
          label={isEdit ? "Сохранить" : "Создать"}
          onPress={() => onSubmit(name)}
          disabled={!name.trim() || busy}
          loading={busy}
        />
      }
    >
      <Field
        label="Название"
        value={name}
        onChangeText={setName}
        autoFocus
        autoCapitalize="sentences"
      />
    </BottomSheet>
  );
}

export default ObjectTypesScreen;
