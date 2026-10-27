import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Platform, View } from "react-native";
import { haptics } from "@/lib/haptics";
import {
  Gesture,
  GestureDetector,
  type PanGesture,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  runOnUI,
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
  releaseScrollsFirst,
  settleStep,
  wheelZoomFactor,
} from "./zoom-math";
import {
  hourHForZoom,
  readGridZoom,
  readTopHour,
  readViewportH,
  scrollYForTopHour,
  subscribeGridZoom,
  topHourForScrollY,
  writeGridZoom,
  writeTopHour,
  writeViewportH,
  zoomForHourH,
  type GridZoom,
} from "./grid-memory";

// Vertical scale of the time grid (pixels per hour). The LIVE value is a
// Reanimated shared value (`hourHSv`) owned by the calendar screen: the
// pinch gesture below mutates it on the UI thread, so zooming never touches
// React state mid-gesture. The committed value (`hourH` prop, updated once
// per gesture via onZoom) exists only for render-time derivations.
// Числа и вся математика жеста — в `zoom-math.ts`, там их видит тест.
export { HOUR_H_DEFAULT, HOUR_H_MAX, HOUR_H_MIN } from "./zoom-math";

// МАСШТАБ ЖЕСТА — ДЛЯ ТОГО, ЧТО НЕ ДОЛЖНО ТЯНУТЬСЯ (иначе при щипке цифры часов и
// «16:49» сплющиваются и вытягиваются).
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
//   * release is TWO frames, ordered so that neither RN nor UIKit ever
//     clamps the scroll: growing — the new height lands first under a
//     holding translate, then the scroll moves (RN clamps scrollTo to the
//     content size it has right now); shrinking — the scroll moves first
//     inside the old taller grid, then the height lands (UIKit pulls an
//     offset past the new bottom back on its own — `releaseScrollsFirst`);
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
  view,
  children,
}: {
  hourHSv: SharedValue<number>;
  /** Commit callback — fired ONCE per pinch (on release) with the snapped
   *  pixels-per-hour, so cold layers (slot taps, block text) re-render. */
  onZoom?: (next: number) => void;
  startHour: number;
  endHour: number;
  /** Час открытия (`deriveOpenHour`: «сейчас» или начало работы). Только
   *  пока своего места в этом запуске нет: дальше сетка открывается там, где
   *  её оставили (`grid-memory.ts`), и смена этого числа (свайп на день с
   *  другим графиком, тиканье «сейчас») прокрутку не дёргает. */
  scrollToHour?: number;
  /** Горизонтальный pan пейджера периода (см. pager.tsx) — компонуется
   *  Race'ом с пинчем: один палец вбок = листание, два = зум. */
  pageGesture?: PanGesture;
  /** Запись в режиме правки («Двигать и растягивать»): прокрутка стоит, чтобы
   *  палец на записи двигал её, а не сетку. */
  scrollLocked?: boolean;
  /** «week» | «day» — под ним сетка помнит замер своего экрана. */
  view: string;
  children: ReactNode;
}) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
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
  // сетки — ни одного прогона Yoga на кадр. Анимация height напрямую
  // дала бы полный релэйаут сотен узлов каждый кадр + scrollTo,
  // приземляющийся в соседний кадр, — календарь «трясся» бы под пальцами.
  // Вне жеста следует за hourHSv (fit-пол, смена окна в настройках).
  // ПЕРВЫЙ КАДР — УЖЕ НА МЕСТЕ. Если рисовать сетку с 64 px и прокруткой 0, а
  // масштаб и час графика догонят её после замера, при заходе будет два
  // видимых прыжка. Поэтому масштаб и время берутся из памяти сетки
  // (`grid-memory.ts`) по прошлому замеру экрана, и первый кадр открывается
  // ровно там, где человек был; замер лишь подтверждает его.
  const [boot] = useState(() => {
    const vh = readViewportH(view);
    if (vh == null) return null;
    const h = hourHForZoom(readGridZoom(), endHour - startHour, vh);
    const top = readTopHour() ?? scrollToHour ?? startHour;
    return { vh, h, y: scrollYForTopHour(top, startHour, endHour, h, vh) };
  });
  const layoutH = useSharedValue(boot?.h ?? HOUR_H_DEFAULT);
  const gestureScale = useSharedValue(1);
  const gestureTy = useSharedValue(0);
  const scrollY = useSharedValue(boot?.y ?? 0);
  const scrollY0 = useSharedValue(0);
  useLayoutEffect(() => {
    if (!boot) return;
    hourHSv.value = boot.h;
    onZoom?.(boot.h);
    // Один раз на маунт: дальше масштабом владеют щипок и настройка.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useAnimatedReaction(
    () => hourHSv.value,
    (v) => {
      if (!pinching.value && layoutH.value !== v) layoutH.value = v;
    },
    [],
  );

  // Свежие окно и коллбек — для слушателей, живущих дольше одного рендера.
  const measuredVh = useRef<number | null>(null);
  const latest = useRef({ startHour, endHour, onZoom });
  latest.current = { startHour, endHour, onZoom };

  // Новая высота часа и прокрутка — В ПОРЯДКЕ, КОТОРЫЙ НИКТО НЕ СРЕЖЕТ (тот же
  // закон, что у отпускания щипка, `releaseScrollsFirst`): вверх — сперва
  // прокрутка в старой сетке, вниз — сперва выросшая сетка.
  const applyGeometry = (h: number, y: number) => {
    "worklet";
    if (pinching.value) return;
    const grow = () => {
      hourHSv.value = h;
      layoutH.value = h;
    };
    if (y < scrollY.value) {
      scrollTo(scrollRef, 0, y, false);
      requestAnimationFrame(grow);
    } else {
      grow();
      requestAnimationFrame(() => scrollTo(scrollRef, 0, y, false));
    }
  };

  /** Масштаб из памяти для этого экрана и окна; время у верха — как было. */
  const restore = (vh: number, zoom: GridZoom | null, top: number | null) => {
    const { startHour: s0, endHour: e0, onZoom: commit } = latest.current;
    const h = hourHForZoom(zoom, e0 - s0, vh);
    const y = scrollYForTopHour(
      top ?? readTopHour() ?? scrollToHour ?? s0,
      s0,
      e0,
      h,
      vh,
    );
    runOnUI(applyGeometry)(h, y);
    commit?.(h);
  };

  // Время у верхнего края запоминается, когда прокрутка встала: при смене
  // вида, команды и после перезапуска календарь открывается на нём же.
  const saveTop = (y: number, h: number) => {
    if (h > 0) writeTopHour(topHourForScrollY(y, latest.current.startHour, h));
  };
  useEffect(
    () => () => saveTop(scrollY.value, layoutH.value),
    // Только на уходе: веб не шлёт конца инерции, вид сменился — место то же.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // СМЕНА ОКНА ЧАСОВ НА ЖИВОМ ЭКРАНЕ (настройка, запись за краем недели):
  // время у верхнего края остаётся тем же, «весь день» — снова весь, пол
  // зума поднимается. Прежде прокрутка оставалась прежним числом пикселей, и
  // под ним оказывалось другое время.
  const prevWindow = useRef({ startHour, endHour });
  useLayoutEffect(() => {
    const prev = prevWindow.current;
    if (prev.startHour === startHour && prev.endHour === endHour) return;
    prevWindow.current = { startHour, endHour };
    const vh = viewportH.value;
    if (vh <= 0) return;
    const zoom = readGridZoom();
    const top = topHourForScrollY(scrollY.value, prev.startHour, layoutH.value);
    // Без выбора масштаба держится текущий зум (только не ниже пола).
    const h =
      zoom == null
        ? Math.max(minHourH(endHour - startHour, vh), layoutH.value)
        : hourHForZoom(zoom, endHour - startHour, vh);
    runOnUI(applyGeometry)(
      h,
      scrollYForTopHour(top, startHour, endHour, h, vh),
    );
    if (h !== layoutH.value) onZoom?.(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startHour, endHour]);

  // Выбор в настройке «Масштаб» — сразу на открытой сетке.
  useEffect(
    () =>
      subscribeGridZoom((zoom) => {
        const vh = viewportH.value;
        if (vh <= 0) return;
        const top = topHourForScrollY(
          scrollY.value,
          latest.current.startHour,
          layoutH.value,
        );
        restore(vh, zoom, top);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Щипок отпущен: масштаб запоминается как «сколько часов на экране».
  const commitZoom = (h: number) => {
    const { startHour: s0, endHour: e0, onZoom: commit } = latest.current;
    const vh = viewportH.value;
    if (vh > 0) writeGridZoom(zoomForHourH(h, e0 - s0, vh));
    saveTop(scrollY.value, h);
    commit?.(h);
  };

  const isWeb = Platform.OS === "web";
  // Веб не шлёт ни конца драга, ни конца инерции: там место пишется
  // в паузе прокрутки.
  const webSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onWebScroll = isWeb
    ? () => {
        if (webSaveTimer.current) clearTimeout(webSaveTimer.current);
        webSaveTimer.current = setTimeout(
          () => saveTop(scrollY.value, layoutH.value),
          300,
        );
      }
    : undefined;
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
      if (onWebScroll) runOnJS(onWebScroll)();
    },
    onEndDrag: (e) => {
      runOnJS(saveTop)(e.contentOffset.y, layoutH.value);
    },
    onMomentumEnd: (e) => {
      runOnJS(saveTop)(e.contentOffset.y, layoutH.value);
    },
  });

  // Two fingers down would otherwise ALSO pan the scroll view (iOS scrolls
  // on any touch count) — the native pan and the anchor scrollTo below then
  // fight over the offset. Disabling scroll for the pinch's lifetime keeps
  // exactly one writer.
  //
  // ЗАПРЕТ ПРОКРУТКИ «СВОБОДНОГО ПЕРЕМЕЩЕНИЯ» — В ТОМ ЖЕ ИСТОЧНИКЕ. Запрет
  // обычным пропом `scrollEnabled` рядом с анимированным не работает:
  // Reanimated ставит своё значение поверх, и в режиме правки сетка всё равно
  // едет под пальцем вместо перемещения записи. Одно свойство — одно правило.
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
  // (на симуляторе нужно было 896, встало 174 — старый предел, и после
  // растяжки времени шёл резкий скачок). Поэтому
  // прокрутка дожимается по кадрам, а сдвиг каждый кадр равен недокрученному
  // остатку (`settleStep`): картинка стоит при ЛЮБОМ фактическом offset
  // (событие скролла приходит синхронно внутри `scrollTo`, `scrollY` свежий).
  const settle = (token: number, target: number) => {
    "worklet";
    // Шаг — локальная функция: worklet, зовущий сам себя по имени из
    // замыкания, на UI-рантайме не переносится (первый же повтор роняет
    // приложение).
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
      runOnJS(commitZoom)(layoutH.value);
    };
    step(0, scrollY.value);
  };

  // Упор щипка в край масштаба чувствуется рукой (haptic) — один удар на вход в край, не на каждый кадр.
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
      // Видимая высота часа: если новый жест пришёл между кадрами
      // уменьшения, сетка ещё под масштабом прошлого — отсчёт от того, что видно.
      baseH.value = layoutH.value * gestureScale.value;
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
      gestureScale.value = f.h / layoutH.value;
      gestureTy.value = scrollY0.value - f.offset;
    })
    .onFinalize(() => {
      if (!active.value) return;
      active.value = false;
      const span = endHour - startHour;
      const r = pinchRelease({
        h: hourHSv.value,
        offset: scrollY0.value - gestureTy.value,
        focalY: lastFocalY.value,
        scrollY0: scrollY0.value,
        span,
        vh: viewportH.value,
      });
      hourHSv.value = r.snapped;
      const token = settleToken.value + 1;
      settleToken.value = token;
      // Целая высота уходит в layout, сдвиг держит картинку под ТЕКУЩЕЙ
      // прокруткой; дожим прокрутки — шагом 2.
      const commitLayout = () => {
        "worklet";
        layoutH.value = r.snapped;
        gestureScale.value = 1;
        gestureTy.value = scrollY.value - r.target;
        requestAnimationFrame(() => settle(token, r.target));
      };
      if (releaseScrollsFirst(r.target, scrollY0.value)) {
        // УМЕНЬШЕНИЕ (и любая прокрутка вверх): сперва прокрутка — в старой,
        // более высокой сетке она встаёт без среза, а сдвиг на ту же
        // величину держит картинку. Высота — кадром позже, когда прокрутка
        // уже в пределе новой сетки и UIKit её не тронет.
        scrollTo(scrollRef, 0, r.target, false);
        gestureTy.value -= scrollY0.value - r.target;
        requestAnimationFrame(() => {
          if (settleToken.value === token) commitLayout();
        });
      } else {
        commitLayout();
      }
    });

  const rowStyle = useAnimatedStyle(() => ({
    height: (endHour - startHour) * layoutH.value,
    transform: [
      { translateY: gestureTy.value },
      { scaleY: gestureScale.value },
    ],
  }));

  // ВЕБ: ЩИПОК ДОЛЖЕН УВЕЛИЧИВАТЬ КАЛЕНДАРЬ, А НЕ СТРАНИЦУ.
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
          // Сетка упирается в края окна и НЕ тянется резинкой (упирается в 24:00 и всё) — пустота за последним
          // часом читалась как баг.
          bounces={false}
          overScrollMode="never"
          contentContainerStyle={{
            paddingTop: PAD_TOP,
            paddingBottom: PAD_BOTTOM,
          }}
          onScroll={onScroll}
          animatedProps={scrollProps}
          // Первый кадр — сразу на запомненном времени (натив; веб
          // докручивает на замере).
          contentOffset={boot ? { x: 0, y: boot.y } : undefined}
          onLayout={(e) => {
            const vh = e.nativeEvent.layout.height;
            const prev = measuredVh.current;
            measuredVh.current = vh;
            viewportH.value = vh;
            writeViewportH(view, vh);
            if (prev == null) {
              // Замер подтвердил прошлый — первый кадр уже на месте.
              if (boot && !isWeb && Math.abs(boot.vh - vh) < 0.5) return;
              restore(vh, readGridZoom(), null);
            } else if (Math.abs(prev - vh) >= 0.5) {
              // Экран стал другим (поворот, клавиатура): масштаб «в часах»
              // пересчитывается, время у верха — то же.
              restore(
                vh,
                readGridZoom(),
                topHourForScrollY(scrollY.value, latest.current.startHour, layoutH.value),
              );
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
