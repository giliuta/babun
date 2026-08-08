import { useEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";
import {
  Gesture,
  GestureDetector,
  type PanGesture,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

// Vertical scale of the time grid (pixels per hour). The LIVE value is a
// Reanimated shared value (`hourHSv`) owned by the calendar screen: the
// pinch gesture below mutates it on the UI thread, so zooming never touches
// React state mid-gesture. The committed value (`hourH` prop, updated once
// per gesture via onZoom) exists only for render-time derivations.
export const HOUR_H_DEFAULT = 64;
export const HOUR_H_MIN = 28;
export const HOUR_H_MAX = 200;

// Content paddings of the grid scroll — part of the anchor math, so they
// live next to it instead of inline in the views. Bottom is cosmetic
// breathing room only: the create flow is tap-a-slot (no floating button
// to clear), and the zoom floor below guarantees the grid itself always
// fills the viewport — a big trailing pad would just read as a dead void
// under the last hour.
const PAD_TOP = 6;
const PAD_BOTTOM = 16;

// The scrollable, pinch-zoomable shell shared by DayView and WeekView.
// Children = <TimeRail> + N <DayColumn>, laid out in a row whose height is
// driven by `hourHSv` on the UI thread.
//
// Zoom design (the whole point of this module):
//   * the pinch NEVER crosses the JS bridge mid-gesture — `hourHSv` and the
//     scroll offset are updated in the same UI-thread frame, so the grid
//     cannot "jump" between a height change and its scroll correction;
//   * the anchor is the FOCAL POINT of the pinch (iOS-native), not the
//     viewport centre: the time under the user's fingers stays under them,
//     and finger drift pans the grid while zooming (Photos/Maps feel);
//   * native scrolling is disabled while the pinch is active so the scroll
//     view doesn't fight the programmatic scrollTo;
//   * on release the value snaps to a whole pixel and is committed to React
//     exactly once via `onZoom`.
export function ZoomableTimeGrid({
  hourHSv,
  onZoom,
  startHour,
  endHour,
  scrollToHour,
  pageGesture,
  children,
}: {
  hourHSv: SharedValue<number>;
  /** Commit callback — fired ONCE per pinch (on release) with the snapped
   *  pixels-per-hour, so cold layers (slot taps, block text) re-render. */
  onZoom?: (next: number) => void;
  startHour: number;
  endHour: number;
  /** Auto-scroll target on open (settings.scrollOpenHour). */
  scrollToHour?: number;
  /** Горизонтальный pan пейджера периода (см. pager.tsx) — компонуется
   *  Race'ом с пинчем: один палец вбок = листание, два = зум. */
  pageGesture?: PanGesture;
  children: ReactNode;
}) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);
  const viewportH = useSharedValue(0);
  const pinching = useSharedValue(false);
  // Captured at pinch start: base scale + the time (hours since window
  // start) under the initial focal point.
  const baseH = useSharedValue(HOUR_H_DEFAULT);
  const anchorTime = useSharedValue(0);
  // Высота, которой живёт LAYOUT. Во время пинча она ЗАМОРОЖЕНА: жест
  // рисуется чистыми GPU-трансформами (scaleY+translateY) поверх готовой
  // сетки — ни одного прогона Yoga на кадр. Прежняя схема анимировала
  // height напрямую: полный релэйаут сотен узлов каждый кадр + scrollTo,
  // приземляющийся в соседний кадр, — календарь «трясся» под пальцами.
  // Вне жеста следует за hourHSv (fit-пол, смена окна в настройках).
  const layoutH = useSharedValue(HOUR_H_DEFAULT);
  const gestureScale = useSharedValue(1);
  const gestureTy = useSharedValue(0);
  const scrollY0 = useSharedValue(0);
  useAnimatedReaction(
    () => hourHSv.value,
    (v) => {
      if (!pinching.value && layoutH.value !== v) layoutH.value = v;
    },
    [],
  );

  // Открывающий скролл к scrollOpenHour выполняется ПОСЛЕ первого layout
  // (см. onLayout ниже): до него зум-пол мог поднять hourHSv выше дефолта,
  // и посчитанный заранее y промахивался на сотни px (аудит). Смена
  // настройки после маунта докручивает через этот эффект.
  const didOpenScroll = useRef(false);
  const openScroll = () => {
    if (scrollToHour == null) return;
    const y = Math.max(0, (scrollToHour - startHour) * hourHSv.value);
    scrollRef.current?.scrollTo({ y, animated: false });
  };
  useEffect(() => {
    if (didOpenScroll.current) openScroll();
    // hourHSv is read imperatively on purpose: zoom must NOT re-fire the
    // open-scroll (web parity with the old views' `hourH` exclusion).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToHour, startHour]);

  // Поднять текущий зум до fit-пола (сетка обязана заполнять вьюпорт).
  // Вызывается из onLayout И при смене видимого окна часов: сужение окна в
  // настройках не перезамеряет вьюпорт, но поднимает пол — без этого сетка
  // отлипала от низа на уже смонтированном экране.
  const applyFitFloor = (vh: number) => {
    if (vh <= 0) return;
    const fit = Math.min(
      HOUR_H_MAX,
      Math.max(
        HOUR_H_MIN,
        Math.ceil((vh - PAD_TOP - PAD_BOTTOM) / (endHour - startHour)),
      ),
    );
    if (hourHSv.value < fit) {
      hourHSv.value = fit;
      onZoom?.(fit);
    }
  };
  useEffect(() => {
    applyFitFloor(viewportH.value);
    // applyFitFloor намеренно вне deps: пересчёт нужен только при смене окна.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startHour, endHour]);

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  // Two fingers down would otherwise ALSO pan the scroll view (iOS scrolls
  // on any touch count) — the native pan and the anchor scrollTo below then
  // fight over the offset. Disabling scroll for the pinch's lifetime keeps
  // exactly one writer.
  const scrollProps = useAnimatedProps(() => ({
    scrollEnabled: !pinching.value,
  }));

  // Zoom floor: the whole visible window must keep filling the viewport —
  // zooming further out would detach the last hour from the screen bottom
  // and leave a dead void under the grid. (ceil → never a sub-pixel gap.)
  const minHourH = () => {
    "worklet";
    const fit = Math.ceil(
      (viewportH.value - PAD_TOP - PAD_BOTTOM) / (endHour - startHour),
    );
    return Math.min(HOUR_H_MAX, Math.max(HOUR_H_MIN, fit));
  };

  // The scroll view's own (native) pan recognizer, wrapped into RNGH so the
  // pinch can declare a relation with it. Without the explicit relation the
  // native pan claims any sloppy two-finger touch (real fingers always drift
  // the centroid) and the pinch is cancelled before it activates — zoom
  // «worked» with the simulator's perfectly symmetric Option-pinch and never
  // on a device.
  const nativeScroll = Gesture.Native();

  const pinch = Gesture.Pinch()
    // Recognize alongside the native scroll instead of losing to it. The
    // first pinch frame sets `pinching` → scrollEnabled(false) cancels the
    // native pan mid-gesture, so exactly one writer drives the geometry
    // for the rest of the gesture.
    .simultaneousWithExternalGesture(nativeScroll)
    .onStart((e) => {
      pinching.value = true;
      baseH.value = layoutH.value;
      scrollY0.value = scrollY.value;
      anchorTime.value =
        (scrollY.value + e.focalY - PAD_TOP) / baseH.value;
    })
    .onUpdate((e) => {
      const h = Math.min(
        HOUR_H_MAX,
        Math.max(minHourH(), baseH.value * e.scale),
      );
      hourHSv.value = h;
      // Кадр жеста = два числа трансформа, БЕЗ layout и БЕЗ scrollTo.
      // eff — «эффективный» offset, который показывал бы настоящий скролл
      // при высоте h: якорное время держится под текущим фокусом пальцев
      // (дрейф = двухпальцевый пан), края клампятся как bounces=false.
      const span = endHour - startHour;
      const maxY = Math.max(
        0,
        PAD_TOP + span * h + PAD_BOTTOM - viewportH.value,
      );
      const eff = Math.min(
        maxY,
        Math.max(0, PAD_TOP + anchorTime.value * h - e.focalY),
      );
      gestureScale.value = h / baseH.value;
      gestureTy.value = scrollY0.value - eff;
    })
    .onFinalize(() => {
      if (!pinching.value) return;
      // Единый кадр отпускания: настоящая высота, сброс трансформов и
      // реальный offset согласованы — сетка приземляется ровно там, где
      // была под пальцами, один relayout на весь жест.
      const snapped = Math.round(hourHSv.value);
      const span = endHour - startHour;
      const maxY = Math.max(
        0,
        PAD_TOP + span * snapped + PAD_BOTTOM - viewportH.value,
      );
      const eff = Math.min(
        maxY,
        Math.max(0, scrollY0.value - gestureTy.value),
      );
      layoutH.value = snapped;
      hourHSv.value = snapped;
      gestureScale.value = 1;
      gestureTy.value = 0;
      scrollTo(scrollRef, 0, eff, false);
      pinching.value = false;
      if (onZoom) runOnJS(onZoom)(snapped);
    });

  const rowStyle = useAnimatedStyle(() => ({
    height: (endHour - startHour) * layoutH.value,
    transform: [
      { translateY: gestureTy.value },
      { scaleY: gestureScale.value },
    ],
  }));

  // Один палец вбок = живой пейджинг периода (pan из pager.tsx, maxPointers 1
  // + failOffsetY — вертикаль уходит скроллу); два пальца = пинч. Race:
  // кто активировался первым, тот и владеет касанием.
  const grid = pageGesture ? Gesture.Race(pageGesture, pinch) : pinch;

  return (
    <View style={{ flex: 1 }}>
      <GestureDetector gesture={grid}>
      {/* Inner detector binds the scroll view's native recognizer into RNGH —
          the handle the pinch's simultaneousWithExternalGesture points at. */}
      <GestureDetector gesture={nativeScroll}>
        <Animated.ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          // Сетка упирается в края окна и НЕ тянется резинкой (запрос
          // владельца: «упирается в 24:00 и всё») — пустота за последним
          // часом читалась как баг.
          bounces={false}
          overScrollMode="never"
          contentContainerStyle={{
            paddingTop: PAD_TOP,
            paddingBottom: PAD_BOTTOM,
          }}
          onScroll={onScroll}
          animatedProps={scrollProps}
          onLayout={(e) => {
            viewportH.value = e.nativeEvent.layout.height;
            // A viewport/window change can push the fit floor above the
            // current zoom (e.g. taller viewport after rotation) — snap up
            // so the grid never sits detached above a void.
            applyFitFloor(e.nativeEvent.layout.height);
            if (!didOpenScroll.current) {
              didOpenScroll.current = true;
              openScroll();
            }
          }}
          scrollEventThrottle={16}
        >
          {/* transformOrigin top: scaleY жеста растягивает сетку от верхней
              кромки — формула якоря считает визуальную y как ty + s·y. */}
          <Animated.View
            style={[{ flexDirection: "row", transformOrigin: "top" }, rowStyle]}
          >
            {children}
          </Animated.View>
        </Animated.ScrollView>
      </GestureDetector>
      </GestureDetector>
    </View>
  );
}
