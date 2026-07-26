import { useEffect, useRef, useState, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, type PanGesture } from "react-native-gesture-handler";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useReduceMotion } from "@/lib/reduce-motion";

// Живой горизонтальный пейджинг периода (Bumpix / Apple Calendar): контент
// ЕДЕТ ЗА ПАЛЬЦЕМ, отпускание доводит до соседней страницы, период
// коммитится в React бесшовно.
//
// Устройство — «бесконечная ось»: страница i живёт на абсолютной оси в
// x = i·w; лента сдвинута на axisX (shared value, UI-поток). Смонтированы
// ровно три слота idx−1 / idx / idx+1 с key = НОМЕР СТРАНИЦЫ. Коммит:
// доводка заканчивается на соседней странице → idx += dir → слот, который
// уже стоит под пальцем, сохраняет и key, и координату, и контент (страницы
// — чистые функции дат), а два других слота монтируются за экраном. Никаких
// сбросов translateX → мигание невозможно по построению, независимо от
// того, когда React успеет закоммитить.

const SETTLE_MS = 220;
const SETTLE_EASING = Easing.out(Easing.cubic);
// Доля ширины / скорость (px/s), после которых отпускание листает период.
const DIST_RATIO = 0.35;
const FLING_V = 600;

export interface PeriodPager {
  /** Лента: translateX всей оси (UI-поток). */
  axisX: ReturnType<typeof useSharedValue<number>>;
  /** Закоммиченный номер страницы (растёт бесконечно в обе стороны). */
  idx: number;
  /** Горизонтальный pan — компонуется с пинчем/скроллом снаружи. */
  pan: PanGesture;
  /** Ширина страницы (0 до первого layout). */
  width: number;
  onLayoutWidth: (w: number) => void;
}

export function usePeriodPager({
  periodKey,
  onCommit,
}: {
  /** Идентичность ТЕКУЩЕГО периода (ymd дня / понедельника, "YYYY-M").
   *  Смена без коммита пейджера = внешний прыжок («Сегодня», мини-календарь)
   *  → ось встаёт на idx без анимации, страницы просто перерисуются. */
  periodKey: string;
  /** Палец долистал: родитель сдвигает якорь (setDay ± период). */
  onCommit: (dir: 1 | -1) => void;
}): PeriodPager {
  const [idx, setIdx] = useState(0);
  const [width, setWidth] = useState(0);
  const axisX = useSharedValue(0);
  const idxSv = useSharedValue(0);
  const wSv = useSharedValue(0);
  const dragFrom = useSharedValue(0);
  // Различает смену periodKey от собственного коммита и от внешнего прыжка.
  const internal = useRef(false);
  // Поколение якоря: растёт на каждом внешнем прыжке. Свайп запоминает его
  // на старте жеста — догоняющий commitJS с чужим поколением дропается,
  // иначе завершившаяся во время прыжка доводка сдвинула бы новый якорь
  // («Сегодня» → внезапно вчера).
  const gen = useRef(0);
  const dragGen = useRef(0);
  // Reduce Motion: доводка мгновенная (сам drag — прямое манипулирование,
  // его не трогаем).
  const reducedMotion = useReduceMotion();

  const markDragStart = () => {
    dragGen.current = gen.current;
  };

  const commitJS = (dir: 1 | -1) => {
    if (dragGen.current !== gen.current) {
      // Якорь уже сменился извне: откатываем UI-инкремент доводки и ставим
      // ось на слот — прыжковый эффект ниже видел уже сдвинутый idxSv.
      idxSv.value = idxSv.value - dir;
      axisX.value = -idxSv.value * wSv.value;
      return;
    }
    internal.current = true;
    setIdx((i) => i + dir);
    onCommit(dir);
  };

  useEffect(() => {
    if (internal.current) {
      internal.current = false;
      return;
    }
    // Внешний прыжок даты: ось мгновенно на текущий слот (без доводки).
    gen.current++;
    cancelAnimation(axisX);
    axisX.value = -idxSv.value * wSv.value;
  }, [periodKey, axisX, idxSv, wSv]);

  const onLayoutWidth = (w: number) => {
    if (w <= 0 || w === width) return;
    setWidth(w);
    wSv.value = w;
    cancelAnimation(axisX);
    axisX.value = -idxSv.value * w;
  };

  const pan = Gesture.Pan()
    .maxPointers(1)
    .activeOffsetX([-15, 15])
    .failOffsetY([-15, 15])
    .onStart(() => {
      // Перехват мидл-доводки: замораживаем ось, коммит не успел — idx цел.
      cancelAnimation(axisX);
      dragFrom.value = axisX.value;
      runOnJS(markDragStart)();
    })
    .onUpdate((e) => {
      const w = wSv.value;
      if (w <= 0) return;
      const lo = -(idxSv.value + 1) * w;
      const hi = -(idxSv.value - 1) * w;
      const next = dragFrom.value + e.translationX;
      axisX.value = Math.min(hi, Math.max(lo, next));
    })
    .onEnd((e) => {
      const w = wSv.value;
      if (w <= 0) return;
      const rel = axisX.value + idxSv.value * w; // смещение от центра, ±w
      const dir: 0 | 1 | -1 =
        rel < -DIST_RATIO * w || (e.velocityX < -FLING_V && rel < -24)
          ? 1
          : rel > DIST_RATIO * w || (e.velocityX > FLING_V && rel > 24)
            ? -1
            : 0;
      const target = -(idxSv.value + dir) * w;
      axisX.value = withTiming(
        target,
        { duration: reducedMotion ? 0 : SETTLE_MS, easing: SETTLE_EASING },
        (finished) => {
          if (!finished || dir === 0) return;
          idxSv.value = idxSv.value + dir;
          runOnJS(commitJS)(dir);
        },
      );
    });

  return { axisX, idx, pan, width, onLayoutWidth };
}

// Лента из трёх страниц на общей оси. Рендерится дважды на вид (полоса
// шапок дат + полоса колонок в сетке) с ОДНИМ pager'ом — обе едут в локстепе.
export function PagedStrip({
  pager,
  renderPage,
  style,
}: {
  pager: PeriodPager;
  /** Контент страницы со смещением off периодов от текущей. */
  renderPage: (off: -1 | 0 | 1) => ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const anim = useAnimatedStyle(() => ({
    transform: [{ translateX: pager.axisX.value }],
  }));
  const { idx, width } = pager;
  return (
    <View
      style={[{ flex: 1, overflow: "hidden" }, style]}
      onLayout={(e) => pager.onLayoutWidth(e.nativeEvent.layout.width)}
    >
      {width > 0 ? (
        <Animated.View
          style={[
            { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
            anim,
          ]}
        >
          {([-1, 0, 1] as const).map((off) => (
            <View
              key={idx + off}
              style={{
                position: "absolute",
                left: (idx + off) * width,
                width,
                top: 0,
                bottom: 0,
              }}
            >
              {renderPage(off)}
            </View>
          ))}
        </Animated.View>
      ) : (
        // Первый кадр до замера ширины — статичная текущая страница,
        // чтобы сетка не мигала пустотой.
        renderPage(0)
      )}
    </View>
  );
}
