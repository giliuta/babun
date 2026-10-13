import { useEffect } from "react";
import { Gesture } from "react-native-gesture-handler";
import { runOnJS, withSpring, withTiming } from "react-native-reanimated";
import type { Appointment } from "@babun/shared/local/appointments";
import { haptics } from "@/lib/haptics";
import { RAIL_W } from "@/features/calendar/grid-units";
import type { BlockDrag } from "./use-block-drag";

/** Зона у края экрана, где перетаскивание уходит в соседнюю неделю. */
const EDGE_PAGE = 28;

/** The block's gesture: tap / long-press menu at rest, pan in edit mode. */
export function useBlockGesture({
  drag,
  apt,
  cardH,
  hourH,
  dayW,
  editing,
  onEdit,
  onMenu,
  onReschedule,
}: {
  drag: BlockDrag;
  apt: Appointment;
  cardH: number;
  hourH: number;
  dayW?: number;
  editing: boolean;
  onEdit: (a: Appointment) => void;
  onMenu?: (a: Appointment) => void;
  onReschedule?: (a: Appointment, s: string, e: string, date?: string) => void;
}) {
  // Plain locals: the gesture worklets capture values, not the `drag` bag.
  const {
    ty,
    active,
    press,
    snapSteps,
    tx,
    daySteps,
    topPx,
    botPx,
    rSteps,
    edgeMode,
    touchY,
    dragStep,
    screenW,
    resetDays,
    onSnap,
    clearLive,
    commit,
    canResize,
    edgeH,
    resizeStep,
    maxShrink,
    onResizeSnap,
    commitResize,
  } = drag;

  const pan = Gesture.Pan()
    // В режиме правки палец двигает запись сразу — сетка при этом не
    // прокручивается (`scrollLocked`), путаницы жестов нет.
    .minDistance(2)
    // Режим решает ТОЧКА КАСАНИЯ, а не место активации: за первый кадр
    // движения палец успевает уйти на десяток точек, и у короткой записи
    // середина «переезжала» в зону нижнего края (поймано на симуляторе).
    .onBegin((e) => {
      touchY.value = e.y;
    })
    .onStart(() => {
      active.value = withSpring(1);
      snapSteps.value = 0;
      runOnJS(resetDays)();
      daySteps.value = 0;
      rSteps.value = 0;
      // РЕЖИМ — ПО МЕСТУ КАСАНИЯ, одним жестом: нижний край растягивает
      // конец, верхний — начало, середина переносит.
      edgeMode.value =
        canResize && touchY.value >= cardH - edgeH
          ? 2
          : canResize && cardH >= 40 && touchY.value <= edgeH
            ? 1
            : 0;
    })
    .onUpdate((e) => {
      if (edgeMode.value !== 0) {
        const edge = edgeMode.value === 1 ? "top" : "bottom";
        const stepPx = (resizeStep / 60) * hourH;
        let steps = Math.round(e.translationY / stepPx);
        // Сжиматься можно до одной ступени; расти — сколько угодно.
        if (edge === "bottom") steps = Math.max(-maxShrink, steps);
        else steps = Math.min(maxShrink, steps);
        if (edge === "top") topPx.value = steps * stepPx;
        else botPx.value = steps * stepPx;
        if (steps !== rSteps.value) {
          rSteps.value = steps;
          runOnJS(onResizeSnap)(edge, steps);
        }
        return;
      }
      // МАГНИТ (владелец 2026-09-24: «прикольная штука»): карточка не
      // плывёт за пальцем, а прыгает по ступеням `dragStep` (полчаса), и
      // каждый переход отзывается щелчком — попасть в нужное время можно,
      // не глядя на рельс. На мелком масштабе (28pt в час) палец иначе
      // промахивался мимо слота.
      const stepPx = (dragStep / 60) * hourH;
      const steps = Math.round(e.translationY / stepPx);
      ty.value = steps * stepPx;
      // ПО ДНЯМ — шагом в колонку (свободное перемещение, владелец 24.09:
      // «между днями полностью как угодно; вправо сильно — перелистнёт на
      // следующую неделю»). За край недели запись уходит в соседнюю.
      let days = dayW ? Math.round(e.translationX / dayW) : 0;
      // КРАЙ ЭКРАНА = СОСЕДНЯЯ НЕДЕЛЯ: дальше воскресенья тянуть некуда,
      // поэтому палец у правого края ставит запись на день ПОСЛЕ последней
      // видимой колонки (у левого, за рельсом времени, — на день до первой).
      //
      // …НО ТОЛЬКО КОГДА ПАЛЕЦ ТУДА ПРИВЕЛИ (аудит 2026-10-03). Край считался
      // по месту пальца, а не по движению: запись воскресенья, взятая в
      // правых 28pt (больше половины узкой колонки), уезжала на понедельник
      // следующей недели при движении строго вниз.
      const edgeMove = dayW ? Math.max(12, dayW * 0.3) : 0;
      if (dayW && e.translationX > edgeMove && e.absoluteX > screenW - EDGE_PAGE) days += 1;
      else if (dayW && e.translationX < -edgeMove && e.absoluteX < RAIL_W + EDGE_PAGE / 2) days -= 1;
      tx.value = days * (dayW ?? 0);
      if (steps !== snapSteps.value || days !== daySteps.value) {
        snapSteps.value = steps;
        daySteps.value = days;
        runOnJS(onSnap)(steps, days);
      }
    })
    .onEnd((e, success) => {
      // ЖЕСТ ОТМЕНИЛА СИСТЕМА (звонок, баннер, системный свайп) — это не
      // «отпустил»: RNGH зовёт onEnd с success=false, и перенос с последним
      // смещением уходил в базу сам (аудит 2026-10-03). Карточка — домой.
      if (!success) {
        edgeMode.value = 0;
        ty.value = withSpring(0);
        tx.value = withSpring(0);
        topPx.value = withSpring(0);
        botPx.value = withSpring(0);
        runOnJS(clearLive)();
        active.value = withSpring(0);
        return;
      }
      if (edgeMode.value !== 0) {
        runOnJS(commitResize)(edgeMode.value === 1 ? "top" : "bottom", rSteps.value);
        edgeMode.value = 0;
        active.value = withSpring(0);
        return;
      }
      // Отпустил, не сдвинув (<8px) — это «подержал» → контекстное меню
      // (web ActionMenuModal). Сдвинул — перенос: сброс ty решает commit
      // на JS (перенос состоялся → мгновенно, база уже переписана
      // оптимистически; нет → пружиной домой).
      if (Math.abs(e.translationY) < 8 && daySteps.value === 0) {
        ty.value = withSpring(0);
        tx.value = withSpring(0);
      } else {
        runOnJS(commit)(e.translationY, daySteps.value);
      }
      runOnJS(clearLive)();
      active.value = withSpring(0);
    })
    // Жест отменён системой (звонок, пейджер) — подпись времени не должна
    // остаться висеть на карточке.
    .onFinalize(() => {
      runOnJS(clearLive)();
    });
  // Мгновенный отклик на обычный тап (iOS-подсветка): лёгкое притухание
  // с onBegin, возврат в onFinalize — раньше блок «молчал» до открытия шита.
  // maxDuration не задаём: до порога long-press отпускание — всегда тап,
  // после — pan уже активен и Exclusive отменяет tap сам; явный
  // maxDuration(250) оставлял мёртвое окно 250–300 мс без реакции.
  // Смена режима (вход/выход из свободного перемещения) пересобирает жесты —
  // незавершённое нажатие не должно пережить её.
  useEffect(() => {
    press.value = withTiming(0, { duration: 120 });
  }, [editing, press]);
  // Касание записи ощущается рукой (владелец 04.10) — тик до открытия.
  const openWithTick = (a: Appointment) => {
    haptics.tap();
    onEdit(a);
  };
  const tap = Gesture.Tap()
    .onBegin(() => {
      press.value = withTiming(1, { duration: 90 });
    })
    .onFinalize(() => {
      press.value = withTiming(0, { duration: 150 });
    })
    .onEnd(() => runOnJS(openWithTick)(apt));
  // A crew member still gets the useful long-press actions (next status,
  // call, route), but never enters the drag gesture that the server rejects.
  const longPress = Gesture.LongPress()
    .minDuration(300)
    .onStart(() => {
      // Долгое нажатие перехватило тап — его «притухание» гасим сразу:
      // жест дальше перестраивается под меню/перемещение, и onFinalize тапа
      // до карточки уже не доходит (карточка оставалась уменьшенной).
      press.value = withTiming(0, { duration: 120 });
      if (onMenu) runOnJS(onMenu)(apt);
    });
  // В ПОКОЕ ЗАПИСЬ ЗАКРЕПЛЕНА: тап открывает, долгое нажатие — меню.
  // Тащить и тянуть — только в режиме правки, который включает пункт меню.
  const gesture = editing && onReschedule
    ? pan
    : onMenu
      ? Gesture.Exclusive(longPress, tap)
      : tap;
  return gesture;
}
