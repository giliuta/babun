import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { Platform, View } from "react-native";
import { haptics } from "@/lib/haptics";
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
import {
  HOUR_H_DEFAULT,
  HOUR_H_MAX,
  minHourH,
  PAD_BOTTOM,
  PAD_TOP,
  pinchAnchor,
  pinchFrame,
  pinchRelease,
  settleStep,
  wheelZoomFactor,
} from "./zoom-math";

// Vertical scale of the time grid (pixels per hour). The LIVE value is a
// Reanimated shared value (`hourHSv`) owned by the calendar screen: the
// pinch gesture below mutates it on the UI thread, so zooming never touches
// React state mid-gesture. The committed value (`hourH` prop, updated once
// per gesture via onZoom) exists only for render-time derivations.
// Числа и вся математика жеста — в `zoom-math.ts`, там их видит тест.
export { HOUR_H_DEFAULT, HOUR_H_MAX, HOUR_H_MIN } from "./zoom-math";

// МАСШТАБ ЖЕСТА — ДЛЯ ТОГО, ЧТО НЕ ДОЛЖНО ТЯНУТЬСЯ (владелец 04.10, снимки с
// телефона: при щипке цифры часов и «16:49» сплющивались и вытягивались).
// Пока пальцы на стекле, сетка — картинка под scaleY; подписи двигаются
// вместе с ней, но обратным масштабом сохраняют форму.
const GestureScaleContext = createContext<SharedValue<number> | null>(null);

/** Обратный масштаб жеста: подпись едет вместе с сеткой, но не тянется. */
export function useUnstretchedStyle() {
  const scale = useContext(GestureScaleContext);
  return useAnimatedStyle(() => ({
    transform: [{ scaleY: scale && scale.value > 0 ? 1 / scale.value : 1 }],
  }));
}

// The scrollable, pinch-zoomable shell shared by DayView and WeekView.
// Children = <TimeRail> + N <DayColumn>, laid out in a row whose height is
// driven by `hourHSv` on the UI thread.
//
// Zoom design (the whole point of this module):
//   * the pinch NEVER crosses the JS bridge mid-gesture — every frame is two
//     transform numbers on the UI thread, no layout and no scrollTo;
//   * the anchor is the FOCAL POINT of the pinch (iOS-native), not the
//     viewport centre: the time under the user's fingers stays under them,
//     and finger drift pans the grid while zooming (Photos/Maps feel);
//   * the scale counts from the moment the pinch is recognized, so the first
//     frame does not leap by the distance the fingers travelled before it;
//   * native scrolling is disabled while the pinch is active so the scroll
//     view doesn't fight the programmatic scrollTo;
//   * release is TWO frames: the new height lands in layout under a holding
//     translate, and only then the scroll moves (see `zoom-math.ts` — RN
//     clamps scrollTo to the content size it has right now);
//   * on release the value snaps to a whole pixel and is committed to React
//     exactly once via `onZoom`.
export function ZoomableTimeGrid({
  hourHSv,
  onZoom,
  startHour,
  endHour,
  scrollToHour,
  pageGesture,
  scrollLocked = false,
  children,
}: {
  hourHSv: SharedValue<number>;
  /** Commit callback — fired ONCE per pinch (on release) with the snapped
   *  pixels-per-hour, so cold layers (slot taps, block text) re-render. */
  onZoom?: (next: number) => void;
  startHour: number;
  endHour: number;
  /** Час, на котором календарь открывается: начало графика команды. */
  scrollToHour?: number;
  /** Горизонтальный pan пейджера периода (см. pager.tsx) — компонуется
   *  Race'ом с пинчем: один палец вбок = листание, два = зум. */
  pageGesture?: PanGesture;
  /** Запись в режиме правки («Двигать и растягивать»): прокрутка стоит, чтобы
   *  палец на записи двигал её, а не сетку. */
  scrollLocked?: boolean;
  children: ReactNode;
}) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);
  const viewportH = useSharedValue(0);
  // true от признания пинча до конца отпускания (шаг 2): прокрутка стоит.
  const pinching = useSharedValue(false);
  // true только пока пальцы на стекле: отпускание срабатывает ровно раз.
  const active = useSharedValue(false);
  // Captured at pinch start: base scale, the gesture scale at recognition
  // and the time (hours since window start) under the initial focal point.
  const baseH = useSharedValue(HOUR_H_DEFAULT);
  const scale0 = useSharedValue(1);
  const anchorTime = useSharedValue(0);
  const lastFocalY = useSharedValue(0);
  // Номер отпускания: новый жест гасит недоделанный шаг 2 прошлого.
  const settleToken = useSharedValue(0);
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

  // Открывающий скролл к часу графика выполняется ПОСЛЕ первого layout
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
    const fit = minHourH(endHour - startHour, vh);
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
  //
  // ЗАПРЕТ ПРОКРУТКИ «СВОБОДНОГО ПЕРЕМЕЩЕНИЯ» — В ТОМ ЖЕ ИСТОЧНИКЕ (повторный
  // аудит 03.10, на симуляторе). Запрет стоял обычным пропом `scrollEnabled`
  // рядом с анимированным, и Reanimated ставил своё значение поверх: в
  // режиме правки сетка всё равно ехала под пальцем (владелец 24.09: «сетка не
  // прокручивается, палец двигает запись»). Одно свойство — одно правило.
  const lockedSv = useSharedValue(scrollLocked);
  useEffect(() => {
    lockedSv.value = scrollLocked;
  }, [scrollLocked, lockedSv]);
  const scrollProps = useAnimatedProps(() => ({
    scrollEnabled: !pinching.value && !lockedSv.value,
  }));

  // The scroll view's own (native) pan recognizer, wrapped into RNGH so the
  // pinch can declare a relation with it. Without the explicit relation the
  // native pan claims any sloppy two-finger touch (real fingers always drift
  // the centroid) and the pinch is cancelled before it activates — zoom
  // «worked» with the simulator's perfectly symmetric Option-pinch and never
  // on a device.
  const nativeScroll = Gesture.Native();

  // ШАГ 2 ОТПУСКАНИЯ. `scrollTo` React Native клампит offset по contentSize,
  // который нативный скролл ЕЩЁ НЕ ЗНАЕТ: высота, записанная на отпускании,
  // попадает на экран в коммите кадра, а колбэки requestAnimationFrame идут
  // раньше коммита. При увеличении прыжок к старому краю был в часы
  // (владелец 04.10: «растягивается время и потом резкий скачок»; на
  // симуляторе нужно было 896, встало 174 — старый предел). Поэтому
  // прокрутка дожимается по кадрам, а сдвиг каждый кадр равен недокрученному
  // остатку (`settleStep`): картинка стоит при ЛЮБОМ фактическом offset
  // (событие скролла приходит синхронно внутри `scrollTo`, `scrollY` свежий).
  const settle = (token: number, target: number) => {
    "worklet";
    // Шаг — локальная функция: worklet, зовущий сам себя по имени из
    // замыкания, на UI-рантайме не переносится (первый же повтор ронял
    // приложение — поймано на симуляторе 04.10).
    const step = (tries: number, prev: number) => {
      if (settleToken.value !== token) return;
      scrollTo(scrollRef, 0, target, false);
      const actual = scrollY.value;
      const s = settleStep(actual, target, tries, prev);
      gestureTy.value = s.ty;
      if (s.again) {
        requestAnimationFrame(() => step(tries + 1, actual));
        return;
      }
      pinching.value = false;
      if (onZoom) runOnJS(onZoom)(layoutH.value);
    };
    step(0, scrollY.value);
  };

  // Упор щипка в край масштаба чувствуется рукой (владелец 04.10: «чтоб
  // можно было ощущать блоки») — один удар на вход в край, не на каждый кадр.
  const atLimit = useSharedValue(false);
  const pinch = Gesture.Pinch()
    // Recognize alongside the native scroll instead of losing to it. The
    // first pinch frame sets `pinching` → scrollEnabled(false) cancels the
    // native pan mid-gesture, so exactly one writer drives the geometry
    // for the rest of the gesture.
    .simultaneousWithExternalGesture(nativeScroll)
    .onStart((e) => {
      // Недоделанное отпускание прошлого жеста гасится: картинку держит его
      // сдвиг, и новый жест стартует ровно с того, что видно.
      settleToken.value += 1;
      atLimit.value = false;
      active.value = true;
      pinching.value = true;
      baseH.value = layoutH.value;
      scrollY0.value = scrollY.value;
      scale0.value = e.scale > 0 ? e.scale : 1;
      lastFocalY.value = e.focalY;
      anchorTime.value = pinchAnchor(
        scrollY.value - gestureTy.value,
        e.focalY,
        baseH.value,
      );
    })
    .onUpdate((e) => {
      if (!active.value) return;
      const f = pinchFrame({
        baseH: baseH.value,
        anchor: anchorTime.value,
        scale: e.scale,
        scale0: scale0.value,
        focalY: e.focalY,
        span: endHour - startHour,
        vh: viewportH.value,
      });
      hourHSv.value = f.h;
      lastFocalY.value = e.focalY;
      const limit =
        f.h >= HOUR_H_MAX - 0.01 ||
        f.h <= minHourH(endHour - startHour, viewportH.value) + 0.01;
      if (limit && !atLimit.value) runOnJS(haptics.edge)();
      atLimit.value = limit;
      // Кадр жеста = два числа трансформа, БЕЗ layout и БЕЗ scrollTo:
      // якорное время держится под фокусом пальцев, края — как bounces=false.
      gestureScale.value = f.h / baseH.value;
      gestureTy.value = scrollY0.value - f.offset;
    })
    .onFinalize(() => {
      if (!active.value) return;
      active.value = false;
      // ШАГ 1: целая высота уходит в layout при ПРЕЖНЕЙ прокрутке, а сдвиг
      // держит картинку там, где она была под пальцами. Прокрутка — шагом 2.
      const span = endHour - startHour;
      const r = pinchRelease({
        h: hourHSv.value,
        offset: scrollY0.value - gestureTy.value,
        focalY: lastFocalY.value,
        scrollY0: scrollY0.value,
        span,
        vh: viewportH.value,
      });
      layoutH.value = r.snapped;
      hourHSv.value = r.snapped;
      gestureScale.value = 1;
      gestureTy.value = r.holdTy;
      const token = settleToken.value + 1;
      settleToken.value = token;
      requestAnimationFrame(() => settle(token, r.target));
    });

  const rowStyle = useAnimatedStyle(() => ({
    height: (endHour - startHour) * layoutH.value,
    transform: [
      { translateY: gestureTy.value },
      { scaleY: gestureScale.value },
    ],
  }));

  // ВЕБ: ЩИПОК ДОЛЖЕН УВЕЛИЧИВАТЬ КАЛЕНДАРЬ, А НЕ СТРАНИЦУ (владелец 04.10:
  // «если увеличивать, то увеличивается не календарь, а страница целиком»).
  // Браузер отдаёт щипок не жестом касаний, а своими событиями: тачпад в
  // Chrome/Edge/Firefox — колесом с `ctrlKey`, Safari (Mac и iPhone) —
  // `gesturestart/change/end`. Над сеткой они гасятся (`preventDefault`, иначе
  // браузер масштабирует страницу) и идут в ту же математику кадра, что и
  // пинч на телефоне: время под курсором стоит на месте. Вне сетки обычное
  // увеличение страницы браузером остаётся.
  const outerRef = useRef<View>(null);
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
      onZoom?.(snapped);
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

  // Один палец вбок = живой пейджинг периода (pan из pager.tsx, maxPointers 1
  // + failOffsetY — вертикаль уходит скроллу); два пальца = пинч. Race:
  // кто активировался первым, тот и владеет касанием.
  const grid = pageGesture ? Gesture.Race(pageGesture, pinch) : pinch;

  return (
    <View ref={outerRef} style={{ flex: 1 }}>
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
            <GestureScaleContext.Provider value={gestureScale}>
              {children}
            </GestureScaleContext.Provider>
          </Animated.View>
        </Animated.ScrollView>
      </GestureDetector>
      </GestureDetector>
    </View>
  );
}
