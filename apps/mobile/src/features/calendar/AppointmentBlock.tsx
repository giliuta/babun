import { memo } from "react";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
} from "react-native-reanimated";
import { useThemeColors } from "@/theme/colors";
import {
  blockEdge,
  CANCELLED_BORDER,
} from "@/features/calendar/status-colors";
import { BLOCK_TEXT, fillRgba } from "@/components/ui/color-contrast";
import { BLOCK_RADIUS } from "@/components/ui/RecordMark";
import { blockPropsEqual } from "@/features/calendar/grid-memo";
import { useUnstretchedStyle } from "@/features/calendar/zoom";
import { pct } from "@/features/calendar/grid-units";
import {
  BlockGlass,
  FadeTail,
  LiveTimeBadge,
  moneyWords,
  OffLabelDot,
  ResizeHandles,
} from "./appointment-block/BlockDecor";
import { blockLayout } from "./appointment-block/block-layout";
import type { AppointmentBlockProps } from "./appointment-block/block-props";
import { BlockText } from "./appointment-block/BlockText";
import { useBlockDrag } from "./appointment-block/use-block-drag";
import { useBlockGesture } from "./appointment-block/use-block-gesture";

// БЛОК ЗАПИСИ НА СЕТКЕ — вынесен из DayView.tsx (тот перерос 2000
// строк): плотный цвет, лестница содержимого, меню по
// долгому нажатию, свободное перемещение (перенос по получасам и дням,
// растяжка за край) только в режиме правки.
// Parts live in `appointment-block/`: size arithmetic (`block-layout`), the
// drag and resize JS side (`use-block-drag`), the gesture worklets
// (`use-block-gesture`) and the card's decorations.

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
}: AppointmentBlockProps) {
  const t = useThemeColors();
  const { apt, startMin, endMin } = placed;
  // Size arithmetic of the card — `blockLayout`, pure and under test.
  const layout = blockLayout({
    placed,
    laneW,
    startHour,
    endHour,
    hourH,
    lineH,
    label,
    service,
    offLabelColor,
    editing,
    overdue,
    reschedulable: !!onReschedule,
  });
  const {
    winStart,
    winEnd,
    totalMin,
    visStart,
    visEnd,
    frame,
    left,
    width,
    cancelled,
    completed,
    cardH,
    pad,
    bw,
    markSize,
    topHandle,
    money,
    fadeRows,
  } = layout;
  const drag = useBlockDrag({
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
  });
  // Plain locals: the animated-style worklets capture values, not `drag`.
  const { ty, active, press, tx, topPx, botPx, liveStart, moveBy, canResize } = drag;

  // КАНТ ЗАБИРАЕТ ТОЛЬКО ОТМЕНЁННАЯ — правило и его гейт в `status-colors`.
  const edge = blockEdge(colors, apt.status);
  // РАЗОМКНУТЫЙ КАНТ = РАБОТЫ НЕ БУДЕТ. Кант — единственный слой блока, который
  // рисуется ВСЕГДА: текста нет при textW < 24 (наложение в Неделе даёт 11),
  // углового знака нет при ширине < 40. Цвет канта занят категорией, толщина —
  // просрочкой; свободен ровно стиль линии. Зачёркивание имени, которым отмена
  // говорила до сих пор, живёт только там, где имя влезает.
  // ОТМЕНА В СВОЁМ ЦВЕТЕ (настройка «Цвет записи» → «Отменена») — плотный
  // блок с зачёркнутым именем, как все; разомкнутый кант и серость остаются
  // отмене, у которой цвет выключен.
  const greyCancel = cancelled && !colors.cancelPaint;
  const edgeStyle = greyCancel ? CANCELLED_BORDER : "solid";

  const gesture = useBlockGesture({
    drag,
    apt,
    cardH,
    hourH,
    dayW,
    editing,
    onEdit,
    onMenu,
    onReschedule,
  });

  // The wrapper owns position + stacking (zIndex must live among siblings);
  // the card owns the drag transform + shadow, so the wrapper's percent
  // geometry stays untouched by the gesture springs.
  // ТЕНЬ ПЕРЕТАСКИВАНИЯ — НА ОБЁРТКЕ. На карточке она рисовалась под
  // `overflow: "hidden"` и не была видна ни разу.
  // ЦВЕТНАЯ ТЕНЬ плотный блок «парит» над сеткой своим
  // же тоном; под пальцем тень глубже. У отменённой тени нет — ей некуда
  // ехать, и выпуклость её бы выделяла.
  const stackZ = frame.z;
  const shadowTone = cancelled ? "#000" : colors.solid;
  const restShadow = cancelled ? 0 : 0.35;
  const wrapperStyle = useAnimatedStyle(() => ({
    // В «веере» следующая запись лежит поверх предыдущей.
    zIndex: active.value > 0 || editing ? 20 : 1 + stackZ,
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
  // ПЛОТНАЯ ЗАЛИВКА: блок — сам цвет записи,
  // затемнённый ровно до читаемого белого имени; сквозь него больше не
  // просвечивают ни часовые линии, ни линия «сейчас». Выполненная носит ту же
  // заливку и белую галку; отменённая по-прежнему теряет цвет.
  const fillIdle = greyCancel ? fillRgba(t.ink, 0.0784) : colors.solid;
  const fillPressed = greyCancel ? fillRgba(t.ink, 0.2) : colors.pressed;
  const nameColor = greyCancel ? t.ink : BLOCK_TEXT;
  const subColor = greyCancel ? t.body : BLOCK_TEXT;
  // У ОТМЕНЁННОЙ ЗАЛИВКА НЕ АНИМИРУЕТСЯ. Разомкнутый кант выбивает вью из
  // быстрого пути отрисовки, и смена фона заставляла бы iOS перерисовывать
  // картинку канта каждый кадр нажатия. Отклик у неё остаётся масштабом —
  // отменённую и не открывают так часто, чтобы платить за это кадрами.
  const unstretched = useUnstretchedStyle();
  const cardStyle = useAnimatedStyle(() => ({
    top: topPx.value,
    bottom: 2 - botPx.value,
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: (1 + active.value * 0.03) * (1 - press.value * 0.03) },
    ],
    backgroundColor: greyCancel
      ? fillIdle
      : interpolateColor(press.value, [0, 1], [fillIdle, fillPressed]),
  }));
  // Заливка карточки без геометрии — для тающего хвоста строк.
  const fillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(press.value, [0, 1], [fillIdle, fillPressed]),
  }));


  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        // Адрес читается ВСЕГДА: озвучке недоступны ни ширина блока, ни его
        // высота, и гейты вёрстки для неё не существуют.
        accessibilityLabel={`${apt.time_start}–${apt.time_end}, ${label}${cancelled ? ", отменена" : ""}${completed ? ", выполнена" : ""}${moneyWords(money)}${overdue ? ", не оплачена" : ""}${address ? `, ${address}` : ""}`}
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
              // КАНТ ПО ВСЕМУ ПЕРИМЕТРУ ВМЕСТО ЛЕВОГО КОРЕШКА. Заливка отвечает за группировку, кант — за
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
              paddingTop: 2 - (bw - 1) + topHandle,
              borderRadius: BLOCK_RADIUS,
              borderCurve: "continuous",
              overflow: "hidden",
            },
            // ВЫРЕЗ «ВЕЕРА»: запись, лежащая поверх соседки, отделена от неё
            // полоской фона слева — видно, где кончается нижняя и начинается
            // верхняя, даже когда обе одного цвета.
            frame.overlapped
              ? { borderLeftWidth: 2, borderLeftColor: t.surface }
              : null,
            cardStyle,
          ]}
        >
          {canResize ? <ResizeHandles cardH={cardH} /> : null}
          {/* ЩИПОК ТЯНЕТ РАМКУ, НО НЕ БУКВЫ: обратный масштаб
              жеста от верхнего края — текст карточки держит форму. */}
          <Animated.View style={[{ transformOrigin: "top" }, unstretched]}>
            <BlockText
              layout={layout}
              label={label}
              service={service}
              lineH={lineH}
              overdue={overdue}
              nameColor={nameColor}
              subColor={subColor}
            />
          </Animated.View>
          <FadeTail
            rows={fadeRows}
            top={2 - (bw - 1) + topHandle}
            lineH={lineH}
            inset={pad - (bw - 1)}
            fillStyle={fillStyle}
          />
          {greyCancel ? null : <BlockGlass />}
          {liveStart ? <LiveTimeBadge liveStart={liveStart} /> : null}

          {offLabelColor && markSize > 0 && cardH >= (completed ? 30 : 20) ? (
            <OffLabelDot color={offLabelColor} />
          ) : null}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}, blockPropsEqual);
