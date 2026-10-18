import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWindowDimensions } from "react-native";
import { useSharedValue, withSpring } from "react-native-reanimated";
import type { Appointment } from "@babun/shared/local/appointments";
import { haptics } from "@/lib/haptics";
import { dayShort, minToHM, shiftYmd } from "@/features/calendar/grid-units";

/** Высота зоны края блока, за которую запись растягивают. */
const EDGE_H = 16;

/** Shared values of one block plus the JS side of its move and resize. */
export function useBlockDrag({
  apt,
  startMin,
  endMin,
  winStart,
  winEnd,
  hourH,
  stepMinutes,
  cardH,
  cancelled,
  editing,
  onReschedule,
}: {
  apt: Appointment;
  startMin: number;
  endMin: number;
  winStart: number;
  winEnd: number;
  hourH: number;
  stepMinutes: number;
  cardH: number;
  cancelled: boolean;
  editing: boolean;
  onReschedule?: (a: Appointment, s: string, e: string, date?: string) => void;
}) {
  const ty = useSharedValue(0);
  const active = useSharedValue(0);
  /** 0 — покой, 1 — под пальцем. Гонит заливку и лёгкое сжатие. */
  const press = useSharedValue(0);
  /** Сколько ступеней магнита пройдено от начала переноса. */
  const snapSteps = useSharedValue(0);
  /** Сдвиг по дням в свободном перемещении (в точках, шагом в колонку). */
  const tx = useSharedValue(0);
  const daySteps = useSharedValue(0);
  /** Растяжка за край: смещение верхнего и нижнего края в точках. */
  const topPx = useSharedValue(0);
  const botPx = useSharedValue(0);
  const rSteps = useSharedValue(0);
  /** 0 — перенос, 1 — растяжка верхнего края, 2 — нижнего. */
  const edgeMode = useSharedValue(0);
  /** Где палец коснулся карточки (y от её верха). */
  const touchY = useSharedValue(0);
  // Ступень магнита — полчаса, но не мельче шага сетки команды: у кого сетка
  // по часу, запись прыгает по часу. Клавиатура и диктор ходят по шагу
  // сетки (`moveBy(stepMinutes)`), магнит — только палец.
  const dragStep = Math.max(30, Math.min(60, stepMinutes));
  const screenW = useWindowDimensions().width;
  /** Новое начало, пока запись под пальцем, — пишется на самой карточке. */
  const [liveStart, setLiveStart] = useState<string | null>(null);
  // Переход на другой день чувствуется сильнее шага времени.
  const lastDays = useRef(0);
  const resetDays = () => {
    lastDays.current = 0;
  };
  const onSnap = (steps: number, days = 0) => {
    if (days !== lastDays.current) haptics.edge();
    else haptics.step();
    lastDays.current = days;
    if (steps === 0 && days === 0) {
      setLiveStart(null);
      return;
    }
    // Подпись под пальцем — то, что встанет при отпускании:
    // без того же ограничения она показывала «-1:-30» и «24:30».
    const time = minToHM(
      clampStart(startMin + steps * dragStep, Math.max(15, spanEnd - startMin)),
    );
    setLiveStart(days === 0 ? time : `${dayShort(apt.date, days)} ${time}`);
  };
  const clearLive = () => setLiveStart(null);

  // ПРИЗЕМЛЕНИЕ БЕЗ РЫВКА. Перенос уходит в кэш не в тот же кадр, что отпускание:
  // мутация кладёт новое время через микрозадачи и таймер уведомлений. Если
  // смещение сбросить сразу после `onReschedule`, блок на кадр-два
  // вернётся на СТАРОЕ место и только потом прыгнет на новое. Поэтому
  // смещение держится, пока место блока не сменится (эффект ниже), а если
  // перенос так и не приземлился (отказ, тот же слот), — пружиной домой.
  const landing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awaitLanding = () => {
    if (landing.current) clearTimeout(landing.current);
    landing.current = setTimeout(() => {
      landing.current = null;
      ty.value = withSpring(0);
      tx.value = withSpring(0);
      topPx.value = withSpring(0);
      botPx.value = withSpring(0);
    }, 1500);
  };
  useLayoutEffect(() => {
    if (!landing.current) return;
    clearTimeout(landing.current);
    landing.current = null;
    ty.value = 0;
    tx.value = 0;
    topPx.value = 0;
    botPx.value = 0;
  }, [startMin, endMin, apt.date, ty, tx, topPx, botPx]);
  useEffect(
    () => () => {
      if (landing.current) clearTimeout(landing.current);
    },
    [],
  );

  // КОНЕЦ ЗАПИСИ — НЕ ПОЗЖЕ 23:59. «24:00» у записи не
  // бывает (форма записи и `addMinutesHM` останавливаются на 23:59), а
  // перенос в последний слот дня и растяжка до края писали «24:00»: длина
  // такой записи считалась нулём, «Перенести»/«Копировать» брали окно не той
  // длины, и сегодняшняя неоплаченная запись не становилась долгом.
  const endHM = (min: number) => minToHM(Math.min(min, 23 * 60 + 59));
  // …и обратно: конец 23:59 в арифметике — это конец суток.
  // Иначе длительность выходила на минуту короче: запись 22:00–23:59 при
  // каждом переносе вниз становилась 22:01–23:59, 22:02–23:59…, а растяжка
  // нижнего края на шаг вверх давала 23:44 вместо 23:45.
  const spanEnd = endMin >= 23 * 60 + 59 ? 24 * 60 : endMin;
  /** Начало, которое запись может занять: в окне, но не теснее, чем стоит. */
  const clampStart = (newStart: number, duration: number) => {
    const lo = Math.min(startMin, winStart);
    const hi = Math.max(spanEnd, winEnd) - duration;
    return Math.max(lo, Math.min(hi, newStart));
  };

  const commit = (translationY: number, dayDelta = 0) => {
    if (!onReschedule) {
      ty.value = withSpring(0);
      tx.value = withSpring(0);
      return;
    }
    const duration = Math.max(15, spanEnd - startMin);
    // Base the move on the UNCLAMPED startMin (like moveBy below), not on
    // the clamped visual top: a block clipped by the visible window
    // (e.g. 06:30 with startHour=7) must keep its real start, not get
    // silently pinned to the window edge.
    const step = dragStep;
    const deltaMin =
      Math.round(((translationY / hourH) * 60) / step) * step;
    // Clamp into the window, but never TIGHTER than where the block
    // already sits — a clipped block may legitimately stay clipped.
    const newStart = clampStart(startMin + deltaMin, duration);
    if (newStart === startMin && dayDelta === 0) {
      // Некуда двигать — мягко возвращаем карточку на место.
      ty.value = withSpring(0);
      tx.value = withSpring(0);
      return;
    }
    onReschedule(
      apt,
      minToHM(newStart),
      endHM(newStart + duration),
      dayDelta === 0 ? undefined : shiftYmd(apt.date, dayDelta),
    );
    // Смещение сбросит приземление — когда блок встанет на новый слот.
    awaitLanding();
  };

  const moveBy = (deltaMin: number) => {
    if (!onReschedule) return;
    const duration = Math.max(15, spanEnd - startMin);
    const newStart = clampStart(startMin + deltaMin, duration);
    if (newStart === startMin) return;
    onReschedule(apt, minToHM(newStart), endHM(newStart + duration));
  };

  // ═══ РАСТЯЖКА ЗА КРАЙ ═══
  // Нижний край двигает конец, верхний — начало. Тот же жест, что перенос
  // (удержание 300 мс, потом тянуть), — обычная прокрутка сетки по краю в
  // растяжку не превращается. Шаг — сетка команды (15 мин), со щелчком на
  // каждой ступени; короче 15 минут запись не становится.
  // Тянуть можно любую запись от 24pt — и получасовой перерыв при обычном
  // масштабе. Зона края у короткой записи пропорционально меньше (не больше
  // трети высоты), чтобы середина, за которую переносят, оставалась.
  const canResize = editing && !!onReschedule && !cancelled && cardH >= 24;
  const edgeH = Math.min(EDGE_H, cardH / 3);
  const resizeStep = Math.max(15, Math.min(60, stepMinutes));
  const durMin = Math.max(resizeStep, spanEnd - startMin);
  const maxShrink = Math.floor((durMin - resizeStep) / resizeStep);
  const onResizeSnap = (edge: "top" | "bottom", steps: number) => {
    haptics.step();
    const s0 = Math.max(0, edge === "top" ? startMin + steps * resizeStep : startMin);
    const e0 = edge === "bottom" ? spanEnd + steps * resizeStep : spanEnd;
    setLiveStart(`${minToHM(s0)}–${endHM(e0)}`);
  };
  const commitResize = (edge: "top" | "bottom", steps: number) => {
    setLiveStart(null);
    const reset = () => {
      topPx.value = withSpring(0);
      botPx.value = withSpring(0);
    };
    if (!onReschedule || steps === 0) {
      reset();
      return;
    }
    // За край суток — до края, а не откат: подпись
    // во время растяжки уже показывала «–23:59» / «00:00», а на отпускании
    // запись молча прыгала обратно. Перенос клампится так же (`clampStart`).
    const ns = Math.max(0, edge === "top" ? startMin + steps * resizeStep : startMin);
    const ne = Math.min(24 * 60, edge === "bottom" ? spanEnd + steps * resizeStep : spanEnd);
    if ((ns === startMin && ne === spanEnd) || ne - ns < resizeStep) {
      reset();
      return;
    }
    onReschedule(apt, minToHM(ns), endHM(ne));
    // Края сбросит приземление — когда блок встанет в новую высоту.
    awaitLanding();
  };

  return {
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
    liveStart,
    resetDays,
    onSnap,
    clearLive,
    commit,
    moveBy,
    canResize,
    edgeH,
    resizeStep,
    maxShrink,
    onResizeSnap,
    commitResize,
  };
}

export type BlockDrag = ReturnType<typeof useBlockDrag>;
