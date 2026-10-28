import { useEffect, type RefObject } from "react";
import { Platform, type View } from "react-native";
import type Animated from "react-native-reanimated";
import type { AnimatedRef, SharedValue } from "react-native-reanimated";
import { minHourH, pinchAnchor, pinchFrame, wheelZoomFactor } from "../zoom-math";

// ВЕБ: ЩИПОК ДОЛЖЕН УВЕЛИЧИВАТЬ КАЛЕНДАРЬ, А НЕ СТРАНИЦУ.
// Браузер отдаёт щипок не жестом касаний, а своими событиями: тачпад в
// Chrome/Edge/Firefox — колесом с `ctrlKey`, Safari (Mac и iPhone) —
// `gesturestart/change/end`. Над сеткой они гасятся (`preventDefault`, иначе
// браузер масштабирует страницу) и идут в ту же математику кадра, что и
// пинч на телефоне: время под курсором стоит на месте. Вне сетки обычное
// увеличение страницы браузером остаётся.
export function useWebPinch({
  outerRef,
  scrollRef,
  hourHSv,
  layoutH,
  scrollY,
  viewportH,
  active,
  startHour,
  endHour,
  onZoom,
  commitZoom,
}: {
  outerRef: RefObject<View | null>;
  scrollRef: AnimatedRef<Animated.ScrollView>;
  hourHSv: SharedValue<number>;
  layoutH: SharedValue<number>;
  scrollY: SharedValue<number>;
  viewportH: SharedValue<number>;
  /** Идёт пинч RNGH — касания на iPhone ведёт он. */
  active: SharedValue<boolean>;
  startHour: number;
  endHour: number;
  /** Только для пересборки слушателей вместе с экраном, как было в сетке. */
  onZoom: unknown;
  commitZoom: (h: number) => void;
}): void {
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = outerRef.current as unknown as HTMLElement | null;
    if (!el || typeof el.addEventListener !== "function") return;
    type SafariGesture = Event & { scale: number; clientY: number };
    let base = hourHSv.value;
    let anchor = 0;
    let focal = 0;
    let commitTimer: ReturnType<typeof setTimeout> | null = null;
    const span = endHour - startHour;
    const begin = (clientY: number) => {
      focal = clientY - el.getBoundingClientRect().top;
      base = hourHSv.value;
      anchor = pinchAnchor(scrollY.value, focal, base);
    };
    const frame = (scale: number) => {
      const f = pinchFrame({ baseH: base, anchor, scale, scale0: 1, focalY: focal, span, vh: viewportH.value });
      hourHSv.value = f.h;
      layoutH.value = f.h;
      scrollRef.current?.scrollTo({ y: f.offset, animated: false });
    };
    // Холодные слои (тапы по слотам, текст карточек) узнают высоту один раз,
    // когда щипок затих, — как на телефоне при отпускании.
    const commit = () => {
      commitTimer = null;
      const snapped = Math.max(minHourH(span, viewportH.value), Math.round(hourHSv.value));
      hourHSv.value = snapped;
      layoutH.value = snapped;
      commitZoom(snapped);
    };
    const scheduleCommit = () => {
      if (commitTimer) clearTimeout(commitTimer);
      commitTimer = setTimeout(commit, 160);
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // обычная прокрутка — как была
      e.preventDefault();
      begin(e.clientY);
      frame(wheelZoomFactor(e.deltaY));
      scheduleCommit();
    };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      begin((e as SafariGesture).clientY);
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      // Касания на iPhone уже ведёт пинч RNGH — второго писателя не нужно.
      if (active.value) return;
      frame((e as SafariGesture).scale);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      if (!active.value) commit();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart, { passive: false });
    el.addEventListener("gesturechange", onGestureChange, { passive: false });
    el.addEventListener("gestureend", onGestureEnd, { passive: false });
    return () => {
      if (commitTimer) clearTimeout(commitTimer);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
    };
    // Shared values и ref стабильны; пересборка — только при смене окна часов.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startHour, endHour, onZoom]);
}
