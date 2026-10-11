import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { haptics } from "@/lib/haptics";
import { dropIndex, shiftOf } from "./chip-drag-math";

export { CHIP_GAP } from "./chip-drag-math";

// ПЕРЕТАСКИВАНИЕ ЧИПОВ ЛЕНТЫ (владелец 11.10: «зайти в настройки, зажать на
// календарик и перетащить в том порядке, который нужен… у каждого по-своему»).
// Зажал ~0.35 с — чип приподнимается и едет за пальцем, соседи расступаются на
// ширину чипа; отпустил — новый порядок уходит наверх (`onReorder`). Пока
// пальца не держат, ничего не меняется: тап выбирает, свайп листает ленту.
//
// Чипы разной ширины, поэтому место считается по центрам, а не по шагу:
// новое место = сколько соседей стоят центром левее центра чипа под пальцем.

/** Отдельные функции: в worklet нельзя ссылаться на метод объекта. */
function tick(): void {
  haptics.tap();
}

export interface ChipDrag {
  active: SharedValue<number>;
  target: SharedValue<number>;
  dx: SharedValue<number>;
  boxes: SharedValue<{ x: number; w: number }[]>;
  /** Замер чипа `index` (onLayout). */
  measure: (index: number, x: number, w: number) => void;
  drop: (from: number, to: number) => void;
}

export function useChipDrag(
  ids: readonly string[],
  onReorder: (ids: string[]) => void,
  onDragging: (dragging: boolean) => void,
): ChipDrag {
  const active = useSharedValue(-1);
  const target = useSharedValue(-1);
  const dx = useSharedValue(0);
  const boxes = useSharedValue<{ x: number; w: number }[]>([]);
  const local = useRef<{ x: number; w: number }[]>([]);

  const key = ids.join("|");
  // Новый порядок нарисован — жест сбрасывается одной записью на UI-потоке.
  const reset = useCallback(() => {
    runOnUI(() => {
      "worklet";
      active.value = -1;
      target.value = -1;
      dx.value = 0;
    })();
  }, [active, target, dx]);
  useLayoutEffect(() => {
    reset();
  }, [key, reset]);

  const measure = (index: number, x: number, w: number) => {
    local.current[index] = { x, w };
    local.current.length = ids.length;
    boxes.value = local.current.slice();
  };

  const keyRef = useRef(key);
  keyRef.current = key;
  const drop = (from: number, to: number) => {
    onDragging(false);
    if (from === to || from < 0) {
      reset();
      return;
    }
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    haptics.success();
    const before = keyRef.current;
    onReorder(next);
    // Порядок не принят (ошибка) — картинка возвращается сама.
    setTimeout(() => {
      if (keyRef.current === before) reset();
    }, 700);
  };

  return { active, target, dx, boxes, measure, drop };
}

/** Один чип ленты, который можно перетащить. */
export function DraggableChip({
  index,
  drag,
  onDragging,
  onMeasured,
  children,
}: {
  index: number;
  drag: ChipDrag;
  onDragging: (dragging: boolean) => void;
  /** Левый край чипа в координатах ленты — для подводки к выбранному. */
  onMeasured?: (x: number) => void;
  children: ReactNode;
}) {
  const { active, target, dx, boxes } = drag;
  const drop = drag.drop;
  const startDrag = () => {
    haptics.impact();
    onDragging(true);
  };
  const pan = Gesture.Pan()
    .activateAfterLongPress(350)
    .onStart(() => {
      active.value = index;
      target.value = index;
      dx.value = 0;
      runOnJS(startDrag)();
    })
    .onUpdate((e) => {
      dx.value = e.translationX;
      const box = boxes.value[index];
      if (!box) return;
      const next = dropIndex(boxes.value, index, box.x + box.w / 2 + e.translationX);
      if (next !== target.value) runOnJS(tick)();
      target.value = next;
    })
    .onFinalize(() => {
      if (active.value !== index) return;
      runOnJS(drop)(index, target.value);
    });

  const style = useAnimatedStyle(() => {
    if (active.value === index) {
      return {
        zIndex: 10,
        transform: [{ translateX: dx.value }, { scale: withTiming(1.06, { duration: 120 }) }],
        opacity: 0.95,
      };
    }
    const width = boxes.value[active.value]?.w ?? 0;
    return {
      zIndex: 0,
      transform: [
        { translateX: withTiming(shiftOf(index, active.value, target.value, width), { duration: 160 }) },
        { scale: 1 },
      ],
      opacity: 1,
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={style}
        onLayout={(e) => {
          drag.measure(index, e.nativeEvent.layout.x, e.nativeEvent.layout.width);
          onMeasured?.(e.nativeEvent.layout.x);
        }}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
