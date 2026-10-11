import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { haptics } from "@/lib/haptics";
import { CHIP_GAP, dropIndex, slotX } from "./chip-drag-math";

export { CHIP_GAP } from "./chip-drag-math";

// ПЕРЕТАСКИВАНИЕ ЧИПОВ ЛЕНТЫ (владелец 11.10: «зажать на календарик и
// перетащить в том порядке, который нужен… у каждого по-своему»).
//
// МЕСТО ЧИПА СЧИТАЕТ ПОТОК АНИМАЦИИ, А НЕ РАСКЛАДКА (владелец 11.10: «меняю
// местами, отпускаю — оно подпрыгивает и как будто лагает»). Первая версия
// стояла обычным рядом и двигала чипы сдвигами: на отпускании React
// перерисовывал ряд в новом порядке, а сдвиги снимались кадром позже — чип на
// кадр получал двойной сдвиг и прыгал. Теперь каждый чип стоит абсолютно, его
// x — функция порядка (`order`) и ширин на потоке UI; новый порядок пишется
// туда в миг отпускания, а перерисовка React раскладку не трогает вовсе.
// Отпущенный чип доезжает до своей ячейки коротким скольжением.

function tick(): void {
  haptics.tap();
}
function lift(): void {
  haptics.impact();
}
function landed(): void {
  haptics.success();
}

interface Shared {
  order: SharedValue<string[]>;
  widths: SharedValue<Record<string, number>>;
  activeId: SharedValue<string>;
  target: SharedValue<number>;
  dx: SharedValue<number>;
  /** Отпущенный чип и его остаток пути до ячейки. */
  settleId: SharedValue<string>;
  settle: SharedValue<number>;
}

function Item({
  id,
  shared,
  pad,
  onMeasure,
  onDrop,
  onDragging,
  children,
}: {
  id: string;
  shared: Shared;
  pad: number;
  onMeasure: (id: string, w: number, h: number) => void;
  onDrop: (order: string[]) => void;
  onDragging: (on: boolean) => void;
  children: ReactNode;
}) {
  const { order, widths, activeId, target, dx, settleId, settle } = shared;

  const pan = Gesture.Pan()
    .activateAfterLongPress(350)
    .onStart(() => {
      activeId.value = id;
      target.value = order.value.indexOf(id);
      dx.value = 0;
      settleId.value = "";
      settle.value = 0;
      runOnJS(lift)();
      runOnJS(onDragging)(true);
    })
    .onUpdate((e) => {
      if (activeId.value !== id) return;
      dx.value = e.translationX;
      const ids = order.value;
      const from = ids.indexOf(id);
      const boxes = ids.map((key, i) => ({
        x: slotX(ids, widths.value, i, pad),
        w: widths.value[key] ?? 0,
      }));
      const box = boxes[from];
      if (!box) return;
      const next = dropIndex(boxes, from, box.x + box.w / 2 + e.translationX);
      if (next !== target.value) runOnJS(tick)();
      target.value = next;
    })
    .onFinalize(() => {
      if (activeId.value !== id) return;
      const ids = order.value;
      const from = ids.indexOf(id);
      const to = target.value < 0 ? from : target.value;
      const visual = slotX(ids, widths.value, from, pad) + dx.value;
      const next = ids.slice();
      next.splice(from, 1);
      next.splice(to, 0, id);
      // ОДНОЙ ЗАПИСЬЮ: новый порядок, конец жеста и скольжение отпущенного
      // чипа от того места, где его видно, к новой ячейке.
      order.value = next;
      settleId.value = id;
      settle.value = visual - slotX(next, widths.value, to, pad);
      settle.value = withTiming(0, { duration: 160, easing: Easing.out(Easing.cubic) });
      activeId.value = "";
      target.value = -1;
      dx.value = 0;
      runOnJS(onDragging)(false);
      if (from !== to) {
        runOnJS(landed)();
        runOnJS(onDrop)(next);
      }
    });

  const style = useAnimatedStyle(() => {
    const ids = order.value;
    const index = ids.indexOf(id);
    const base = slotX(ids, widths.value, index, pad);
    if (activeId.value === id) {
      return { zIndex: 10, opacity: 0.95, transform: [{ translateX: base + dx.value }, { scale: 1.06 }] };
    }
    if (activeId.value !== "") {
      // Соседи расступаются на ширину тянущегося чипа — плавно.
      const from = ids.indexOf(activeId.value);
      const w = (widths.value[activeId.value] ?? 0) + CHIP_GAP;
      const to = target.value;
      let shift = 0;
      if (from < index && index <= to) shift = -w;
      else if (from > index && index >= to) shift = w;
      return {
        zIndex: 0,
        opacity: 1,
        transform: [{ translateX: withTiming(base + shift, { duration: 160 }) }, { scale: 1 }],
      };
    }
    // Покой: ровно ячейка (у отпущенного — плюс остаток скольжения). Без
    // анимации: соседи уже стоят там, куда их отвёл жест.
    const extra = settleId.value === id ? settle.value : 0;
    return {
      zIndex: settleId.value === id ? 5 : 0,
      opacity: 1,
      transform: [{ translateX: base + extra }, { scale: 1 }],
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[{ position: "absolute", left: 0, top: 0 }, style]}
        onLayout={(e) => onMeasure(id, e.nativeEvent.layout.width, e.nativeEvent.layout.height)}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

/** Ряд чипов, которые зажимают и перетаскивают. Место каждого чипа считается
 *  из ширин; `renderChip` рисует сам чип. */
export function DraggableChipRow({
  ids,
  pad,
  onReorder,
  onDragging,
  onPositions,
  renderChip,
}: {
  ids: readonly string[];
  /** Левый отступ ленты — с него начинается первый чип. */
  pad: number;
  onReorder: (ids: string[]) => void;
  onDragging: (on: boolean) => void;
  /** Левые края чипов в координатах ленты — для подводки к выбранному. */
  onPositions?: (x: Record<string, number>) => void;
  renderChip: (id: string) => ReactNode;
}) {
  const shared: Shared = {
    order: useSharedValue<string[]>([...ids]),
    widths: useSharedValue<Record<string, number>>({}),
    activeId: useSharedValue(""),
    target: useSharedValue(-1),
    dx: useSharedValue(0),
    settleId: useSharedValue(""),
    settle: useSharedValue(0),
  };
  const widthsRef = useRef<Record<string, number>>({});
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const key = ids.join("|");
  const report = (w: Record<string, number>, list: readonly string[]) => {
    if (!onPositions) return;
    const out: Record<string, number> = {};
    for (let i = 0; i < list.length; i++) out[list[i]] = slotX(list, w, i, pad);
    onPositions(out);
  };
  // Порядок пришёл снаружи (сохранён, не принят, новый календарь) — тот же
  // порядок на потоке UI. Совпадает с записанным при отпускании — ничего не
  // двигается.
  useLayoutEffect(() => {
    shared.order.value = [...ids];
    report(widthsRef.current, ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const onMeasure = (id: string, w: number, h: number) => {
    if (widthsRef.current[id] === w && size?.h === h) return;
    widthsRef.current = { ...widthsRef.current, [id]: w };
    shared.widths.value = widthsRef.current;
    if (ids.every((k) => widthsRef.current[k] != null)) {
      const total =
        ids.reduce((sum, k) => sum + (widthsRef.current[k] ?? 0), 0) +
        Math.max(0, ids.length - 1) * CHIP_GAP;
      setSize({ w: pad + total, h });
      report(widthsRef.current, ids);
    }
  };

  const keyRef = useRef(key);
  keyRef.current = key;
  const drop = (next: string[]) => {
    const before = keyRef.current;
    onReorder(next);
    // Порядок не принят (ошибка) — лента возвращается к тому, что есть.
    setTimeout(() => {
      if (keyRef.current === before) shared.order.value = before ? before.split("|") : [];
    }, 700);
  };

  return (
    // Пока ширины не измерены — ряд невидим один кадр: иначе чипы мелькнули бы
    // стопкой в левом углу.
    <View style={{ width: size?.w ?? 1, height: size?.h ?? 36, opacity: size ? 1 : 0 }}>
      {ids.map((id) => (
        <Item
          key={id}
          id={id}
          shared={shared}
          pad={pad}
          onMeasure={onMeasure}
          onDrop={drop}
          onDragging={onDragging}
        >
          {renderChip(id)}
        </Item>
      ))}
    </View>
  );
}
