import { useCallback, type ReactNode } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { GripVertical } from "lucide-react-native";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

/** Зазор между отдельно стоящими строками. */
const SPACED_GAP = 8;

// ПЕРЕТАСКИВАНИЕ СТРОК — ОДНА РЕАЛИЗАЦИЯ НА ПРОДУКТ.
//
// Жила внутри `ToggleListScreen` («Способы связи», «Карты для маршрута») и
// умела двигать только строки-переключатели. «Порядок счетов» — тот же жест
// над другими строками, поэтому механика вынесена сюда, а содержимое строки
// каждый экран рисует своё. Второй копии drag-кода в продукте быть не должно.
//
// Тянут за РУЧКУ из шести точек справа, а не за всю строку: строка сама по
// себе кликается (переключатель, дверь в настройки счёта), и перетаскивание
// за неё отобрало бы у неё обычный тап. Ручка живёт СНАРУЖИ нажимаемой
// области содержимого — вложенная внутрь, она отдавала короткий тап строке.
//
// Списки короткие (4–8 строк) и фиксированной высоты, поэтому drag написан на
// Reanimated напрямую: тянуть в проект ещё одну библиотеку ради восьми строк —
// не тот размен. Соседи расступаются на лету, поэтому видно, КУДА строка
// встанет, ещё до того, как палец отпущен.

/** Куда встанет строка `index`, пока тянут строку `active` к месту `target`. */
function shiftFor(index: number, active: number, target: number): number {
  "worklet";
  if (active < 0 || active === index) return 0;
  if (active < index && index <= target) return -1;
  if (active > index && index >= target) return 1;
  return 0;
}

/** Отдельная функция: в worklet нельзя ссылаться на метод объекта. */
function bump(): void {
  haptics.impact();
}

export interface ReorderRow {
  id: string;
}

function Row({
  index,
  rowHeight,
  min,
  max,
  label,
  handleInside,
  spaced,
  onDrop,
  active,
  target,
  onActiveChange,
  children,
}: {
  index: number;
  rowHeight: number;
  /** Первое и последнее место, куда этой строке разрешено встать. */
  min: number;
  max: number;
  /** Озвучка ручки: «Переместить: Наличные». */
  label: string;
  /** Ручку рисует САМА СТРОКА (её отдают вторым аргументом). Нужно там, где
   *  строка ещё и смахивается: колонка ручки снаружи не уезжает вместе с
   *  содержимым, и кнопка «Удалить» упирается в неё, не доходя до края
   *  карточки. Внутри строки ручка уезжает вместе со всем остальным. */
  handleInside?: boolean;
  spaced?: boolean;
  onDrop: (from: number, to: number) => void;
  active: SharedValue<number>;
  target: SharedValue<number>;
  onActiveChange: (dragging: boolean) => void;
  children: (handle: ReactNode) => ReactNode;
}) {
  const t = useThemeColors();
  const dy = useSharedValue(0);
  // Двигать некуда — ручки нет. Строка, у которой единственное допустимое
  // место — её собственное, не должна предлагать жест, который ничего не
  // меняет: палец тянет, а строка возвращается на место без объяснений.
  const draggable = max > min;

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
      const to = Math.round(e.translationY / rowHeight) + index;
      target.value = Math.min(Math.max(to, min), max);
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
            shiftFor(index, active.value, target.value) * rowHeight,
            { duration: 140 },
          ),
        },
        { scale: 1 },
      ],
      zIndex: 0,
      backgroundColor: "transparent",
    };
  });

  const handle = draggable ? (
    <GestureDetector gesture={pan}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`Переместить: ${label}`}
        accessibilityHint="Удерживайте и тяните, чтобы изменить порядок"
        style={{
          width: 40,
          height: rowHeight,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <GripVertical color={t.chevron} size={18} strokeWidth={2} />
      </View>
    </GestureDetector>
  ) : (
    <View style={{ width: 8 }} />
  );

  return (
    <Animated.View
      style={[
        style,
        {
          flexDirection: "row",
          alignItems: "center",
          height: rowHeight,
          paddingRight: handleInside ? 0 : 8,
          // РАЗДЕЛЁННЫЕ СТРОКИ ВМЕСТО ВОЛОСИНЫ (владелец 2026-08-22: «разделение
          // не волосины между услугами… сделай именно чтобы каждая своя
          // строка, на хера ты вот это всё в одну группировку»). В режиме
          // `spaced` строка сама себе поверхность: свой фон, свой радиус, свой
          // зазор до соседа — и шва между ними не нужно вовсе.
          ...(spaced
            ? {
                marginTop: index > 0 ? SPACED_GAP : 0,
                borderRadius: t.radius.card,
                borderCurve: "continuous" as const,
                overflow: "hidden" as const,
                backgroundColor: t.surface,
              }
            : {
                borderTopWidth: index > 0 ? 1 : 0,
                borderTopColor: t.separator,
              }),
        },
      ]}
    >
      <View style={{ flex: 1 }}>{children(handleInside ? handle : null)}</View>
      {handleInside ? null : handle}
    </Animated.View>
  );
}

/**
 * Список с перетаскиванием строк. Содержимое строки рисует вызывающий экран,
 * порядок и жест держит примитив.
 *
 * `rangeFor` ограничивает, куда строке разрешено встать: закреплённый сверху
 * пункт («Позвонить» всегда первый) и счёт, который не имеет права уехать за
 * пределы своего вида, — это одно и то же правило, только с разными
 * границами.
 */
export function ReorderList<T extends ReorderRow>({
  items,
  rowHeight = 56,
  rangeFor,
  spaced,
  labelFor,
  handleInside,
  onReorder,
  onDraggingChange,
  children,
}: {
  items: readonly T[];
  /** Высота строки: от неё считается, через сколько соседей перелетел палец. */
  rowHeight?: number;
  /** Границы допустимых мест для строки `index`, включительно. По умолчанию —
   *  весь список. */
  rangeFor?: (index: number) => readonly [number, number];
  /** Каждая строка — своя поверхность с зазором, а не полоса в общей карточке. */
  spaced?: boolean;
  /** Как назвать строку в озвучке ручки. */
  labelFor: (item: T) => string;
  /** Новый порядок id — целиком, в том порядке, в каком строки теперь стоят. */
  onReorder: (ids: string[]) => void;
  /** Ручку рисует сама строка — третьим аргументом `children`. Ставится там,
   *  где строка ещё и смахивается влево. */
  handleInside?: boolean;
  /** Пока строку тянут, родительская прокрутка обязана стоять. */
  onDraggingChange?: (dragging: boolean) => void;
  children: (item: T, index: number, handle: ReactNode) => ReactNode;
}) {
  const active = useSharedValue(-1);
  const target = useSharedValue(-1);

  const drop = useCallback(
    (from: number, to: number) => {
      const ids = items.map((item) => item.id);
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      haptics.success();
      onReorder(ids);
    },
    [items, onReorder],
  );

  const dragging = useCallback(
    (value: boolean) => onDraggingChange?.(value),
    [onDraggingChange],
  );

  return (
    <>
      {items.map((item, index) => {
        const [min, max] = rangeFor?.(index) ?? [0, items.length - 1];
        return (
          <Row
            key={item.id}
            index={index}
            rowHeight={rowHeight}
            min={min}
            max={max}
            label={labelFor(item)}
            handleInside={handleInside}
            spaced={spaced}
            onDrop={drop}
            active={active}
            target={target}
            onActiveChange={dragging}
          >
            {(handle) => children(item, index, handle)}
          </Row>
        );
      })}
    </>
  );
}
