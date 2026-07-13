import { useEffect, type ReactNode } from "react";
import {
  Gesture,
  GestureDetector,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedProps,
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
  onPrev,
  onNext,
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
  onPrev?: () => void;
  onNext?: () => void;
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

  useEffect(() => {
    if (scrollToHour == null) return;
    const y = Math.max(0, (scrollToHour - startHour) * hourHSv.value);
    const raf = requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ y, animated: false }),
    );
    return () => cancelAnimationFrame(raf);
    // hourHSv is read imperatively on purpose: zoom must NOT re-fire the
    // open-scroll (web parity with the old views' `hourH` exclusion).
  }, [scrollToHour, startHour, hourHSv, scrollRef]);

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
    // native pan mid-gesture, so exactly one writer (the scrollTo below)
    // drives the offset for the rest of the gesture.
    .simultaneousWithExternalGesture(nativeScroll)
    .onStart((e) => {
      pinching.value = true;
      baseH.value = hourHSv.value;
      anchorTime.value =
        (scrollY.value + e.focalY - PAD_TOP) / baseH.value;
    })
    .onUpdate((e) => {
      const h = Math.min(
        HOUR_H_MAX,
        Math.max(minHourH(), baseH.value * e.scale),
      );
      hourHSv.value = h;
      // Same-frame scroll correction: keep the anchored time under the
      // CURRENT focal point (drift = two-finger pan). Clamped so zooming
      // out at the edges never overscrolls.
      const contentH = PAD_TOP + (endHour - startHour) * h + PAD_BOTTOM;
      const maxY = Math.max(0, contentH - viewportH.value);
      const y = PAD_TOP + anchorTime.value * h - e.focalY;
      scrollTo(scrollRef, 0, Math.min(maxY, Math.max(0, y)), false);
    })
    .onFinalize(() => {
      if (!pinching.value) return;
      pinching.value = false;
      const snapped = Math.round(hourHSv.value);
      hourHSv.value = snapped;
      if (onZoom) runOnJS(onZoom)(snapped);
    });

  // Horizontal swipe = prev/next period — same thresholds the views always
  // used. One finger only, so a sloppy pinch release can never page the
  // calendar. Race: whichever of swipe/pinch activates first wins the touch.
  const swipe = Gesture.Pan()
    .maxPointers(1)
    .activeOffsetX([-25, 25])
    .failOffsetY([-18, 18])
    .onEnd((e) => {
      if (e.translationX > 55 && onPrev) runOnJS(onPrev)();
      else if (e.translationX < -55 && onNext) runOnJS(onNext)();
    });

  const rowStyle = useAnimatedStyle(() => ({
    height: (endHour - startHour) * hourHSv.value,
  }));

  return (
    <GestureDetector gesture={Gesture.Race(swipe, pinch)}>
      {/* Inner detector binds the scroll view's native recognizer into RNGH —
          the handle the pinch's simultaneousWithExternalGesture points at. */}
      <GestureDetector gesture={nativeScroll}>
        <Animated.ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: PAD_TOP,
            paddingBottom: PAD_BOTTOM,
          }}
          onScroll={onScroll}
          animatedProps={scrollProps}
          onLayout={(e) => {
            viewportH.value = e.nativeEvent.layout.height;
            // A viewport/window change can push the fit floor above the
            // current zoom (e.g. wider visible hours in settings) — snap up
            // so the grid never sits detached above a void.
            const fit = Math.min(
              HOUR_H_MAX,
              Math.max(
                HOUR_H_MIN,
                Math.ceil(
                  (e.nativeEvent.layout.height - PAD_TOP - PAD_BOTTOM) /
                    (endHour - startHour),
                ),
              ),
            );
            if (hourHSv.value < fit) {
              hourHSv.value = fit;
              onZoom?.(fit);
            }
          }}
          scrollEventThrottle={16}
        >
          <Animated.View style={[{ flexDirection: "row" }, rowStyle]}>
            {children}
          </Animated.View>
        </Animated.ScrollView>
      </GestureDetector>
    </GestureDetector>
  );
}
