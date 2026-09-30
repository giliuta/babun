import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  runOnUI,
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
// умела двигать только строки-переключатели. Страница «Счета» — тот же жест
// над другими строками, поэтому механика вынесена сюда, а содержимое строки
// каждый экран рисует своё. Второй копии drag-кода в продукте быть не должно.
//
// Тянут за РУЧКУ из шести точек справа, а не за всю строку: строка сама по
// себе кликается (переключатель, шторка правки счёта), и перетаскивание
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

/** Общее состояние жеста на весь список. `laid` — порядок id, на который
 *  посчитаны остальные значения (см. `useAnimatedStyle` строки). */
interface DragState {
  active: SharedValue<number>;
  target: SharedValue<number>;
  dy: SharedValue<number>;
  laid: SharedValue<string[]>;
  pending: SharedValue<boolean>;
}

function Row({
  id,
  index,
  rowHeight,
  min,
  max,
  label,
  handleInside,
  spaced,
  onDrop,
  drag,
  onActiveChange,
  children,
}: {
  id: string;
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
  drag: DragState;
  onActiveChange: (dragging: boolean) => void;
  children: (handle: ReactNode) => ReactNode;
}) {
  const t = useThemeColors();
  const { active, target, dy, laid, pending } = drag;
  // Двигать некуда — ручки нет. Строка, у которой единственное допустимое
  // место — её собственное, не должна предлагать жест, который ничего не
  // меняет: палец тянет, а строка возвращается на место без объяснений.
  const draggable = max > min;

  // ШАГ — ЭТО ВЫСОТА ПЛЮС ЗАЗОР. В режиме `spaced` строки стоят через
  // `SPACED_GAP`, и мерить перелёт одной высотой значит промахиваться на
  // восемь точек на каждом соседе: к четвёртой строке палец уже на строку
  // выше, чем показывает список.
  const pitch = rowHeight + (spaced ? SPACED_GAP : 0);

  const pan = Gesture.Pan()
    .activateAfterLongPress(120)
    .onStart(() => {
      // Прошлое отпускание ещё не приехало новым порядком — новый жест ждёт.
      if (pending.value) return;
      active.value = index;
      target.value = index;
      runOnJS(onActiveChange)(true);
      runOnJS(bump)();
    })
    .onChange((e) => {
      if (active.value !== index || pending.value) return;
      dy.value = e.translationY;
      const to = Math.round(e.translationY / pitch) + index;
      target.value = Math.min(Math.max(to, min), max);
    })
    .onEnd(() => {
      if (active.value !== index || pending.value) return;
      const to = target.value;
      if (to !== index) {
        // КАРТИНКА ЗАМИРАЕТ ДО НОВОГО ПОРЯДКА. Раньше здесь всё сбрасывалось
        // сразу: строка на потоке UI прыгала на старое место, а порядок из JS
        // приезжал кадром-двумя позже и ставил её на новое — рывок, который
        // владелец видел на каждом списке с ручкой (22.09). Теперь строка
        // доезжает в свою ячейку и стоит, пока список не перерисуется.
        pending.value = true;
        dy.value = withTiming((to - index) * pitch, { duration: 120 });
        runOnJS(onDrop)(index, to);
      }
    })
    .onFinalize(() => {
      if (!pending.value && active.value === index) {
        dy.value = 0;
        active.value = -1;
        target.value = -1;
      }
      runOnJS(onActiveChange)(false);
    });

  const style = useAnimatedStyle(() => {
    // МЕСТО, НА КОТОРОЕ СЧИТАНЫ ОБЩИЕ ЗНАЧЕНИЯ ЖЕСТА. Пока новый порядок не
    // принят (`laid` ещё старый), строка, уже перерисованная на новом месте,
    // сдвигается назад на разницу — и глаз видит ту же картинку, что до
    // перерисовки. Сброс жеста и новый `laid` пишутся ОДНОЙ записью, поэтому
    // в какой бы кадр ни пришли перерисовка и сброс, видимое не дёргается.
    const at = laid.value.indexOf(id);
    const from = at < 0 ? index : at;
    const comp = (from - index) * pitch;
    const dragging = active.value >= 0 && active.value === from;
    if (dragging) {
      return {
        transform: [{ translateY: dy.value + comp }, { scale: 1.02 }],
        zIndex: 10,
        backgroundColor: t.surface,
      };
    }
    const shift = shiftFor(from, active.value, target.value) * pitch;
    return {
      transform: [
        {
          // Плавно — только пока тянут; замершая и сброшенная картинка
          // ставится мгновенно, иначе догоняющая анимация и есть рывок.
          translateY:
            active.value >= 0 && !pending.value
              ? withTiming(shift + comp, { duration: 140 })
              : shift + comp,
        },
        { scale: 1 },
      ],
      zIndex: 0,
      // Строка-карточка (`spaced`) держит СВОЙ белый фон и здесь. Анимированный
      // стиль reanimated пишется поверх статичного: «transparent» стирал фон
      // карточки при первом же перетаскивании (на вебе — сразу), и строки
      // становились серыми тенями на сером (найдено сборкой для Claude Design
      // 21.09).
      backgroundColor: spaced ? t.surface : "transparent",
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
                // Та же тень, что у `RowGroupBody`: отдельно стоящая строка —
                // это карточка, и она не имеет права выглядеть плоским
                // прямоугольником рядом с карточками остальных экранов.
                boxShadow: t.cardShadow,
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
  const ids = items.map((item) => item.id);
  const orderKey = ids.join("|");
  const drag: DragState = {
    active: useSharedValue(-1),
    target: useSharedValue(-1),
    dy: useSharedValue(0),
    laid: useSharedValue(ids),
    pending: useSharedValue(false),
  };

  // Новый порядок перерисован — жест сбрасывается ОДНОЙ записью на потоке UI
  // вместе с новым `laid` (почему это важно — у стиля строки).
  const settle = useCallback(
    (next: string[]) => {
      const { active, target, dy, laid, pending } = drag;
      runOnUI((order: string[]) => {
        "worklet";
        laid.value = order;
        dy.value = 0;
        active.value = -1;
        target.value = -1;
        pending.value = false;
      })(next);
    },
    // Общие значения живут столько же, сколько список.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useLayoutEffect(() => {
    settle(orderKey ? orderKey.split("|") : []);
  }, [orderKey, settle]);

  // Экран может и не принять порядок (ошибка, запрет) — тогда перерисовки не
  // будет, и замершая картинка вернётся к тому, что есть, сама.
  const keyRef = useRef(orderKey);
  keyRef.current = orderKey;
  const drop = useCallback(
    (from: number, to: number) => {
      const next = items.map((item) => item.id);
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      haptics.success();
      const before = keyRef.current;
      onReorder(next);
      setTimeout(() => {
        if (keyRef.current === before) settle(before ? before.split("|") : []);
      }, 700);
    },
    [items, onReorder, settle],
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
            id={item.id}
            index={index}
            rowHeight={rowHeight}
            min={min}
            max={max}
            label={labelFor(item)}
            handleInside={handleInside}
            spaced={spaced}
            onDrop={drop}
            drag={drag}
            onActiveChange={dragging}
          >
            {(handle) => children(item, index, handle)}
          </Row>
        );
      })}
    </>
  );
}
