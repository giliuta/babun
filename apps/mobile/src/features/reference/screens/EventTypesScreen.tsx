import { Pressable, ScrollView, Text, View } from "react-native";
import { EyeOff, RotateCcw, Trash2 } from "lucide-react-native";
import {
  AppearanceTile,
  appearanceRowFill,
} from "@/components/ui/AppearanceSheet";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { ReorderList } from "@/components/ui/ReorderList";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { GUTTER } from "@/components/ui/tokens";
import { eventTypeIconPresets } from "@/features/calendar/event-type-icons";
import { durationLabel } from "@/features/services/format";
import { useThemeColors } from "@/theme/colors";
import { EventTypeSheet } from "./EventTypeSheet";
import { useEventTypesEditor } from "./use-event-types-editor";

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

export function EventTypesScreen() {
  const t = useThemeColors();
  const {
    typesQuery,
    types,
    save,
    editing,
    setEditing,
    submit,
    toggleHidden,
    remove,
    reorder,
    dragging,
    setDragging,
  } = useEventTypesEditor();

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
                      backgroundColor: appearanceRowFill(type.color, false, {
                        rest: t.surface,
                        pressed: t.pressed,
                      }),
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
                        // Заливку держит вся строка (см. выше); здесь
                        // остаётся только отклик на палец.
                        backgroundColor: pressed ? t.pressed : "transparent",
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

/** Вид типа: цвет и значок — те же, что стоят в форме события. КВАДРАТ, а не
 *  кружок (владелец 2026-09-10: «выбор цвета квадратика, не круг… везде одно и
 *  то же»): это тот же `AppearanceTile`, что у тега, метки, услуги, категории и
 *  типа объекта. Свой набор значков у типа события остался — старые слаги
 *  живут картой совместимости, — поэтому набор передаётся плитке. */
export function TypeMark({ color, icon }: { color: string; icon: string }) {
  return (
    <AppearanceTile
      color={color}
      icon={icon}
      icons={eventTypeIconPresets(icon)}
      size={30}
    />
  );
}

export default EventTypesScreen;
