import { memo, useState } from "react";
import { Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Check } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { STATUS_LABELS } from "@babun/shared/local/appointments";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import type { PlacedAppt } from "@/features/calendar/layout";
import {
  blockEdge,
  CANCELLED_BORDER,
  type BlockColors,
} from "@/features/calendar/status-colors";
import {
  blockLadder,
  NAME_MIN_SCALE,
  nameShrinkFits,
  rowsThatFit,
} from "@/features/calendar/block-geometry";
import { BLOCK_TEXT, fillRgba } from "@/components/ui/color-contrast";
import { blockPropsEqual } from "@/features/calendar/grid-memo";
import {
  dayShort,
  GAP,
  MIN_H,
  minToHM,
  pct,
  RAIL_W,
  shiftYmd,
} from "@/features/calendar/grid-units";

// БЛОК ЗАПИСИ НА СЕТКЕ — вынесен из DayView.tsx 24.09 (файл вырос за 2000
// строк). Поведение не менялось: плотный цвет, лестница содержимого, меню по
// долгому нажатию, свободное перемещение (перенос по получасам и дням,
// растяжка за край) только в режиме правки.

/** Высота зоны края блока, за которую запись растягивают. */
const EDGE_H = 16;
/** Зона у края экрана, где перетаскивание уходит в соседнюю неделю. */
const EDGE_PAGE = 28;
/** Блик плотного блока: высота плёнки от верха и её белизна. ВОСЕМЬ ТОНКИХ
 *  ПЛЁНОК ВМЕСТО ТРЁХ (24.09): три плёнки по 5–7 % давали на широкой
 *  карточке Дня три заметные полосы — ровно по строкам имени, времени и
 *  услуги. Восемь по 2.3 % до той же глубины 52 % дают ту же силу блика
 *  сверху (≈17 %), но ступень в 2.3 % глаз уже не видит — перелив плавный. */
const GLASS: readonly (readonly [`${number}%`, number])[] = [
  6.5, 13, 19.5, 26, 32.5, 39, 45.5, 52,
].map((h) => [`${h}%` as const, 0.023] as const);

// `memo` со сравнением размещения по содержимому (`blockPropsEqual`): перенос
// одной записи пересоздаёт размещения всей колонки, а перерисовать надо только
// сдвинутый блок. Замыкания жестов ниже читают лишь пропсы — при равных пропсах
// прошлое замыкание держит те же значения, а обработчики экрана приходят
// обёрткой, которая сама зовёт свежую функцию.
export const AppointmentBlock = memo(function AppointmentBlock({
  placed,
  hourH,
  laneW,
  startHour,
  endHour,
  stepMinutes,
  colors,
  offLabelColor,
  label,
  service,
  address,
  lineH,
  overdue = false,
  editing = false,
  dayW,
  onEdit,
  onMenu,
  onReschedule,
}: {
  placed: PlacedAppt;
  /** Committed pixels-per-hour — px math (drag snap, text fit) only;
   *  the on-screen geometry is percent-based and zoom-independent. */
  hourH: number;
  laneW: number;
  startHour: number;
  endHour: number;
  stepMinutes: number;
  colors: BlockColors;
  /** Цвет чужой метки: точка в правом нижнем углу, затемнённая против
   *  ЗАЛИВКИ блока. null — метка своя. */
  offLabelColor: string | null;
  /** Высота строки текста при текущем системном шрифте. Считается ОДИН раз в
   *  колонке: `useWindowDimensions` внутри каждого из полутора сотен блоков
   *  недели стоил бы кадра. */
  lineH: number;
  label: string;
  service: string | null;
  /** Куда ехать: снимок адреса записи, иначе адрес клиента. null — адреса
   *  нет, и тогда оранжевый блок «нет объекта» называет дыру пустотой. */
  address: string | null;
  /** Запланирована, а время уже прошло — незакрытая работа, то есть
   *  недополученные деньги. Сигнал ОДИН: кант вдвое толще (2pt против 1). Ни
   *  своего цвета, ни углового знака у просрочки нет — кант остаётся цветом
   *  записи, а почему именно так, объяснено в `status-colors`. */
  overdue?: boolean;
  /** Запись в режиме правки («Двигать и растягивать» из меню): только тогда
   *  её можно тащить и тянуть за края. В покое запись закреплена. */
  editing?: boolean;
  /** Ширина колонки дня в Неделе: в свободном перемещении запись ходит и
   *  по дням — шагом в колонку. В Дне не задана: там одна колонка. */
  dayW?: number;
  onEdit: (a: Appointment) => void;
  /** Долгое нажатие — меню записи. Двигать и растягивать — только после
   *  выбора этого в меню (владелец 2026-09-24: «просто так тянуть нельзя,
   *  она зафиксирована; зажимаешь — окно, выбрал — тогда можно»). */
  onMenu?: (a: Appointment) => void;
  /** Undefined for crew: the block stays tappable but has no drag affordance. */
  onReschedule?: (a: Appointment, s: string, e: string, date?: string) => void;
}) {
  const t = useThemeColors();
  const { apt, startMin, endMin, colIndex, colCount } = placed;
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
  const onSnap = (steps: number, days = 0) => {
    haptics.tap();
    if (steps === 0 && days === 0) {
      setLiveStart(null);
      return;
    }
    const time = minToHM(startMin + steps * dragStep);
    setLiveStart(days === 0 ? time : `${dayShort(apt.date, days)} ${time}`);
  };
  const clearLive = () => setLiveStart(null);

  const winStart = startHour * 60;
  const winEnd = endHour * 60;
  const totalMin = winEnd - winStart;
  // Clamp into the visible window (web windowStart/windowEnd semantics):
  // a block starting before the window pins to the top instead of getting
  // a negative top and vanishing above the grid.
  const visStart = Math.max(startMin, winStart);
  const visEnd = Math.min(endMin, winEnd);
  const colW = laneW / colCount;
  const left = colIndex * colW + 1;
  const width = colW - GAP;
  const cancelled = apt.status === "cancelled";
  const completed = apt.status === "completed";
  // ═══ ГЕОМЕТРИЯ И ЦВЕТ БЛОКА ═══
  // Всё считается арифметикой от ширины и высоты, а не флагом «компактный»:
  // блок недели и блок дня — один и тот же блок при разной ширине.
  const cardH = Math.max(MIN_H(lineH), ((visEnd - visStart) / 60) * hourH) - 2;
  // Третья ступень паддинга (3pt) в колонке недели уже 60pt — как у чипов
  // «весь день» (`chipPad`): имя из шести букв («Андрей») влезает целиком,
  // а не обрывается на «Андре».
  const pad = width >= 96 ? 6 : width >= 60 ? 4 : 3;
  // ТОЛЩИНА — ВЕСЬ СИГНАЛ ПРОСРОЧКИ, И ЭТО ЕДИНСТВЕННЫЙ КАНАЛ, КОТОРЫЙ
  // УСИЛИВАЕТСЯ ПРИ СУЖЕНИИ. Кант 1 → 2pt меняет долю канта в площади плитки:
  // 21pt (две наложенные записи в Неделе) 13.6 % → 26.4 %, неделя 46pt
  // 8.7 % → 17.0 %, день 330pt 5.1 % → 10.2 %. То есть канал работает ровно
  // там, где знака нет (markSize 0 при ширине < 40), и слабеет там, где есть
  // текст. Геометрия не меняется ни при дейтеранопии, ни при перекраске
  // палитры владельцем — в отличие от любого оттенка.
  // КОНТУР 1.5pt У КАЖДОГО БЛОКА (владелец 2026-09-24, вариант 3 второй
  // итерации: «контур добавить, насыщенность»): тёмный тон своего же цвета
  // отделяет соседние записи и даёт плотной заливке край. Просрочка — на
  // точку толще и почти чёрным тоном (`blockEdge`).
  const bw = overdue ? 2.5 : 1.5;
  const markSize = width >= 96 ? 14 : width >= 40 ? 8 : 0;
  // Место под знак резервирует ТОЛЬКО выполненная: у просрочки знака нет.
  // Пока его резервировала и она, просроченный блок недели на экране 393pt
  // давал textW 22.3 при гейте 24 — то есть был НЕМЫМ, без имени клиента.
  const markReserve = markSize > 0 && completed ? markSize + 4 : 0;
  // Внутренняя ширина НЕ зависит от толщины канта: компенсация паддинга ниже
  // (`pad - (bw - 1)`) гасит лишний кант ровно, поэтому вычитаем 2, а не 2·bw.
  const textW = width - 2 * pad - 2 - markReserve;
  // ЧЕСТНЫЙ СЧЁТЧИК СТРОК. Обвязка карточки постоянна и равна 6pt: кант сверху
  // и снизу плюс вертикальный паддинг (при bw 1 это 2+4, при bw 2 — 4+2).
  // Значит n строк ФИЗИЧЕСКИ помещаются при cardH ≥ 6 + n·lineH.
  const rowsFit = rowsThatFit(cardH, lineH);
  // СТРОКА ЛИБО НАРИСОВАНА ЦЕЛИКОМ, ЛИБО ЕЁ НЕТ. Прежняя формула
  // `floor((cardH − 9) / lineH) + 1` пускала строку, когда до неё не хватало
  // почти целой: получасовая запись при обычном зуме (высота 28) получала две
  // строки на место под одну, и время рисовалось разрезанным пополам обрезкой
  // карточки. Половина цифры хуже отсутствующей цифры, а время у записи и без
  // того названо рельсом слева и позицией блока — потому имя и стоит первым.
  // Единица снизу остаётся: у самого низкого блока имя пытается напечататься
  // всегда, как было.
  // ЛЕСТНИЦА — ЧИСТОЙ ФУНКЦИЕЙ ПОД ТЕСТОМ (`blockLadder`): имя (в узком блоке
  // — имя и фамилия двумя строками), время, услуга, адрес — сколько влезает.
  // Потолка в три строки и гейта ширины 120pt у услуги с адресом больше нет:
  // владелец хочет, чтобы в блок «больше влазило».
  const nameWords = label.trim().split(/\s+/);
  const ladder = blockLadder({
    rowsFit,
    textW,
    nameWords: nameWords.length,
    hasService: !!service,
    hasAddress: !!address,
  });
  const nameParts =
    ladder.nameRows === 2
      ? [nameWords[0], nameWords.slice(1).join(" ")]
      : [label];
  const { showService, showAddress, lastRow } = ladder;
  // ТОЧКУ ЧУЖОЙ МЕТКИ ОБХОДИТ ПОСЛЕДНЯЯ СТРОКА, КАКОЙ БЫ ОНА НИ БЫЛА. Точка
  // лежит абсолютно в правом нижнем углу; раньше отступ был вшит только в
  // адрес, и на карточке, где последней осталась услуга (или время), её хвост
  // заезжал под точку.
  const dotReserve =
    offLabelColor && markSize > 0 && cardH >= (completed ? 30 : 20) ? 12 : 0;

  // КАНТ ЗАБИРАЕТ ТОЛЬКО ОТМЕНЁННАЯ — правило и его гейт в `status-colors`.
  const edge = blockEdge(colors, apt.status, overdue);
  // РАЗОМКНУТЫЙ КАНТ = РАБОТЫ НЕ БУДЕТ. Кант — единственный слой блока, который
  // рисуется ВСЕГДА: текста нет при textW < 24 (наложение в Неделе даёт 11),
  // углового знака нет при ширине < 40. Цвет канта занят категорией, толщина —
  // просрочкой; свободен ровно стиль линии. Зачёркивание имени, которым отмена
  // говорила до сих пор, живёт только там, где имя влезает.
  const edgeStyle = cancelled ? CANCELLED_BORDER : "solid";

  const commit = (translationY: number, dayDelta = 0) => {
    if (!onReschedule) {
      ty.value = withSpring(0);
      tx.value = withSpring(0);
      return;
    }
    const duration = Math.max(15, endMin - startMin);
    // Base the move on the UNCLAMPED startMin (like moveBy below), not on
    // the clamped visual top: a block clipped by the visible window
    // (e.g. 06:30 with startHour=7) must keep its real start, not get
    // silently pinned to the window edge.
    const step = dragStep;
    const deltaMin =
      Math.round(((translationY / hourH) * 60) / step) * step;
    let newStart = startMin + deltaMin;
    // Clamp into the window, but never TIGHTER than where the block
    // already sits — a clipped block may legitimately stay clipped.
    const lo = Math.min(startMin, winStart);
    const hi = Math.max(endMin, winEnd) - duration;
    newStart = Math.max(lo, Math.min(hi, newStart));
    if (newStart === startMin && dayDelta === 0) {
      // Некуда двигать — мягко возвращаем карточку на место.
      ty.value = withSpring(0);
      tx.value = withSpring(0);
      return;
    }
    onReschedule(
      apt,
      minToHM(newStart),
      minToHM(newStart + duration),
      dayDelta === 0 ? undefined : shiftYmd(apt.date, dayDelta),
    );
    // Оптимистический кеш переписан синхронно внутри onReschedule → база
    // блока уже на новом слоте. Мгновенный сброс смещения приземляется тем
    // же кадром — блок остаётся под пальцем.
    ty.value = 0;
    tx.value = 0;
  };

  const moveBy = (deltaMin: number) => {
    if (!onReschedule) return;
    const duration = Math.max(15, endMin - startMin);
    let newStart = startMin + deltaMin;
    const lo = Math.min(startMin, winStart);
    const hi = Math.max(endMin, winEnd) - duration;
    newStart = Math.max(lo, Math.min(hi, newStart));
    if (newStart === startMin) return;
    onReschedule(apt, minToHM(newStart), minToHM(newStart + duration));
  };

  // ═══ РАСТЯЖКА ЗА КРАЙ (владелец 2026-09-24: «запись растягивать по
  // времени — тянуть вниз, увеличивать, если тянуть вверх») ═══
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
  const durMin = Math.max(resizeStep, endMin - startMin);
  const maxShrink = Math.floor((durMin - resizeStep) / resizeStep);
  const onResizeSnap = (edge: "top" | "bottom", steps: number) => {
    haptics.tap();
    const s0 = edge === "top" ? startMin + steps * resizeStep : startMin;
    const e0 = edge === "bottom" ? endMin + steps * resizeStep : endMin;
    setLiveStart(`${minToHM(s0)}–${minToHM(e0)}`);
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
    const ns = edge === "top" ? startMin + steps * resizeStep : startMin;
    const ne = edge === "bottom" ? endMin + steps * resizeStep : endMin;
    if (ns < 0 || ne > 24 * 60 || ne - ns < resizeStep) {
      reset();
      return;
    }
    onReschedule(apt, minToHM(ns), minToHM(ne));
    // Оптимистический кэш уже перерисовал блок новой высоты — смещения
    // сбрасываются тем же кадром, без пружины назад.
    topPx.value = 0;
    botPx.value = 0;
  };

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
      if (dayW && e.absoluteX > screenW - EDGE_PAGE) days += 1;
      else if (dayW && e.absoluteX < RAIL_W + EDGE_PAGE / 2) days -= 1;
      tx.value = days * (dayW ?? 0);
      if (steps !== snapSteps.value || days !== daySteps.value) {
        snapSteps.value = steps;
        daySteps.value = days;
        runOnJS(onSnap)(steps, days);
      }
    })
    .onEnd((e) => {
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
  const tap = Gesture.Tap()
    .onBegin(() => {
      press.value = withTiming(1, { duration: 90 });
    })
    .onFinalize(() => {
      press.value = withTiming(0, { duration: 150 });
    })
    .onEnd(() => runOnJS(onEdit)(apt));
  // A crew member still gets the useful long-press actions (next status,
  // call, route), but never enters the drag gesture that the server rejects.
  const longPress = Gesture.LongPress()
    .minDuration(300)
    .onStart(() => {
      if (onMenu) runOnJS(onMenu)(apt);
    });
  // В ПОКОЕ ЗАПИСЬ ЗАКРЕПЛЕНА: тап открывает, долгое нажатие — меню.
  // Тащить и тянуть — только в режиме правки, который включает пункт меню.
  const gesture = editing && onReschedule
    ? pan
    : onMenu
      ? Gesture.Exclusive(longPress, tap)
      : tap;


  // The wrapper owns position + stacking (zIndex must live among siblings);
  // the card owns the drag transform + shadow, so the wrapper's percent
  // geometry stays untouched by the gesture springs.
  // ТЕНЬ ПЕРЕТАСКИВАНИЯ — НА ОБЁРТКЕ. На карточке она рисовалась под
  // `overflow: "hidden"` и не была видна ни разу.
  // ЦВЕТНАЯ ТЕНЬ (вариант 5, 24.09): плотный блок «парит» над сеткой своим
  // же тоном; под пальцем тень глубже. У отменённой тени нет — ей некуда
  // ехать, и выпуклость её бы выделяла.
  const shadowTone = cancelled ? "#000" : colors.solid;
  const restShadow = cancelled ? 0 : 0.35;
  const wrapperStyle = useAnimatedStyle(() => ({
    zIndex: active.value > 0 || editing ? 20 : 1,
    shadowColor: shadowTone,
    shadowOpacity: Math.max(restShadow, active.value * 0.45),
    shadowRadius: 4 + active.value * 6,
    shadowOffset: { width: 0, height: 2 + active.value * 2 },
  }));
  // ОТКЛИК — ЗАЛИВКОЙ И МАСШТАБОМ, А НЕ ПРОЗРАЧНОСТЬЮ. Прежний `opacity`
  // гасил и текст, и заставлял iOS рисовать слой offscreen на 21 колонке; к
  // тому же он перетирал `opacity: 0.55` отменённой, то есть тот сигнал не
  // работал вовсе. Заливка под пальцем — 40 %: имя и время на ней читаются
  // (измерено, 5.81 : 1 и 4.85 : 1 в худшем цвете палитры).
  // ПЛОТНАЯ ЗАЛИВКА (владелец 2026-09-24, вариант 7): блок — сам цвет записи,
  // затемнённый ровно до читаемого белого имени; сквозь него больше не
  // просвечивают ни часовые линии, ни линия «сейчас». Выполненная носит ту же
  // заливку и белую галку; отменённая по-прежнему теряет цвет.
  const fillIdle = cancelled ? fillRgba(t.ink, 0.0784) : colors.solid;
  const fillPressed = cancelled ? fillRgba(t.ink, 0.2) : colors.pressed;
  const nameColor = cancelled ? t.ink : BLOCK_TEXT;
  const subColor = cancelled ? t.body : BLOCK_TEXT;
  // У ОТМЕНЁННОЙ ЗАЛИВКА НЕ АНИМИРУЕТСЯ. Разомкнутый кант выбивает вью из
  // быстрого пути отрисовки, и смена фона заставляла бы iOS перерисовывать
  // картинку канта каждый кадр нажатия. Отклик у неё остаётся масштабом —
  // отменённую и не открывают так часто, чтобы платить за это кадрами.
  const cardStyle = useAnimatedStyle(() => ({
    top: topPx.value,
    bottom: 2 - botPx.value,
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: (1 + active.value * 0.03) * (1 - press.value * 0.03) },
    ],
    backgroundColor: cancelled
      ? fillIdle
      : interpolateColor(press.value, [0, 1], [fillIdle, fillPressed]),
  }));


  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        // Адрес читается ВСЕГДА: озвучке недоступны ни ширина блока, ни его
        // высота, и гейты вёрстки для неё не существуют.
        accessibilityLabel={`${apt.time_start}–${apt.time_end}, ${label}, ${STATUS_LABELS[apt.status]}${overdue ? ", не закрыта" : ""}${address ? `, ${address}` : ""}`}
        accessibilityActions={
          onReschedule
            ? [
                { name: "activate", label: "Открыть" },
                { name: "increment", label: `Позже на ${stepMinutes} минут` },
                { name: "decrement", label: `Раньше на ${stepMinutes} минут` },
              ]
            : [{ name: "activate", label: "Открыть" }]
        }
        onAccessibilityAction={(e) => {
          const action = e.nativeEvent.actionName;
          if (action === "activate") onEdit(apt);
          else if (onReschedule && action === "increment") moveBy(stepMinutes);
          else if (onReschedule && action === "decrement") moveBy(-stepMinutes);
        }}
        style={[
          {
            position: "absolute",
            left,
            width,
            top: pct(visStart - winStart, totalMin),
            height: pct(visEnd - visStart, totalMin),
            // 24px wrapper ⇒ 22px card (bottom:2) — the old readable
            // minimum for micro-appointments at low zoom.
            minHeight: 24,
          },
          wrapperStyle,
        ]}
      >
        <Animated.View
          style={[
            {
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              // 2pt дыхания до следующего блока.
              bottom: 2,
              // КАНТ ПО ВСЕМУ ПЕРИМЕТРУ ВМЕСТО ЛЕВОГО КОРЕШКА (владелец
              // 2026-09-05: «когда слева только полосочка — это полная
              // хрень»). Заливка отвечает за группировку, кант — за
              // категорию: при 18 % оттенки различаются слишком слабо, чтобы
              // называть ими сущности, а кант в полную силу разводит те же
              // пары даже при дальтонизме.
              borderWidth: bw,
              borderColor: edge,
              borderStyle: edgeStyle,
              // Кант входит в бокс-модель RN: без компенсации толстый кант
              // просрочки съедал бы строку текста.
              paddingHorizontal: pad - (bw - 1),
              paddingVertical: 2 - (bw - 1),
              borderRadius: t.radius.card,
              borderCurve: "continuous",
              overflow: "hidden",
            },
            cardStyle,
          ]}
        >
          {/* РУЧКА РАСТЯЖКИ — видно, что нижний край тянется. Сам край ловит
              общий жест карточки (`edgeMode`), ручка касаний не принимает. */}
          {canResize
            ? (cardH >= 40 ? (["top", "bottom"] as const) : (["bottom"] as const)).map(
                (edge) => (
                  <View
                    key={edge}
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      [edge]: 3,
                      left: 0,
                      right: 0,
                      alignItems: "center",
                    }}
                  >
                    <View
                      style={{
                        width: 22,
                        height: 4,
                        borderRadius: 999,
                        backgroundColor: "rgba(255,255,255,0.9)",
                      }}
                    />
                  </View>
                ),
              )
            : null}
          {/* БЛИК СВЕРХУ (вариант 5, 24.09): три плёнки белого 7→5 % дают
              плавный объём без градиентной библиотеки (её нативный модуль
              потребовал бы пересборки клиента). Под текстом, касаний не
              принимает; у отменённой блика нет. */}
          {cancelled
            ? null
            : GLASS.map(([h, a]) => (
                <View
                  key={h}
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: h,
                    backgroundColor: `rgba(255,255,255,${a})`,
                  }}
                />
              ))}
          {/* НОВОЕ ВРЕМЯ — ПРЯМО НА КАРТОЧКЕ, пока она под пальцем: рельс
              слева далеко от пальца, а магнит щёлкает по получасам. */}
          {liveStart ? (
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                zIndex: 2,
                paddingHorizontal: 5,
                borderRadius: t.radius.card,
                backgroundColor: "rgba(11,18,32,0.78)",
              }}
            >
              <Text
                maxFontSizeMultiplier={1.2}
                style={{
                  color: BLOCK_TEXT,
                  fontSize: 13,
                  lineHeight: 18,
                  fontWeight: "700",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {liveStart}
              </Text>
            </View>
          ) : null}
          {/* ЛЕСТНИЦА СОДЕРЖИМОГО: имя → время → услуга → адрес. Имя первым, потому
              что время уже названо рельсом слева и позицией блока, а имя не
              выводится ниоткуда. Кегль 13 — типографический пол продукта;
              девятка, которой неделя набиралась раньше, была нечитаема.
              Лестница только ДОПИСЫВАЕТСЯ вниз и никогда не переставляется:
              при щипке глаз не должен терять якорь. */}
          {textW >= 24
            ? nameParts.map((part, i) => (
                <Text
                  key={i}
                  style={{
                    color: nameColor,
                    fontSize: 13,
                    lineHeight: lineH,
                    fontWeight: "700",
                    marginRight: Math.max(
                      i === 0 ? markReserve : 0,
                      lastRow === "name" && i === nameParts.length - 1
                        ? dotReserve
                        : 0,
                    ),
                    textDecorationLine: cancelled ? "line-through" : "none",
                  }}
                  numberOfLines={1}
                  // УЗКАЯ КАРТОЧКА: КОРОТКОЕ ИМЯ СЖИМАЕТСЯ, А НЕ РЕЖЕТСЯ
                  // ПОПОЛАМ БУКВЫ. Обрезка по краю оставляла огрызок глифа
                  // («Андреі», «Перерı»); кегль до 11 (0.85 от 13 — пол шрифта
                  // продукта) вмещает «Андрей», «Встреча», «Перерыв» целиком.
                  // Режим «clip» подгонку кегля в iOS выключает, поэтому при
                  // сжатии — «tail» (текст и так влез). Длинное имя, которому
                  // и 11pt мало, режется по краю, как раньше: «Конс» говорит
                  // больше, чем «Ко…».
                  ellipsizeMode={
                    textW >= 96 || nameShrinkFits(part, textW) ? "tail" : "clip"
                  }
                  adjustsFontSizeToFit={textW < 96 && nameShrinkFits(part, textW)}
                  minimumFontScale={NAME_MIN_SCALE}
                  maxFontSizeMultiplier={1.3}
                >
                  {part}
                </Text>
              ))
            : null}
          {ladder.showTime && textW >= 24 ? (
            <Text
              style={{
                color: subColor,
                fontSize: 13,
                lineHeight: lineH,
                fontWeight: overdue ? "700" : "500",
                marginRight: lastRow === "time" ? dotReserve : 0,
                fontVariant: ["tabular-nums"],
              }}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
            >
              {textW >= 92 ? `${apt.time_start} – ${apt.time_end}` : apt.time_start}
            </Text>
          ) : null}
          {showService && textW >= 24 ? (
            <Text
              style={{
                color: subColor,
                fontSize: 13,
                lineHeight: lineH,
                marginRight: lastRow === "service" ? dotReserve : 0,
              }}
              numberOfLines={1}
              ellipsizeMode={textW < 96 ? "clip" : "tail"}
              maxFontSizeMultiplier={1.3}
            >
              {service}
            </Text>
          ) : null}
          {showAddress && textW >= 24 ? (
            <Text
              style={{
                color: subColor,
                fontSize: 13,
                lineHeight: lineH,
                marginRight: dotReserve,
              }}
              numberOfLines={1}
              ellipsizeMode={textW < 96 ? "clip" : "tail"}
              maxFontSizeMultiplier={1.3}
            >
              {address}
            </Text>
          ) : null}

          {/* УГЛОВОЙ ЗНАК ОДИН И ОДНОЗНАЧНЫЙ: белый круг с галкой — работа
              закрыта. Просрочка знака не носит: её сигнал — тёмный ободок
              блока, и два разных знака в углу на колонке недели, где глиф не
              рисуется, слились бы в два одинаковых кружка. Глиф рисуется только на широком
              блоке: SVG монтирует отдельное дерево на каждый знак, а неделя
              держит 21 колонку. */}
          {markSize > 0 && completed ? (
            <View
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                width: markSize,
                height: markSize,
                borderRadius: 999,
                // На плотной заливке зелёный круг тонул бы в зелёных записях;
                // белая плёнка с белой галкой читается на любом цвете.
                backgroundColor: "rgba(255,255,255,0.32)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {markSize >= 14 ? (
                <Check color={BLOCK_TEXT} size={10} strokeWidth={3.5} />
              ) : null}
            </View>
          ) : null}

          {/* ЧУЖАЯ МЕТКА — точка в нижнем углу: сам блок залит цветом записи.
              Точка несёт цвет метки как есть, а белое кольцо отделяет её от
              чужой заливки при любом сочетании. */}
          {offLabelColor && markSize > 0 && cardH >= (completed ? 30 : 20) ? (
            <View
              style={{
                position: "absolute",
                bottom: 2,
                right: 2,
                width: 9,
                height: 9,
                borderRadius: 999,
                // Точка лежит на плотном чужом цвете: белое кольцо отделяет
                // её от заливки, и цвет метки виден как есть.
                backgroundColor: offLabelColor,
                borderWidth: 1.5,
                borderColor: BLOCK_TEXT,
              }}
            />
          ) : null}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}, blockPropsEqual);
