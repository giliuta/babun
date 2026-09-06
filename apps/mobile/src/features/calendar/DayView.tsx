import { useMemo, useState } from "react";
import {
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type DimensionValue,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { AlertTriangle, Check } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { STATUS_LABELS } from "@babun/shared/local/appointments";
import { formatYMD, pad2, parseYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import { layoutDay, type PlacedAppt } from "@/features/calendar/layout";
import {
  CANCELLED_EDGE,
  useBlockColors,
  type BlockColors,
} from "@/features/calendar/status-colors";
import {
  deepen,
  fillRgba,
  markColor,
} from "@/components/ui/color-contrast";
import { ZoomableTimeGrid } from "@/features/calendar/zoom";
import { PagedStrip, usePeriodPager } from "@/features/calendar/pager";
import { DateCell } from "@/features/calendar/date-header";

export const RAIL_W = 48;
// Высота полосы шапки дат над сеткой (web DayColumn header h-[64px]) —
// страницы пейджера позиционируются абсолютно, полосе нужна явная высота.
export const HEADER_H = 64;
const GAP = 3;

// ymd ± дни без TZ-сюрпризов (parseYMD → локальная полночь).
function addDaysYmd(ymd: string, days: number): string {
  const d = parseYMD(ymd);
  d.setDate(d.getDate() + days);
  return formatYMD(d);
}
// Visible window fallback — mirrors shared DEFAULT_CALENDAR_SETTINGS
// (startHour 0 / endHour 24): the grid shows the whole day, work hours
// only drive the grey off-hours wash.
const DEFAULT_START = 0;
const DEFAULT_END = 24;
// Snap granularity fallback. Календарь передаёт константные 15 мин
// (настройка «Шаг сетки» удалена — см. stepMinutes в index.tsx); драг и
// тап по пустому слоту снапятся к нему, кламп 5–60.
const DEFAULT_STEP = 30;
// ТАП ПО ПУСТОМУ МЕСТУ ВСЕГДА ЛОЖИТСЯ НА ПОЛЧАСА (владелец 2026-08-27: «оно
// должно выбираться по тридцатиминутный, то есть оно не может выбрать 45
// минут: либо 13:00, либо 13:30, либо 14:00»).
//
// Это НЕ то же самое, что шаг драга. Драг двигает существующую запись и живёт
// по `stepMinutes` (15): там человек метится в конкретную щель между двумя
// записями, и четверть часа — рабочая точность. Тап же назначает время
// с нуля, и попасть пальцем в 13:45 он не хотел — просто так лёг палец.
// Раньше обе операции делили одно число, и тап наследовал чужую точность.
//
// Пятиминутная точность никуда не делась: она в поле времени самой записи
// (`UnifiedTimePopup`), где её выставляют осознанно, а не пальцем по сетке.
const TAP_STEP = 30;
// All-day events render as thin strips on the left edge of the column
// (web DayColumn v496) instead of joining the overlap layout.
const ALL_DAY_W = 8;
const ALL_DAY_GAP = 2;
// Получасовая волосяная линия В КОЛОНКЕ появляется, когда час достаточно
// высок, чтобы она читалась, а не сливалась в шум. Порог по КОММИЧЕННОМУ
// hourH — как и текст-фит блоков, линия догоняет зум на отпускании.
// На рельсе подписей «HH:30» нет вовсе (запрос владельца 2026-07-27:
// «только часовая») — время между часами называет красная капсула «сейчас».
const HALF_MARK_MIN_H = 52;

const minToHM = (min: number) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

// Per-date work band (minutes since midnight) resolved from team_schedules
// by the parent via shared getDayScheduleForDate — web DayColumn.tsx:231.
// breaks — перерывы команды (обед и т.п.): серые полосы на сетке.
export type WorkBand = {
  startMin: number;
  endMin: number;
  breaks?: { startMin: number; endMin: number }[];
};

// Отрезок свободного времени для режима «Записать» — один зелёный кубик.
export type FreeSlotRange = { startMin: number; endMin: number };

// ZOOM GEOMETRY. Pinch-to-zoom animates ONE value — the grid row height in
// ZoomableTimeGrid — on the UI thread. Everything inside a column is
// positioned in PERCENT of the column height (or flex), so Yoga re-derives
// the whole grid from that single animated height, frame-for-frame, with no
// per-element animated styles and zero React involvement. Pixel-based
// derivations (tap→time, drag→minutes, text fit) use the committed `hourH`
// prop, which the pinch updates once per gesture via onZoom.
const pct = (part: number, total: number): DimensionValue =>
  `${(part / total) * 100}%`;

// A horizontal band covering [fromMin, toMin] — off-hours wash, past-time
// wash, buffer bands, breaks. `label` — тихая подпись по центру полосы
// (например «Перерыв»); в узких колонках недели не передаётся.
function MinuteBand({
  fromMin,
  toMin,
  winStartMin,
  winEndMin,
  color,
  label,
}: {
  fromMin: number;
  toMin: number;
  winStartMin: number;
  winEndMin: number;
  color: string;
  label?: string;
}) {
  const t = useThemeColors();
  const totalMin = winEndMin - winStartMin;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: pct(fromMin - winStartMin, totalMin),
        height: pct(toMin - fromMin, totalMin),
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {label ? (
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 11, fontWeight: "500", color: t.faint }}
        >
          {label}
        </Text>
      ) : null}
    </View>
  );
}

/** Минимальная высота карточки: обвязка 9pt + одна строка текста. Ниже —
 *  блок без текста, только заливка, кант и знаки. */
const MIN_H = (lineH: number) => 9 + lineH;

function Block({
  placed,
  hourH,
  laneX,
  laneW,
  startHour,
  endHour,
  stepMinutes,
  colors,
  offLabelColor,
  label,
  service,
  lineH,
  overdue = false,
  onEdit,
  onMenu,
  onReschedule,
}: {
  placed: PlacedAppt;
  /** Committed pixels-per-hour — px math (drag snap, text fit) only;
   *  the on-screen geometry is percent-based and zoom-independent. */
  hourH: number;
  laneX: number;
  laneW: number;
  startHour: number;
  endHour: number;
  stepMinutes: number;
  colors: BlockColors;
  /** Цвет чужой метки: точка в правом нижнем углу. null — метка своя. */
  offLabelColor: string | null;
  /** Высота строки текста при текущем системном шрифте. Считается ОДИН раз в
   *  колонке: `useWindowDimensions` внутри каждого из полутора сотен блоков
   *  недели стоил бы кадра. */
  lineH: number;
  label: string;
  service: string | null;
  /** Запланирована, а время уже прошло — незакрытая работа: полоска и
   *  время предупреждающим цветом (недополученные деньги). */
  overdue?: boolean;
  onEdit: (a: Appointment) => void;
  /** Долгое нажатие БЕЗ движения — контекстное меню (web ActionMenuModal);
   *  с движением — перенос, как раньше. */
  onMenu?: (a: Appointment) => void;
  /** Undefined for crew: the block stays tappable but has no drag affordance. */
  onReschedule?: (a: Appointment, s: string, e: string) => void;
}) {
  const t = useThemeColors();
  const { apt, startMin, endMin, colIndex, colCount } = placed;
  const ty = useSharedValue(0);
  const active = useSharedValue(0);
  /** 0 — покой, 1 — под пальцем. Гонит заливку и лёгкое сжатие. */
  const press = useSharedValue(0);

  const winStart = startHour * 60;
  const winEnd = endHour * 60;
  const totalMin = winEnd - winStart;
  // Clamp into the visible window (web windowStart/windowEnd semantics):
  // a block starting before the window pins to the top instead of getting
  // a negative top and vanishing above the grid.
  const visStart = Math.max(startMin, winStart);
  const visEnd = Math.min(endMin, winEnd);
  const colW = laneW / colCount;
  const left = laneX + colIndex * colW + 1;
  const width = colW - GAP;
  const cancelled = apt.status === "cancelled";
  const completed = apt.status === "completed";
  // ═══ ГЕОМЕТРИЯ И ЦВЕТ БЛОКА ═══
  // Всё считается арифметикой от ширины и высоты, а не флагом «компактный»:
  // блок недели и блок дня — один и тот же блок при разной ширине.
  const cardH = Math.max(MIN_H(lineH), ((visEnd - visStart) / 60) * hourH) - 2;
  const pad = width >= 96 ? 6 : 4;
  const bw = overdue ? 2 : 1;
  const markSize = width >= 96 ? 14 : width >= 40 ? 8 : 0;
  const markReserve = markSize > 0 && (overdue || completed) ? markSize + 4 : 0;
  const textW = width - 2 * pad - 2 * bw - markReserve;
  // Строка помещается, если под неё есть 9pt обвязки и её высота.
  const lines = Math.min(3, Math.floor((cardH - 9) / lineH) + 1);
  // ОТМЕНЁННАЯ ТЕРЯЕТ ЦВЕТ ЗАПИСИ: она никуда не едет и не имеет права
  // занимать слот палитры. Выполненная гаснет вполовину — сигнал носит
  // зелёный знак, а не плотность заливки.
  const edge = cancelled ? CANCELLED_EDGE : overdue ? t.warning : colors.edge;
  // «Нет адреса» показываем только будущим: у просроченных приоритет —
  // оранжевое «!» незакрытой работы (web: past побеждает no_address).

  const commit = (translationY: number) => {
    if (!onReschedule) {
      ty.value = withSpring(0);
      return;
    }
    const duration = Math.max(15, endMin - startMin);
    // Base the move on the UNCLAMPED startMin (like moveBy below), not on
    // the clamped visual top: a block clipped by the visible window
    // (e.g. 06:30 with startHour=7) must keep its real start, not get
    // silently pinned to the window edge. The DELTA snaps to gridStep so
    // an off-grid start keeps its offset — exactly what the a11y actions
    // do.
    const step = Math.max(5, Math.min(60, stepMinutes));
    const deltaMin =
      Math.round(((translationY / hourH) * 60) / step) * step;
    let newStart = startMin + deltaMin;
    // Clamp into the window, but never TIGHTER than where the block
    // already sits — a clipped block may legitimately stay clipped.
    const lo = Math.min(startMin, winStart);
    const hi = Math.max(endMin, winEnd) - duration;
    newStart = Math.max(lo, Math.min(hi, newStart));
    if (newStart === startMin) {
      // Некуда двигать — мягко возвращаем карточку на место.
      ty.value = withSpring(0);
      return;
    }
    onReschedule(apt, minToHM(newStart), minToHM(newStart + duration));
    // Оптимистический кеш переписан синхронно внутри onReschedule → база
    // блока уже на новом слоте. Мгновенный сброс смещения приземляется тем
    // же кадром — блок остаётся под пальцем. Прежний withSpring(0) 300 мс
    // вёз карточку к СТАРОМУ слоту и она «дёргалась» после ребейза.
    ty.value = 0;
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

  const pan = Gesture.Pan()
    .activateAfterLongPress(300)
    .onStart(() => {
      active.value = withSpring(1);
    })
    .onUpdate((e) => {
      ty.value = e.translationY;
    })
    .onEnd((e) => {
      // Отпустил, не сдвинув (<8px) — это «подержал» → контекстное меню
      // (web ActionMenuModal). Сдвинул — перенос: сброс ty решает commit
      // на JS (перенос состоялся → мгновенно, база уже переписана
      // оптимистически; нет → пружиной домой).
      if (Math.abs(e.translationY) < 8 && onMenu) {
        ty.value = withSpring(0);
        runOnJS(onMenu)(apt);
      } else {
        runOnJS(commit)(e.translationY);
      }
      active.value = withSpring(0);
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
  const gesture = onReschedule
    ? Gesture.Exclusive(pan, tap)
    : onMenu
      ? Gesture.Exclusive(longPress, tap)
      : tap;

  // The wrapper owns position + stacking (zIndex must live among siblings);
  // the card owns the drag transform + shadow, so the wrapper's percent
  // geometry stays untouched by the gesture springs.
  // ТЕНЬ ПЕРЕТАСКИВАНИЯ — НА ОБЁРТКЕ. На карточке она рисовалась под
  // `overflow: "hidden"` и не была видна ни разу.
  const wrapperStyle = useAnimatedStyle(() => ({
    zIndex: active.value > 0 ? 20 : 1,
    shadowColor: "#000",
    shadowOpacity: active.value * 0.25,
    shadowRadius: active.value * 8,
    shadowOffset: { width: 0, height: 3 },
  }));
  // ОТКЛИК — ЗАЛИВКОЙ И МАСШТАБОМ, А НЕ ПРОЗРАЧНОСТЬЮ. Прежний `opacity`
  // гасил и текст, и заставлял iOS рисовать слой offscreen на 21 колонке; к
  // тому же он перетирал `opacity: 0.55` отменённой, то есть тот сигнал не
  // работал вовсе. Заливка под пальцем — 40 %: имя и время на ней читаются
  // (измерено, 5.81 : 1 и 4.85 : 1 в худшем цвете палитры).
  const fillIdle = fillRgba(
    cancelled ? t.ink : colors.hue,
    cancelled ? 0.0784 : completed ? 0.102 : 0.1804,
  );
  const fillPressed = fillRgba(
    cancelled ? t.ink : colors.hue,
    cancelled ? 0.2 : completed ? 0.2588 : 0.4,
  );
  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: ty.value },
      { scale: (1 + active.value * 0.03) * (1 - press.value * 0.03) },
    ],
    backgroundColor: interpolateColor(
      press.value,
      [0, 1],
      [fillIdle, fillPressed],
    ),
  }));


  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${apt.time_start}–${apt.time_end}, ${label}, ${STATUS_LABELS[apt.status]}`}
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
          {/* ЛЕСТНИЦА СОДЕРЖИМОГО: имя → время → услуга. Имя первым, потому
              что время уже названо рельсом слева и позицией блока, а имя не
              выводится ниоткуда. Кегль 13 — типографический пол продукта;
              девятка, которой неделя набиралась раньше, была нечитаема. */}
          {lines >= 1 && textW >= 24 ? (
            <Text
              style={{
                color: t.ink,
                fontSize: 13,
                lineHeight: lineH,
                fontWeight: "700",
                marginRight: markReserve,
                textDecorationLine: cancelled ? "line-through" : "none",
              }}
              numberOfLines={1}
              ellipsizeMode={textW < 96 ? "clip" : "tail"}
              maxFontSizeMultiplier={1.3}
            >
              {label}
            </Text>
          ) : null}
          {lines >= 2 && textW >= 24 ? (
            <Text
              style={{
                color: t.body,
                fontSize: 13,
                lineHeight: lineH,
                fontWeight: overdue ? "700" : "500",
                fontVariant: ["tabular-nums"],
              }}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
            >
              {textW >= 92 ? `${apt.time_start} – ${apt.time_end}` : apt.time_start}
            </Text>
          ) : null}
          {lines >= 3 && textW >= 120 && service ? (
            <Text
              style={{ color: t.body, fontSize: 13, lineHeight: lineH }}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
            >
              {service}
            </Text>
          ) : null}

          {/* УГЛОВЫЕ ЗНАКИ — нецветовой канал состояния. Просрочка носит его
              ВСЕГДА: в узком блоке текста нет вовсе, и без знака она была бы
              чистым оттенком, неотличимым от оранжевой ситуации при
              дальтонизме. Глиф рисуется только на широком блоке: SVG монтирует
              отдельное дерево на каждый знак, а неделя держит 21 колонку. */}
          {markSize > 0 && (overdue || completed) ? (
            <View
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                width: markSize,
                height: markSize,
                borderRadius: 999,
                backgroundColor: overdue
                  ? markColor(t.warning)
                  : markColor(t.success),
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {markSize >= 14 ? (
                overdue ? (
                  <AlertTriangle color={t.onAccent} size={9} strokeWidth={2.6} />
                ) : (
                  <Check color={t.onAccent} size={10} strokeWidth={3} />
                )
              ) : null}
            </View>
          ) : null}

          {/* ЧУЖАЯ МЕТКА — точка в нижнем углу: периметр занят цветом самой
              записи. Цвет точки затемняется против ЕЁ заливки, а не против
              сетки: точка лежит на чужом цвете.

              `colors.fill` — НЕПРОЗРАЧНЫЙ композит (см. `BlockColors.fill`).
              Пока здесь лежала строка с альфой, `deepen` мерил контраст об
              отброшенную альфу, то есть о полный цвет записи, и топил метку
              вдвое глубже нужного: зелёная на кобальтовой выходила почти
              чёрной. */}
          {offLabelColor && markSize > 0 && cardH >= (overdue || completed ? 30 : 20) ? (
            <View
              style={{
                position: "absolute",
                bottom: 2,
                right: 2,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: deepen(offLabelColor, [colors.fill]),
              }}
            />
          ) : null}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

// The fixed hour-label rail on the left of the grid: one flex cell per hour
// (equal split of the animated grid height), each label riding its cell top.
// `nowMinutes` (только когда видимый период содержит сегодня) рисует красную
// капсулу текущего времени на высоте now-line — Apple Calendar паттерн;
// соседний часовой лейбл в ±18 мин прячется, чтобы не слипались.
export function TimeRail({
  startHour = DEFAULT_START,
  endHour = DEFAULT_END,
  nowMinutes,
}: {
  startHour?: number;
  endHour?: number;
  nowMinutes?: number | null;
}) {
  const t = useThemeColors();
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = startHour; h < endHour; h++) out.push(h);
    return out;
  }, [startHour, endHour]);
  const winStart = startHour * 60;
  const winEnd = endHour * 60;
  const nowInWin =
    nowMinutes != null && nowMinutes >= winStart && nowMinutes <= winEnd
      ? nowMinutes
      : null;
  const nearNow = (h: number) =>
    nowInWin != null && Math.abs(h * 60 - nowInWin) < 18;
  // Чёрные цифры на белом рельсе — принцип «из чёрного, не серого»
  // (Bumpix-эталон): подписи осей не приглушаем.
  const labelStyle = {
    position: "absolute" as const,
    right: 6,
    width: RAIL_W - 8,
    textAlign: "right" as const,
    color: t.ink,
    fontSize: 12,
    fontWeight: "600" as const,
  };
  return (
    <View
      // Жирный разделитель рельса и сетки (запрос владельца 2026-07-13):
      // левая колонка времени отчётливо отделена от происходящего.
      style={{
        width: RAIL_W,
        backgroundColor: t.surface,
        borderRightWidth: 2,
        borderRightColor: `${t.ink}4d`,
      }}
    >
      {hours.map((h) => (
        <View key={h} style={{ flex: 1 }}>
          {nearNow(h) ? null : (
            <Text
              style={[labelStyle, { top: h === startHour ? 0 : -7 }]}
              className="tabular-nums"
              maxFontSizeMultiplier={1.3}
            >
              {`${pad2(h % 24)}:00`}
            </Text>
          )}
        </View>
      ))}
      {/* endHour label — anchored to the rail bottom, no cell needed. */}
      <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 0 }}>
        {nearNow(endHour) ? null : (
          <Text
            style={[labelStyle, { top: -7 }]}
            className="tabular-nums"
            maxFontSizeMultiplier={1.3}
          >
            {endHour === 24 ? "24:00" : `${pad2(endHour % 24)}:00`}
          </Text>
        )}
      </View>
      {/* Капсула текущего времени — на высоте now-line колонки сегодня. */}
      {nowInWin != null ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            right: 3,
            top: pct(nowInWin - winStart, winEnd - winStart),
            marginTop: -8,
            height: 16,
            borderRadius: t.radius.card,
            paddingHorizontal: 4,
            justifyContent: "center",
            backgroundColor: t.danger,
          }}
        >
          <Text
            className="tabular-nums"
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 10, fontWeight: "700", color: t.onAccent }}
          >
            {minToHM(nowInWin)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// One day lane: gridlines, off-hours wash, past-wash, empty-slot tap,
// positioned blocks, all-day strips, now-line.
// Reused by both DayView (1 column) and WeekView (N columns).
//
// Structure: the hour grid is a column of FLEX cells (one per hour) that
// carry the hour line (borderTop) and the
// create-slot Pressable in one node; washes/buffers/blocks/now-line are
// percent-positioned overlays. The column has NO pixel geometry of its own —
// it stretches to the animated row height (see zoom module note above), so
// nothing here renders, measures or animates during a pinch.
export function DayColumn({
  dateYmd,
  appointments,
  clientName,
  serviceLabel,
  teamColorFor,
  offLabelColorFor,
  isToday,
  todayYmd,
  compact = false,
  onEdit,
  onMenu,
  onCreateAt,
  onReschedule,
  canReschedule,
  startHour = DEFAULT_START,
  endHour = DEFAULT_END,
  stepMinutes = DEFAULT_STEP,
  hourH,
  workStartHour,
  workEndHour,
  workBand,
  bufferMinutes = 0,
  nowMinutes,
  tintColor,
  freeSlots,
}: {
  dateYmd: string;
  appointments: Appointment[];
  clientName: (a: Appointment) => string;
  serviceLabel?: (a: Appointment) => string | null;
  teamColorFor?: (a: Appointment) => string | null;
  /** Цвет метки САМОЙ записи, когда она отличается от метки дня
   *  (`resolveOffDayLabel`): блок получает окантовку этим цветом. Владелец
   *  2026-09-04: «можно подсвечивать другим цветом, когда метка другая».
   *  null — обычный блок. */
  offLabelColorFor?: (a: Appointment) => string | null;
  isToday: boolean;
  /** Бизнес-сегодня (YYYY-MM-DD) — просрочка записей и затемнение
   *  прошедших дней. Не задан → оба сигнала выключены. */
  todayYmd?: string;
  compact?: boolean;
  onEdit: (a: Appointment) => void;
  /** Долгое нажатие без движения по блоку — контекстное меню записи. */
  onMenu?: (a: Appointment) => void;
  /** Undefined for read-only calendars: empty slots are plain grid cells. */
  onCreateAt?: (dateYmd: string, timeStart: string) => void;
  onReschedule?: (a: Appointment, newStart: string, newEnd: string) => void;
  /** Per-record mutation guard (shared team events are creator-only). */
  canReschedule?: (a: Appointment) => boolean;
  startHour?: number;
  endHour?: number;
  /** Snap granularity for drag + empty-slot taps (календарь передаёт
   *  константные 15) — web DayColumn `snapMinutes` semantics. */
  stepMinutes?: number;
  /** Committed pixels-per-hour (post-pinch) — px math only (tap→minutes,
   *  drag snap, text fit); on-screen geometry is percent/flex. */
  hourH: number;
  /** Work band — everything outside gets the grey off-hours wash (web
   *  DayColumn out-of-hours overlays). Defaults to the visible window. */
  workStartHour?: number;
  workEndHour?: number;
  /** Per-date band from the team schedule; wins over workStartHour/EndHour.
   *  null = нерабочий день → no wash at all (web v473: day-off body stays
   *  plain); undefined → fall back to workStartHour/EndHour. */
  workBand?: WorkBand | null;
  /** РЕЖИМ ПОДБОРА ВРЕМЕНИ: зелёные кубики «сюда можно записать» прямо в
   *  сетке — поверх серого нерабочих часов, под блоками записей. Пусто/не
   *  задано — обычный календарь без подсветки. */
  freeSlots?: readonly FreeSlotRange[];
  /** Minutes reserved after each live appointment (дорога/уборка) —
   *  rendered as a subtle band under the blocks, web DayColumn.tsx:558-580.
   *  0 = off. */
  bufferMinutes?: number;
  /** Current time in minutes since midnight (business timezone), ticked
   *  by the parent every minute. Null/undefined → no now-line. */
  nowMinutes?: number | null;
  /** Day-label (city/tag) colour — washes the whole column very lightly
   *  (web DayColumn tintByLabel, Phase I41). Null/undefined → no tint. */
  tintColor?: string | null;
}) {
  const t = useThemeColors();
  const blockColors = useBlockColors(teamColorFor);
  const [laneW, setLaneW] = useState(0);
  const { fontScale } = useWindowDimensions();
  // ВЫСОТА СТРОКИ СЧИТАЕТСЯ ОДИН РАЗ НА КОЛОНКУ. Крупный системный шрифт
  // поднимает и строку, и минимальную высоту блока; читать это в каждом из
  // полутора сотен блоков недели — лишний проход по всем.
  const lineH = Math.ceil(16 * Math.min(fontScale, 1.3));

  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = startHour; h < endHour; h++) out.push(h);
    return out;
  }, [startHour, endHour]);
  const winStartMin = startHour * 60;
  const winEndMin = endHour * 60;
  const totalMin = winEndMin - winStartMin;

  // v496 web parity — all-day events are thin strips on the left edge,
  // excluded from the overlap layout so timed events keep full width.
  const allDay = useMemo(
    () => appointments.filter((a) => a.event_all_day === true),
    [appointments],
  );
  const placements = useMemo(
    () =>
      layoutDay(appointments.filter((a) => a.event_all_day !== true)).filter(
        (p) => p.endMin > winStartMin && p.startMin < winEndMin,
      ),
    [appointments, winStartMin, winEndMin],
  );
  const reservedW =
    allDay.length > 0
      ? allDay.length * ALL_DAY_W + (allDay.length - 1) * ALL_DAY_GAP + 4
      : 0;

  const nowMin =
    isToday && nowMinutes != null && nowMinutes >= winStartMin && nowMinutes <= winEndMin
      ? nowMinutes - winStartMin
      : null;
  // Сетка «как в Bumpix» (принцип «из чёрного, не серого»): линии и серый
  // нерабочих часов — альфа от ink поверх белого поля («прикрываем, не
  // скрываем»), а не бледные отдельные серые. 20% — отчётливая линия часа,
  // 12% — плоский, явно читаемый wash нерабочего времени.
  const gridLine = `${t.ink}33`;
  const offHoursFill = `${t.ink}1f`;

  // Off-hours wash band: per-date team schedule wins (workBand), else the
  // global hour props.
  //
  // ВЫХОДНОЙ ЗАКРАШЕН ЦЕЛИКОМ (владелец 2026-08-17: «просто не подсвечивается и
  // всё, остаётся как будто в прошлом»). До этого `band === null` ГАСИЛО wash
  // совсем — обе полосы схлопывались на края окна, и колонка выходного
  // оставалась БЕЛОЙ среди серых нерабочих часов рабочих дней. То есть
  // единственный нерабочий день выглядел единственным подсвеченным — ровно
  // наоборот смыслу. Теперь у выходного рабочей полосы нет вовсе, и весь день
  // ложится под тот же серый, которым закрыты нерабочие часы: язык один.
  const band =
    workBand === undefined
      ? {
          startMin: (workStartHour ?? startHour) * 60,
          endMin: (workEndHour ?? endHour) * 60,
        }
      : workBand;
  // Клэмп с ОБЕИХ сторон: рабочее окно целиком вне видимого давало
  // MinuteBand с top<0 / height>100% — теперь весь видимый день просто
  // корректно серый.
  const clampWin = (min: number) =>
    Math.min(Math.max(min, winStartMin), winEndMin);
  const workStart = band ? clampWin(band.startMin) : winStartMin;
  // Ноль рабочего времени у выходного: полоса «после смены» начинается на
  // верхней кромке окна и кроет колонку целиком одним слоем.
  const workEnd = band ? clampWin(band.endMin) : winStartMin;

  const onSlotPress = (hour: number, locationY: number) => {
    if (!onCreateAt) return;
    // Sub-hour snap by touch position (web handleColumnClick parity):
    // floor to multiples of TAP_STEP, so a tap at 11:27 creates 11:00, at
    // 11:40 → 11:30. Screen-reader activation has no coordinates → whole
    // hour, matching the accessibilityLabel.
    const step = TAP_STEP;
    const offset = Math.min(
      60 - step,
      Math.floor(((locationY / hourH) * 60) / step) * step,
    );
    onCreateAt(dateYmd, minToHM(hour * 60 + Math.max(0, offset)));
  };

  return (
    <View
      onLayout={(e) => setLaneW(e.nativeEvent.layout.width)}
      style={{
        flex: 1,
        position: "relative",
        borderLeftWidth: 1,
        borderLeftColor: gridLine,
        // Рабочее поле — чистый белый (Bumpix): серый нерабочих часов и
        // плёнка метки ложатся ПОВЕРХ, а не вместо.
        backgroundColor: t.surface,
      }}
    >
      {tintColor ? (
        // ~5% alpha of the label colour — reads as a hue, not a fill, so
        // gridlines / washes / blocks above keep their contrast.
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: `${tintColor}0d`,
          }}
        />
      ) : null}
      {/* off-hours wash: before work start / after work end */}
      {workStart > winStartMin ? (
        <MinuteBand
          fromMin={winStartMin}
          toMin={workStart}
          winStartMin={winStartMin}
          winEndMin={winEndMin}
          color={offHoursFill}
        />
      ) : null}
      {workEnd < winEndMin ? (
        <MinuteBand
          fromMin={workEnd}
          toMin={winEndMin}
          winStartMin={winStartMin}
          winEndMin={winEndMin}
          color={offHoursFill}
        />
      ) : null}

      {/* Перерывы команды (обед и т.п.) — тот же серый, что нерабочие часы:
          «сюда не записываем». Подпись только в широком дне. */}
      {band?.breaks?.map((b, i) =>
        b.endMin > winStartMin && b.startMin < winEndMin ? (
          <MinuteBand
            key={`break-${i}`}
            fromMin={Math.max(b.startMin, winStartMin)}
            toMin={Math.min(b.endMin, winEndMin)}
            winStartMin={winStartMin}
            winEndMin={winEndMin}
            color={offHoursFill}
            label={compact ? undefined : "Перерыв"}
          />
        ) : null,
      )}

      {nowMin != null ? (
        // Прошедшее время затемняется ОТЧЁТЛИВО (запрос владельца
        // 2026-07-16: «затемним участки, которые прошли») — 0.05 читается
        // сразу, но остаётся легче серых нерабочих часов (0.12).
        <MinuteBand
          fromMin={winStartMin}
          toMin={winStartMin + nowMin}
          winStartMin={winStartMin}
          winEndMin={winEndMin}
          color="rgba(11,18,32,0.05)"
        />
      ) : null}
      {/* Прошедшие дни (неделя) — то же затемнение всей колонки: «что уже
          позади» видно при сканировании, тем же слоем, что «до сейчас». */}
      {todayYmd && dateYmd < todayYmd ? (
        <MinuteBand
          fromMin={winStartMin}
          toMin={winEndMin}
          winStartMin={winStartMin}
          winEndMin={winEndMin}
          color="rgba(11,18,32,0.05)"
        />
      ) : null}

      {/* hour cells: gridline + create-slot in one flex node. Часовые ряды
          чистые (Bumpix); получасовая волосяная линия появляется только на
          достаточном зуме (HALF_MARK_MIN_H) — иначе частокол. */}
      {hours.map((h) => {
        const halfHourLine = hourH >= HALF_MARK_MIN_H ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: "50%",
              left: 0,
              right: 0,
              height: 1,
              backgroundColor: `${t.ink}14`,
            }}
          />
        ) : null;
        const style = {
          flex: 1,
          borderTopWidth: 1,
          borderTopColor: gridLine,
        } as const;

        return onCreateAt ? (
          <Pressable
            key={h}
            onPress={(e) => onSlotPress(h, e?.nativeEvent?.locationY ?? 0)}
            accessibilityRole="button"
            accessibilityLabel={`Создать запись в ${pad2(h)}:00`}
            // В режиме подбора выбор — это кубики. Часы остаются кликабельными
            // (родитель ответит «выберите зелёное»), но в озвучке молчат:
            // иначе VoiceOver сначала читает дюжину одинаковых «Создать
            // запись в HH:00» и только потом доходит до свободного времени.
            accessibilityElementsHidden={freeSlots !== undefined}
            importantForAccessibility={
              freeSlots !== undefined ? "no-hide-descendants" : "auto"
            }
            style={style}
          >
            {halfHourLine}
          </Pressable>
        ) : (
          <View key={h} pointerEvents="none" style={style}>
            {halfHourLine}
          </View>
        );
      })}
      {/* closing line of the last hour */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 1,
          backgroundColor: gridLine,
        }}
      />

      {/* СВОБОДНОЕ ВРЕМЯ (режим «Записать»). Кубики лежат в самой сетке, а не
          на отдельном экране: диспетчер видит, ЧЕМ занят день вокруг
          свободного окна, и выбирает осознанно.
          Каждый слот — ОТДЕЛЬНАЯ плашка с зазором: сплошная заливка читалась
          как «весь день свободен», а не как выбор из кубиков.
          КУБИК — КНОПКА, и стоит ПОСЛЕ часовых ячеек: под ними он был
          картинкой, тап проваливался в сетку и приезжал округлённым по 15
          минут — с кубика «16:00» уходило 16:15. Кнопка отдаёт ровно своё
          начало. Записи рисуются ниже по дереву и остаются сверху. */}
      {freeSlots?.map((slot) => {
        if (!(slot.endMin > winStartMin && slot.startMin < winEndMin)) {
          return null;
        }
        const from = Math.max(slot.startMin, winStartMin);
        const to = Math.min(slot.endMin, winEndMin);
        const totalMin = winEndMin - winStartMin;
        // Высота кубика в пикселях — по ней решаем, влезет ли подпись.
        const slotH = ((to - from) / 60) * hourH;
        const time = minToHM(slot.startMin);
        return (
          <Pressable
            key={`free-${slot.startMin}`}
            onPress={
              onCreateAt ? () => onCreateAt(dateYmd, time) : undefined
            }
            accessibilityRole="button"
            accessibilityLabel={`Свободно в ${time} — записать`}
            style={{
              position: "absolute",
              left: 2,
              right: 2,
              top: pct(from - winStartMin, totalMin),
              height: pct(to - from, totalMin),
              paddingVertical: 1,
            }}
          >
            {({ pressed }) => (
              <View
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: t.radius.input,
                  backgroundColor: `${t.success}${pressed ? "4d" : "33"}`,
                  // Рамка — чтобы кубик оставался ФИГУРОЙ: одной заливкой в
                  // 20% он даёт 1.33:1 к белой колонке, а при малой высоте,
                  // когда подпись не влезает, исчезает для слабовидящего.
                  borderWidth: 1,
                  borderColor: `${t.success}66`,
                }}
              >
                {/* ВРЕМЯ НА КУБИКЕ (владелец 2026-08-07). Часы слева отвечают
                    за всю сетку, но при выборе смотрят на кубик, а не на
                    рельс: подпись прямо на плашке снимает пересчёт глазами.
                    Не рисуем, когда кубик ниже 16pt — обрезанная цифра хуже
                    отсутствующей. */}
                {slotH >= 16 * Math.min(fontScale, 1.2) ? (
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.2}
                    style={{
                      fontSize: 11,
                      fontWeight: "600",
                      color: t.successInk,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {time}
                  </Text>
                ) : null}
              </View>
            )}
          </Pressable>
        );
      })}

      {/* ПОДПИСИ «ВЫХОДНОЙ» НА КОЛОНКЕ НЕТ (владелец 2026-08-17: «просто не
          подсвечивается и всё»). Слово по центру пустого дня в Неделе ломалось
          на две строки в 50-точечной колонке и было ровно тем шумом, который из
          продукта убирают: серый уже сказал «здесь не работаем». Кто именно
          выходной — отвечает плашка листа при тапе по слоту («Нерабочий день
          команды»), и поставить запись всё равно можно. */}

      {/* Buffer bands — «забронировано под дорогу/уборку» after each live
          appointment; rendered before the blocks so colour cards sit on top
          (web DayColumn.tsx:558-580, cancelled skipped). Placements already
          exclude all-day strips and carry the parsed endMin. */}
      {bufferMinutes > 0
        ? placements.map((p) => {
            if (p.apt.status === "cancelled") return null;
            const bandStart = Math.max(p.endMin, winStartMin);
            const bandEnd = Math.min(p.endMin + bufferMinutes, winEndMin);
            if (bandEnd <= bandStart) return null;
            return (
              <MinuteBand
                key={`buffer-${p.apt.id}`}
                fromMin={bandStart}
                toMin={bandEnd}
                winStartMin={winStartMin}
                winEndMin={winEndMin}
                color={t.fill}
              />
            );
          })
        : null}

      {allDay.map((a, idx) => {
        const c = blockColors(a);
        return (
          <Pressable
            key={a.id}
            onPress={() => onEdit(a)}
            // То же контекстное меню, что у таймированных блоков.
            onLongPress={onMenu ? () => onMenu(a) : undefined}
            // Полоска 8pt — визуально тонкая, но тап-мишень расширена до
            // ~24pt (аудит: было фактически некликабельно).
            hitSlop={{ left: 6, right: 10, top: 4, bottom: 4 }}
            accessibilityRole="button"
            accessibilityLabel={`Весь день, ${clientName(a) || a.comment || "Событие"}`}
            style={{
              position: "absolute",
              top: 1,
              bottom: 1,
              left: idx * (ALL_DAY_W + ALL_DAY_GAP),
              width: ALL_DAY_W,
              borderRadius: 4,
              // Полоска «весь день» — тот же кант, в полную силу: при 0.85
              // она спорила с блоками, а отмену несёт нейтральный цвет, а не
              // прозрачность.
              backgroundColor:
                a.status === "cancelled" ? CANCELLED_EDGE : c.edge,
            }}
          />
        );
      })}

      {/* ЛИНИЯ «СЕЙЧАС» ЛЕЖИТ ПОД ЗАПИСЯМИ, А НЕ ПОВЕРХ НИХ. Сверху она
          перечёркивала карточку ровно по строке времени — а зачёркивание в
          этом продукте уже занято и означает ОТМЕНЁННУЮ запись: идущая прямо
          сейчас работа выглядела снятой. Ничего при этом не теряется: где мы
          во времени, говорит красная капсула на рельсе часов, которая живёт
          вне колонки и никогда ничем не закрыта, а в пустых местах колонки
          линия видна как прежде. Рельс отвечает за время, сетка — за записи.
          `zIndex` блока на это не влиял: у обёртки он приходит анимированным
          стилем и до первого кадра не применяется. */}
      {nowMin != null ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: pct(nowMin, totalMin),
            left: -4,
            right: 0,
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          <View style={{ height: 9, width: 9, borderRadius: 5, backgroundColor: t.danger }} />
          <View style={{ height: 1.5, flex: 1, backgroundColor: t.danger, opacity: 0.85 }} />
        </View>
      ) : null}

      {laneW > 0
        ? placements.map((p) => (
            <Block
              key={p.apt.id}
              placed={p}
              hourH={hourH}
              laneX={reservedW}
              laneW={Math.max(laneW - reservedW, 0)}
              startHour={startHour}
              endHour={endHour}
              stepMinutes={Math.max(5, Math.min(60, stepMinutes))}
              colors={blockColors(p.apt)}
              offLabelColor={offLabelColorFor ? offLabelColorFor(p.apt) : null}
              label={clientName(p.apt) || p.apt.comment || "Запись"}
              service={serviceLabel ? serviceLabel(p.apt) : p.apt.comment || null}
              lineH={lineH}
              onMenu={onMenu}
              overdue={
                todayYmd != null &&
                p.apt.status === "scheduled" &&
                p.apt.kind === "work" &&
                (dateYmd < todayYmd ||
                  (isToday && nowMinutes != null && p.endMin < nowMinutes))
              }
              onEdit={onEdit}
              onReschedule={
                canReschedule?.(p.apt) === false ? undefined : onReschedule
              }
            />
          ))
        : null}

    </View>
  );
}

// Sticky date header above the day grid — web parity (DayColumn header):
// the user must always see WHICH day is open. Same visual grammar as the
// WeekView days-row («Маршрут»): дата всегда в круге (кобальт = сегодня,
// ink = остальные), город — пилл с полным именем.
function DayHeader({
  dateYmd,
  isToday,
  isPast,
  dayOff = false,
  label,
  onLabelTap,
}: {
  dateYmd: string;
  isToday: boolean;
  isPast: boolean;
  /** У команды на эту дату выходной — на месте метки встанет слово. */
  dayOff?: boolean;
  /** Метка дня (город команды). null при отсутствии — шапка чистая,
   *  никакого «+ метка» (Phase I38). */
  label?: { name: string; color: string } | null;
  /** Тап по ВСЕЙ шапке открывает пикер метки (web onCityTap). undefined,
   *  когда у команды нет меток — шапка не интерактивна. */
  onLabelTap?: () => void;
}) {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return (
    <Pressable
      onPress={onLabelTap}
      disabled={!onLabelTap}
      accessibilityRole={onLabelTap ? "button" : undefined}
      accessibilityLabel={
        onLabelTap
          ? `${date.getDate()} ${date.toLocaleDateString("ru-RU", { month: "long" })}, ${label ? `метка: ${label.name}` : "без метки"} — сменить метку`
          : undefined
      }
      className="active:opacity-70"
      style={{ flex: 1 }}
    >
      <DateCell
        date={date}
        size="lg"
        isToday={isToday}
        isPast={isPast}
        label={label}
        dayOff={dayOff}
      />
    </Pressable>
  );
}

// Single-day grid: hour rail + a live-paged day column (prev/cur/next dates
// ride the shared pager axis — swipe drags the neighbouring day in under the
// finger, web/Bumpix-style). Header pages in lockstep with the column.
export function DayView({
  dateYmd,
  apptsFor,
  todayYmd,
  clientName,
  serviceLabel,
  teamColorFor,
  offLabelColorFor,
  onEdit,
  onMenu,
  onCreateAt,
  onReschedule,
  canReschedule,
  onCommitPage,
  startHour = DEFAULT_START,
  endHour = DEFAULT_END,
  stepMinutes = DEFAULT_STEP,
  hourH,
  hourHSv,
  onZoom,
  workStartHour,
  workEndHour,
  workBandFor,
  freeSlotsFor,
  labelTintFor,
  bufferMinutes,
  nowMinutes,
  scrollToHour,
  labelFor,
  onDayLabelTap,
}: {
  /** Центральная (закоммиченная) дата. Соседние страницы — ±1 день. */
  dateYmd: string;
  /** Записи по дате — страницы пейджера сами берут свой день. */
  apptsFor: (dateYmd: string) => Appointment[];
  /** Бизнес-сегодня (now-line и заливка даты по страницам). */
  todayYmd: string;
  clientName: (a: Appointment) => string;
  serviceLabel?: (a: Appointment) => string | null;
  teamColorFor?: (a: Appointment) => string | null;
  /** Цвет чужой метки записи — окантовка блока (см. DayColumn). */
  offLabelColorFor?: (a: Appointment) => string | null;
  onEdit: (a: Appointment) => void;
  /** Долгое нажатие без движения по блоку — контекстное меню записи. */
  onMenu?: (a: Appointment) => void;
  onCreateAt?: (dateYmd: string, timeStart: string) => void;
  onReschedule?: (a: Appointment, newStart: string, newEnd: string) => void;
  /** Per-record mutation guard (shared team events are creator-only). */
  canReschedule?: (a: Appointment) => boolean;
  /** Палец долистал страницу: родитель сдвигает день на ±1. */
  onCommitPage: (dir: 1 | -1) => void;
  startHour?: number;
  endHour?: number;
  stepMinutes?: number;
  /** Committed pixels-per-hour (see ZoomableTimeGrid). */
  hourH: number;
  /** Live pixels-per-hour shared value (see ZoomableTimeGrid). */
  hourHSv: SharedValue<number>;
  /** Pinch-zoom commit — new pixels-per-hour, once per gesture. */
  onZoom?: (next: number) => void;
  workStartHour?: number;
  workEndHour?: number;
  /** Per-date work band from team_schedules (see DayColumn.workBand). */
  workBandFor?: (dateYmd: string) => WorkBand | null | undefined;
  /** Свободные слоты по дате — режим «Записать» (см. DayColumn.freeSlots).
   *  День обязан показывать те же кубики, что и Неделя: без этого пропа
   *  плашка «Выберите зелёное время» висела над сеткой без единого кубика. */
  freeSlotsFor?: (dateYmd: string) => readonly FreeSlotRange[] | undefined;
  /** Per-date day-label colour → light column wash; undefined resolver
   *  when team.tint_days_by_label is off (see DayColumn.tintColor). */
  labelTintFor?: (dateYmd: string) => string | null;
  /** Buffer after each appointment (team ?? global), minutes. */
  bufferMinutes?: number;
  nowMinutes?: number | null;
  /** Auto-scroll target on open (settings.scrollOpenHour). */
  scrollToHour?: number;
  /** Метка дня по дате (undefined — у команды нет меток, шапки чистые). */
  labelFor?: (dateYmd: string) => { name: string; color: string } | null;
  onDayLabelTap?: () => void;
}) {
  const t = useThemeColors();
  const pager = usePeriodPager({ periodKey: dateYmd, onCommit: onCommitPage });
  const dateAt = (off: -1 | 0 | 1) => addDaysYmd(dateYmd, off);

  return (
    <View style={{ flex: 1 }}>
      {/* Полоса шапки — страницы дат едут в локстепе с колонками; линия
          сетки живёт на обёртке и не скользит. Граница волосяная — шапка
          читается продолжением сетки (как в Неделе). */}
      <View
        style={{
          flexDirection: "row",
          borderBottomWidth: 1,
          borderBottomColor: `${t.ink}1a`,
        }}
      >
        <View style={{ width: RAIL_W, backgroundColor: t.surface }} />
        <PagedStrip
          pager={pager}
          style={{ height: HEADER_H }}
          renderPage={(off) => {
            const d = dateAt(off);
            return (
              <DayHeader
                dateYmd={d}
                isToday={d === todayYmd}
                isPast={d < todayYmd}
                label={labelFor?.(d) ?? null}
                dayOff={workBandFor?.(d) === null}
                onLabelTap={off === 0 ? onDayLabelTap : undefined}
              />
            );
          }}
        />
      </View>
      <ZoomableTimeGrid
        hourHSv={hourHSv}
        onZoom={onZoom}
        startHour={startHour}
        endHour={endHour}
        scrollToHour={scrollToHour}
        pageGesture={pager.pan}
      >
        <TimeRail
          startHour={startHour}
          endHour={endHour}
          nowMinutes={dateYmd === todayYmd ? nowMinutes : null}
        />
        <PagedStrip
          pager={pager}
          renderPage={(off) => {
            const d = dateAt(off);
            return (
              <DayColumn
                dateYmd={d}
                appointments={apptsFor(d)}
                clientName={clientName}
                serviceLabel={serviceLabel}
                teamColorFor={teamColorFor}
                offLabelColorFor={offLabelColorFor}
                isToday={d === todayYmd}
                todayYmd={todayYmd}
                onEdit={onEdit}
                onMenu={onMenu}
                onCreateAt={onCreateAt}
                onReschedule={onReschedule}
                canReschedule={canReschedule}
                startHour={startHour}
                endHour={endHour}
                stepMinutes={stepMinutes}
                hourH={hourH}
                workStartHour={workStartHour}
                workEndHour={workEndHour}
                workBand={workBandFor?.(d)}
                freeSlots={freeSlotsFor?.(d)}
                tintColor={labelTintFor?.(d) ?? null}
                bufferMinutes={bufferMinutes}
                nowMinutes={nowMinutes}
              />
            );
          }}
        />
      </ZoomableTimeGrid>
    </View>
  );
}
