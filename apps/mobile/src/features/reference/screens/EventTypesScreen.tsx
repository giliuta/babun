import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { EyeOff, RotateCcw, Trash2 } from "lucide-react-native";
import {
  generatePersonalEventTypeId,
  type PersonalEventType,
} from "@babun/shared/local/personal-event-types";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { ReorderList } from "@/components/ui/ReorderList";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { eventTypeIcon } from "@/features/calendar/event-type-icons";
import { durationLabel } from "@/features/services/format";
import {
  usePersonalEventTypes,
  useSavePersonalEventTypes,
} from "@/features/settings/local-settings";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { EventTypeSheet, type EventTypeDraft } from "./EventTypeSheet";

// ТИПЫ СОБЫТИЙ — СПРАВОЧНИК ПО ОБЩЕМУ КАНОНУ (владелец 2026-09-08: «в
// настройках событий надо сделать то же самое, как сделано в услугах или как
// в метках; архитектуру мы сохраняем, при этом свайп вправо — удалить, влево
// — скрыть»).
//
// До этого экран жил в старой вёрстке — тот же долг, что был у типов объектов:
// плоский список, красная корзина в каждой строке, «слайд-модалка» вместо
// листа, и ЗАВЕДЕНИЕ БЕЗ ПРАВКИ: заведённый тип нельзя было ни переименовать,
// ни перекрасить, ни переставить. Теперь ровно то же, что у меток и услуг:
//   • строка — своя карточка с ручкой перетаскивания, порядок задаёт человек;
//   • тап по строке — правка листом снизу, все поля типа сразу;
//   • смахнуть влево (правая кромка) — «Удалить», с подтверждением;
//   • смахнуть вправо (левая кромка) — «Скрыть» / «Показать»;
//   • «Добавить тип» — кнопка внизу и всегда.
//
// СКРЫТЫЙ ТИП ОСТАЁТСЯ НА ЭКРАНЕ серой строкой: он перестаёт предлагаться в
// форме события, но помнит своё имя, цвет и длительность. Удалённый уходит
// совсем — у него своя колонка `deleted_at` (миграция 20260908120000).

/** Высота строки: по ней перетаскивание считает, через сколько соседей
 *  перелетел палец. Та же, что у меток. */
const ROW_H = 60;

type Editing = { mode: "create" } | { mode: "edit"; type: PersonalEventType };

export function EventTypesScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const typesQuery = usePersonalEventTypes();
  const save = useSavePersonalEventTypes();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dragging, setDragging] = useState(false);

  // Живые сверху, скрытые под ними — тем же порядком, что у меток и услуг.
  const types = useMemo(() => {
    const all = typesQuery.data ?? [];
    return [...all.filter((x) => !x.hidden), ...all.filter((x) => x.hidden)];
  }, [typesQuery.data]);

  const write = (
    next: PersonalEventType[],
    failure: string,
    done?: () => void,
    removeIds?: string[],
  ) => {
    save.mutate(
      { types: next.map((type, i) => ({ ...type, order: i })), removeIds },
      {
        onSuccess: () => done?.(),
        onError: (e) => notify(failure, e.message),
      },
    );
  };

  const submit = (draft: EventTypeDraft) => {
    const value = draft.label.trim();
    if (!value) return;
    const exceptId = editing?.mode === "edit" ? editing.type.id : undefined;
    const clash = types.some(
      (type) =>
        type.id !== exceptId &&
        type.label.trim().toLowerCase() === value.toLowerCase(),
    );
    if (clash) {
      notify("Такой тип уже есть", "Введите другое название.");
      return;
    }
    const patch = {
      label: value,
      icon: draft.icon,
      color: draft.color,
      allDay: draft.allDay,
      defaultDuration: draft.allDay ? 720 : draft.duration,
    };
    const next =
      editing?.mode === "edit"
        ? types.map((type) =>
            type.id === exceptId ? { ...type, ...patch } : type,
          )
        : [
            ...types,
            {
              id: generatePersonalEventTypeId(),
              order: types.length,
              hidden: false,
              ...patch,
            },
          ];
    write(
      next,
      editing?.mode === "edit" ? "Не удалось сохранить тип" : "Не удалось завести тип",
      () => setEditing(null),
    );
  };

  const toggleHidden = (type: PersonalEventType) =>
    write(
      types.map((x) => (x.id === type.id ? { ...x, hidden: !x.hidden } : x)),
      type.hidden ? "Не удалось показать тип" : "Не удалось скрыть тип",
      () => toast(type.hidden ? "Тип показан" : "Тип скрыт"),
    );

  const remove = (type: PersonalEventType) => {
    if (save.isPending) return;
    confirmThen(
      "Удалить тип события?",
      {
        // ПРАВДА, А НЕ ПУГАЛКА: событие держит имя и цвет типа своим снимком,
        // как запись держит имя услуги. Уже заведённые события целы.
        message: `«${type.label}» исчезнет из выбора. События, уже названные так, имя и цвет сохранят.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      () =>
        write(
          types.filter((x) => x.id !== type.id),
          "Не удалось удалить тип",
          () => toast("Тип удалён"),
          [type.id],
        ),
    );
  };

  const reorder = (ids: string[]) => {
    const byId = new Map(types.map((type) => [type.id, type]));
    const next = ids
      .map((id) => byId.get(id))
      .filter((type): type is PersonalEventType => type != null);
    if (next.length !== types.length) return;
    write(next, "Не удалось изменить порядок");
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Типы событий" />

      {typesQuery.isLoading ? (
        <EmptyState state="loading" fill />
      ) : typesQuery.isError ? (
        <EmptyState
          state="error"
          fill
          subtitle={
            typesQuery.error instanceof Error ? typesQuery.error.message : undefined
          }
          action={{ label: "Повторить", onPress: () => void typesQuery.refetch() }}
        />
      ) : types.length === 0 ? (
        <EmptyState
          fill
          title="Типов событий пока нет"
          subtitle="Тип называет событие, красит его в календаре и подсказывает длительность."
          action={{ label: "Добавить тип", onPress: () => setEditing({ mode: "create" }) }}
        />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 12 }}
          scrollEnabled={!dragging}
        >
          <View style={{ marginHorizontal: GUTTER }}>
            <ReorderList
              items={types}
              rowHeight={ROW_H}
              spaced
              labelFor={(type) => type.label}
              handleInside
              onReorder={reorder}
              onDraggingChange={setDragging}
            >
              {(type, _index, handle) => (
                <SwipeRow
                  label="Удалить"
                  color={t.danger}
                  icon={Trash2}
                  accessibilityLabel={`Удалить тип ${type.label}`}
                  onAction={() => remove(type)}
                  leading={{
                    label: type.hidden ? "Показать" : "Скрыть",
                    color: type.hidden ? t.success : t.warning,
                    icon: type.hidden ? RotateCcw : EyeOff,
                    accessibilityLabel: type.hidden
                      ? `Показать тип ${type.label}`
                      : `Скрыть тип ${type.label}`,
                    onAction: () => toggleHidden(type),
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      // Скрытый не исчезает и не кричит — просто тише живых.
                      opacity: type.hidden ? 0.45 : 1,
                      backgroundColor: t.surface,
                    }}
                  >
                    <Pressable
                      onPress={() => setEditing({ mode: "edit", type })}
                      accessibilityRole="button"
                      accessibilityLabel={`Тип ${type.label}, редактировать`}
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
                      <TypeMark color={type.color} icon={type.icon} />
                      <View style={{ flex: 1 }}>
                        <Text
                          numberOfLines={1}
                          maxFontSizeMultiplier={1.3}
                          style={{ fontSize: 16, color: t.ink }}
                        >
                          {type.label}
                        </Text>
                        <Text
                          numberOfLines={1}
                          maxFontSizeMultiplier={1.3}
                          style={{ fontSize: 13, color: t.sub, marginTop: 1 }}
                        >
                          {type.allDay
                            ? "Весь день"
                            : durationLabel(type.defaultDuration)}
                          {type.hidden ? " · скрыт" : ""}
                        </Text>
                      </View>
                    </Pressable>
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
      {!typesQuery.isLoading && !typesQuery.isError && types.length > 0 ? (
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 16 }}>
          <GradientButton
            label="Добавить тип"
            onPress={() => setEditing({ mode: "create" })}
          />
        </View>
      ) : null}

      <EventTypeSheet
        visible={editing !== null}
        type={editing?.mode === "edit" ? editing.type : null}
        busy={save.isPending}
        onClose={() => setEditing(null)}
        onSubmit={submit}
      />
    </Screen>
  );
}

/** Кружок типа: цвет и значок — те же, что стоят в ленте формы события. */
function TypeMark({ color, icon }: { color: string; icon: string }) {
  const Icon = eventTypeIcon(icon);
  return (
    <View
      style={{
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: color,
      }}
    >
      <Icon color="#fff" size={16} strokeWidth={2.2} />
    </View>
  );
}

export default EventTypesScreen;
