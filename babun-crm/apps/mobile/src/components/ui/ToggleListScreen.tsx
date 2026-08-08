import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Check, GripVertical } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { RowCaption } from "@/features/clients/card-rows";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// СТРАНИЦА-НАБОР — «Способы связи», «Что можно добавить», «Карты для
// маршрута».
//
// ЗАКОН ВЛАДЕЛЬЦА 2026-08-02: НАСТРОЙКИ — ВСЕГДА ПОЛНОЦЕННАЯ СТРАНИЦА.
// Нижний лист остаётся для ДЕЙСТВИЯ на карточке («Добавить», «Как
// связаться»), а всё, что настраивают, открывается страницей.
//
// ПОРЯДОК ЗАДАЁТ ПОЛЬЗОВАТЕЛЬ (владелец 2026-08-02: «чтоб можно было менять
// их местами — перетаскивать; „Позвонить“ всегда первый»). Тянут за ручку из
// шести точек справа: перетаскивание за всю строку отобрало бы у неё
// обычный тап-переключатель. `locked` пункт закреплён сверху и ручки не
// имеет — двигать его некуда.
//
// Список короткий (4–6 строк) и фиксированной высоты, поэтому перетаскивание
// написано на Reanimated напрямую: тянуть в проект ещё одну библиотеку ради
// шести строк — не тот размен. Соседи расступаются на лету, поэтому видно,
// КУДА строка встанет, ещё до того, как палец отпущен.

const ROW_H = 56;

export interface ToggleListItem {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
  checked: boolean;
  /** Тап-переключатель игнорируется; подпись гаснет. Перетаскивание при этом
   *  остаётся: «последнюю карту нельзя выключить» — это не «нельзя двигать». */
  locked?: boolean;
  /** Закреплён сверху: не двигается вовсе («Позвонить»). */
  pinned?: boolean;
  /** Приписка, объясняющая замок: «всегда», «нужна хотя бы одна». */
  lockedNote?: string;
  onToggle: () => void;
}

/** Куда встанет строка `index`, пока тянут строку `active` к месту `target`. */
function shiftFor(index: number, active: number, target: number): number {
  "worklet";
  if (active < 0 || active === index) return 0;
  if (active < index && index <= target) return -1;
  if (active > index && index >= target) return 1;
  return 0;
}

function Row({
  item,
  index,
  count,
  minIndex,
  draggable,
  onDrop,
  active,
  target,
  onActiveChange,
}: {
  item: ToggleListItem;
  index: number;
  count: number;
  /** Первая позиция, куда можно встать: ниже закреплённых пунктов. */
  minIndex: number;
  draggable: boolean;
  onDrop: (from: number, to: number) => void;
  active: SharedValue<number>;
  target: SharedValue<number>;
  onActiveChange: (dragging: boolean) => void;
}) {
  const t = useThemeColors();
  const dy = useSharedValue(0);

  const pan = Gesture.Pan()
    .activateAfterLongPress(120)
    .onStart(() => {
      active.value = index;
      target.value = index;
      runOnJS(onActiveChange)(true);
      runOnJS(bump)();
    })
    .onChange((e) => {
      dy.value = e.translationY;
      const to = Math.round(e.translationY / ROW_H) + index;
      target.value = Math.min(Math.max(to, minIndex), count - 1);
    })
    .onEnd(() => {
      const to = target.value;
      if (to !== index) runOnJS(onDrop)(index, to);
    })
    .onFinalize(() => {
      dy.value = 0;
      active.value = -1;
      target.value = -1;
      runOnJS(onActiveChange)(false);
    });

  const style = useAnimatedStyle(() => {
    const dragging = active.value === index;
    if (dragging) {
      return {
        transform: [{ translateY: dy.value }, { scale: 1.02 }],
        zIndex: 10,
        backgroundColor: t.surface,
      };
    }
    return {
      transform: [
        {
          translateY: withTiming(
            shiftFor(index, active.value, target.value) * ROW_H,
            { duration: 140 },
          ),
        },
        { scale: 1 },
      ],
      zIndex: 0,
      backgroundColor: "transparent",
    };
  });

  return (
    <Animated.View
      style={[
        style,
        {
          flexDirection: "row",
          alignItems: "center",
          height: ROW_H,
          paddingRight: 8,
          borderTopWidth: index > 0 ? 1 : 0,
          borderTopColor: t.separator,
        },
      ]}
    >
      {/* Ручка живёт СНАРУЖИ нажимаемой области: вложенная внутрь, она
          отдавала короткий тап строке — палец «поправил порядок», а пункт
          молча выключался. */}
      <Pressable
        onPress={() => {
          if (item.locked) return;
          haptics.tap();
          item.onToggle();
        }}
        disabled={item.locked}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.checked, disabled: !!item.locked }}
        accessibilityLabel={item.label}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          height: ROW_H,
          paddingLeft: 16,
          backgroundColor: pressed ? t.pressed : "transparent",
        })}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${item.color}1a`,
          }}
        >
          <item.icon color={item.color} size={16} strokeWidth={2.2} />
        </View>
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={{
            flex: 1,
            fontSize: 15,
            fontWeight: "600",
            color: item.locked ? t.faint : t.ink,
          }}
        >
          {item.label}
          {item.locked && item.lockedNote ? ` · ${item.lockedNote}` : ""}
        </Text>
        {item.checked ? (
          <Check color={t.accent} size={18} strokeWidth={2.6} />
        ) : null}
      </Pressable>

      {draggable ? (
        <GestureDetector gesture={pan}>
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={`Переместить: ${item.label}`}
            accessibilityHint="Удерживайте и тяните, чтобы изменить порядок"
            style={{
              width: 40,
              height: ROW_H,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <GripVertical color={t.chevron} size={18} strokeWidth={2} />
          </View>
        </GestureDetector>
      ) : (
        <View style={{ width: 8 }} />
      )}
    </Animated.View>
  );
}

/** Отдельная функция: в worklet нельзя ссылаться на метод объекта. */
function bump(): void {
  haptics.impact();
}

export interface ToggleListSection {
  /** Капс-заголовок над карточкой. Одна секция — можно без него. */
  title?: string;
  items: ToggleListItem[];
  /** Тихая подпись под карточкой. */
  footer?: string;
  /** Новый порядок id. Не задан — секция не перетаскивается. */
  onReorder?: (ids: string[]) => void;
}

/** Секция со своим перетаскиванием: у каждого набора свой порядок. */
function Section({
  section,
  onDraggingChange,
}: {
  section: ToggleListSection;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const active = useSharedValue(-1);
  const target = useSharedValue(-1);
  const { items, onReorder } = section;

  const drop = useCallback(
    (from: number, to: number) => {
      if (!onReorder) return;
      const ids = items.map((i) => i.id);
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      haptics.success();
      onReorder(ids);
    },
    [items, onReorder],
  );

  return (
    <>
      {section.title ? <SectionEyebrow>{section.title}</SectionEyebrow> : null}
      <SectionCard>
        {items.map((item, index) => (
          <Row
            key={item.id}
            item={item}
            index={index}
            count={items.length}
            // Двигать нельзя только закреплённое сверху.
            draggable={!!onReorder && !item.pinned}
            minIndex={items.findIndex((i) => !i.pinned)}
            onDrop={drop}
            active={active}
            target={target}
            onActiveChange={onDraggingChange}
          />
        ))}
      </SectionCard>
      {section.footer ? <RowCaption text={section.footer} /> : null}
    </>
  );
}

export function ToggleListScreen({
  title,
  hint,
  sections,
}: {
  title: string;
  /** Подпись под заголовком: зачем этот набор. */
  hint?: string;
  sections: ToggleListSection[];
}) {
  // Пока строку тянут, список не должен уезжать под пальцем.
  const [dragging, setDragging] = useState(false);
  const anyDraggable = sections.some((s) => !!s.onReorder);

  return (
    <Screen>
      <ScreenHeader title={title} subtitle={hint} />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        scrollEnabled={!dragging}
      >
        {sections.map((section, i) => (
          <Section
            key={section.title ?? `section-${i}`}
            section={section}
            onDraggingChange={setDragging}
          />
        ))}
        {anyDraggable ? (
          <RowCaption text="Порядок задаёте вы: тяните строку за ручку справа." />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default ToggleListScreen;
