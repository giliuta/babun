import { memo, useMemo, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import type { Appointment } from "@babun/shared/local/appointments";
import { formatYMD, pad2, parseYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import {
  decksFor,
  layoutDay,
  type PlacedAppt,
} from "@/features/calendar/layout";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { CalendarClock } from "lucide-react-native";
import { haptics } from "@/lib/haptics";
import {
  CANCELLED_BORDER,
  CANCELLED_EDGE,
  useBlockColors,
} from "@/features/calendar/status-colors";
import { isOverdue } from "@/features/calendar/overdue";
import {
  chipOverflowW,
  chipPad,
  chipTextW,
  chipsThatFit,
  CHIP_GAP,
  TEXT_MIN_W,
} from "@/features/calendar/block-geometry";
import { BLOCK_TEXT, fillRgba } from "@/components/ui/color-contrast";
import { ZoomableTimeGrid } from "@/features/calendar/zoom";
import { AppointmentBlock } from "@/features/calendar/AppointmentBlock";
import { MIN_H, minToHM, pct, RAIL_W } from "@/features/calendar/grid-units";
import { PagedStrip, usePeriodPager } from "@/features/calendar/pager";
import { DateCell } from "@/features/calendar/date-header";
import { dayColumnPropsEqual } from "@/features/calendar/grid-memo";

export { RAIL_W } from "@/features/calendar/grid-units";
// Высота полосы шапки дат над сеткой (web DayColumn header h-[64px]) —
// страницы пейджера позиционируются абсолютно, полосе нужна явная высота.
export const HEADER_H = 64;

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
// Получасовая волосяная линия В КОЛОНКЕ появляется, когда час достаточно
// высок, чтобы она читалась, а не сливалась в шум. Порог по КОММИЧЕННОМУ
// hourH — как и текст-фит блоков, линия догоняет зум на отпускании.
// На рельсе подписей «HH:30» нет вовсе (запрос владельца 2026-07-27:
// «только часовая») — время между часами называет красная капсула «сейчас».
const HALF_MARK_MIN_H = 52;


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


// ═══ СОБЫТИЯ «ВЕСЬ ДЕНЬ» — ЧИПЫ В ЗАКРЕПЛЁННОЙ ПОЛОСЕ НАД СЕТКОЙ ═══
//
// Событие «весь день» — это ЗАПИСЬ (у неё статус, меню, отмена), но у неё нет
// «своей» высоты на оси времени: она либо врёт про час, либо закрывает сутки.
// Единственное честное место — полоса НАД осью, и так делают все календари.
//
// До этого они рисовались вертикальными полосками 8pt у левой кромки колонки —
// последним уцелевшим корешком в продукте (владелец 2026-09-05: «когда слева
// только полосочка — это полная хрень»). У полоски не было ни имени, ни намёка
// на него, и она отжимала таймированные блоки вправо.
//
// Внутрь колонки чип класть нельзя технически: вся геометрия `DayColumn` —
// проценты от анимируемой высоты, и узел фиксированной высоты ломает инвариант,
// пересчитывая layout на каждом кадре щипка.
export const allDayOf = (appts: readonly Appointment[]): Appointment[] =>
  appts.filter((a) => a.event_all_day === true);

export const hasAllDay = (appts: readonly Appointment[]): boolean =>
  appts.some((a) => a.event_all_day === true);

/** Высота полосы: минимальный блок продукта в одну строку плюс дыхание, но не
 *  меньше 36pt. Тридцать шесть — не про текст, а про ПАЛЕЦ: чип с запасом
 *  касания 4pt даёт мишень 44pt, как требует закон продукта. Растить дальше
 *  нельзя — полоса стоит между шапкой и сеткой и каждую точку отнимает у
 *  первого видимого часа. */
export function useAllDayBandH(): number {
  const { fontScale } = useWindowDimensions();
  return Math.max(36, MIN_H(Math.ceil(16 * Math.min(fontScale, 1.3))) + 4);
}

export function AllDayRow({
  appointments,
  clientName,
  teamColorFor,
  onEdit,
  onMenu,
  onOverflow,
}: {
  /** УЖЕ отфильтрованные события «весь день» этого дня (`allDayOf`). */
  appointments: Appointment[];
  clientName: (a: Appointment) => string;
  teamColorFor?: (a: Appointment) => string | null;
  onEdit: (a: Appointment) => void;
  onMenu?: (a: Appointment) => void;
  /** Куда ведёт «+N». БЕЗ ЭТОГО ПРОПА СПРЯТАННЫЕ СОБЫТИЯ НЕДОСТИЖИМЫ: в
   *  колонке недели помещается ровно один чип, и второй отпуск открыть было бы
   *  нечем — прежние полоски хотя бы все были кликабельны. Неделя передаёт сюда
   *  «открыть этот день»: в Дне колонка вмещает девять чипов. */
  onOverflow?: () => void;
}) {
  const t = useThemeColors();
  const blockColors = useBlockColors(teamColorFor);
  const { fontScale } = useWindowDimensions();
  const lineH = Math.ceil(16 * Math.min(fontScale, 1.3));
  const [cellW, setCellW] = useState(0);

  // ПРАВИЛО ОСТАНОВКИ. Чипы делят ширину поровну, но их число ограничено снизу
  // читаемой шириной: в колонке недели (~49pt) помещается РОВНО ОДИН чип, и
  // пять отпусков пяти мастеров дают один чип с именем и счётчиком «+4», а не
  // пять безымянных плашек по 7pt.
  //
  // РЕЗЕРВ ПОД «+N» УЧИТЫВАЕТСЯ ДО РЕШЕНИЯ, А НЕ ПОСЛЕ. Это ровно та ошибка,
  // которую продукт уже ловил у блока записи: там `markReserve` вычитался из
  // ширины ПОСЛЕ того, как решено «имя влезает», и просроченный блок недели
  // оставался немым. Здесь она повторялась в чипе: у последнего чипа со
  // счётчиком отнимается ещё и резерв, а гейт числа чипов об этом не знал.
  const shown = chipsThatFit(cellW, appointments.length);
  const overflow = appointments.length - shown;
  const chipW = shown > 0 ? (cellW - CHIP_GAP * (shown - 1)) / shown : 0;

  return (
    <View
      // Линия сетки слева — та же, что у колонки: полоса читается продолжением
      // сетки, а не отдельной плитой.
      onLayout={(e) => setCellW(e.nativeEvent.layout.width - 1)}
      style={{
        flex: 1,
        flexDirection: "row",
        gap: CHIP_GAP,
        paddingVertical: 2,
        borderLeftWidth: 1,
        borderLeftColor: `${t.ink}33`,
        backgroundColor: t.surface,
      }}
    >
      {cellW > 0
        ? appointments.slice(0, shown).map((a, i) => {
            const c = blockColors(a);
            const cancelled = a.status === "cancelled";
            const reserve =
              overflow > 0 && i === shown - 1 ? chipOverflowW(overflow) : 0;
            const pad = chipPad(chipW);
            const textW = chipTextW(chipW, reserve);
            const name = clientName(a) || a.comment || "Событие";
            return (
              <Pressable
                key={a.id}
                onPress={() => onEdit(a)}
                onLongPress={onMenu ? () => onMenu(a) : undefined}
                delayLongPress={350}
                // 36pt полосы плюс 4pt запаса с каждой стороны — мишень 44pt,
                // как требует закон продукта. Наружу больше не растим: снизу
                // сразу первый час сетки, и лишние точки крали бы у него тап
                // «создать запись».
                hitSlop={{ top: 4, bottom: 4 }}
                accessibilityRole="button"
                accessibilityLabel={`Весь день, ${name}${
                  reserve > 0 ? `, ещё ${overflow}` : ""
                }`}
                style={({ pressed }) => ({
                  flex: 1,
                  minWidth: 0,
                  justifyContent: "center",
                  paddingHorizontal: pad,
                  borderWidth: 1,
                  borderColor: cancelled ? CANCELLED_EDGE : c.contour,
                  borderStyle: cancelled ? CANCELLED_BORDER : "solid",
                  borderRadius: t.radius.card,
                  borderCurve: "continuous",
                  overflow: "hidden",
                  // Тот же плотный рецепт, что у блока сетки (вариант 7).
                  backgroundColor: cancelled
                    ? fillRgba(t.ink, pressed ? 0.2 : 0.0784)
                    : pressed
                      ? c.pressed
                      : c.solid,
                })}
              >
                {/* УГЛОВЫХ ЗНАКОВ У ЧИПА НЕТ СОЗНАТЕЛЬНО: «просрочено» к
                    событию неприменимо по построению, а галка «выполнено» на
                    25pt высоты рядом с текстом — тот самый шум. Выполненное
                    событие гаснет заливкой, как блок. */}
                {textW >= TEXT_MIN_W ? (
                  <Text
                    numberOfLines={1}
                    ellipsizeMode={textW < 96 ? "clip" : "tail"}
                    maxFontSizeMultiplier={1.3}
                    style={{
                      color: cancelled ? t.ink : BLOCK_TEXT,
                      fontSize: 13,
                      lineHeight: lineH,
                      fontWeight: "700",
                      marginRight: reserve,
                      textDecorationLine: cancelled ? "line-through" : "none",
                    }}
                  >
                    {name}
                  </Text>
                ) : null}
                {reserve > 0 ? (
                  // «+N» — СВОЯ ДВЕРЬ, а не подпись. Тап по чипу открывает
                  // ПЕРВОЕ событие, и без отдельной мишени остальные были бы
                  // недостижимы вовсе. Мишень узкая по ширине, но во всю высоту
                  // полосы и с запасом наружу.
                  <Pressable
                    onPress={onOverflow}
                    disabled={!onOverflow}
                    hitSlop={{ top: 4, bottom: 4, right: 4, left: 2 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Ещё ${overflow} на весь день`}
                    style={{
                      position: "absolute",
                      right: pad,
                      top: 0,
                      bottom: 0,
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      maxFontSizeMultiplier={1.2}
                      style={{
                        fontSize: 11,
                        fontWeight: "700",
                        // «+N» лежит на плотной заливке чипа — белым, как имя.
                        color: BLOCK_TEXT,
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {`+${overflow}`}
                    </Text>
                  </Pressable>
                ) : null}
              </Pressable>
            );
          })
        : null}
    </View>
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
              style={[
                labelStyle,
                { top: h === startHour ? 0 : -7, fontVariant: ["tabular-nums"] },
              ]}
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
            style={[labelStyle, { top: -7, fontVariant: ["tabular-nums"] }]}
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
            maxFontSizeMultiplier={1.2}
            style={{
              fontSize: 11,
              fontWeight: "700",
              color: t.onAccent,
              fontVariant: ["tabular-nums"],
            }}
          >
            {minToHM(nowInWin)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// One day lane: gridlines, off-hours wash, past-wash, empty-slot tap,
// positioned blocks, now-line.
// Reused by both DayView (1 column) and WeekView (N columns).
//
// Structure: the hour grid is a column of FLEX cells (one per hour) that
// carry the hour line (borderTop) and the
// create-slot Pressable in one node; washes/buffers/blocks/now-line are
// percent-positioned overlays. The column has NO pixel geometry of its own —
// it stretches to the animated row height (see zoom module note above), so
// nothing here renders, measures or animates during a pinch.
//
// `memo` (`dayColumnPropsEqual`): у недели смонтирована двадцать одна колонка,
// и перерисовка экрана без смены данных колонки не должна их трогать. Полоса
// графика, записи дня и свободные слоты приходят новыми объектами с тем же
// содержимым — их сравнение по содержимому объяснено в `grid-memo.ts`.
export const DayColumn = memo(function DayColumn({
  dateYmd,
  appointments,
  clientName,
  serviceLabel,
  addressFor,
  teamColorFor,
  offLabelColorFor,
  isToday,
  todayYmd,
  compact = false,
  onEdit,
  onMenu,
  onCreateAt,
  onSlotLongPress,
  editingId = null,
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
  /** Куда ехать — четвёртая строка блока: снимок адреса записи, иначе адрес
   *  клиента. null — не показывать. */
  addressFor?: (a: Appointment) => string | null;
  teamColorFor?: (a: Appointment) => string | null;
  /** Цвет метки САМОЙ записи, когда она отличается от метки дня
   *  (`resolveOffDayLabel`): блок получает ТОЧКУ этим цветом в нижнем углу —
   *  периметр занят цветом самой записи. Владелец 2026-09-04: «можно
   *  подсвечивать другим цветом, когда метка другая». null — обычный блок. */
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
  /** Долгое нажатие по свободному времени — быстрое меню («Перерыв»,
   *  «Метка дня») без формы записи. */
  onSlotLongPress?: (dateYmd: string, timeStart: string) => void;
  /** Запись в режиме правки («Двигать и растягивать» из меню записи): только
   *  у неё палец двигает и тянет за края, и только пока режим включён. */
  editingId?: string | null;
  onReschedule?: (
    a: Appointment,
    newStart: string,
    newEnd: string,
    date?: string,
  ) => void;
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

  // СТОПКИ узкой колонки (Неделя): записи на одно время — одна карточка с
  // «+N»; тап открывает их списком.
  const [deckOpen, setDeckOpen] = useState<PlacedAppt[] | null>(null);
  const placements = useMemo(
    () =>
      layoutDay(appointments.filter((a) => a.event_all_day !== true)).filter(
        (p) => p.endMin > winStartMin && p.startMin < winEndMin,
      ),
    [appointments, winStartMin, winEndMin],
  );

  const decks = useMemo(() => decksFor(placements, laneW), [placements, laneW]);
  const openDeck = (apt: Appointment) => {
    const deck = decks.get(apt.id);
    if (!deck) return onEdit(apt);
    haptics.tap();
    setDeckOpen(deck.members);
  };

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

  /** Время под пальцем в ячейке часа, с шагом TAP_STEP. */
  const slotTime = (hour: number, locationY: number) => {
    // Sub-hour snap by touch position (web handleColumnClick parity):
    // floor to multiples of TAP_STEP, so a tap at 11:27 creates 11:00, at
    // 11:40 → 11:30. Screen-reader activation has no coordinates → whole
    // hour, matching the accessibilityLabel.
    const step = TAP_STEP;
    const offset = Math.min(
      60 - step,
      Math.floor(((locationY / hourH) * 60) / step) * step,
    );
    return minToHM(hour * 60 + Math.max(0, offset));
  };
  const onSlotPress = (hour: number, locationY: number) => {
    if (!onCreateAt) return;
    onCreateAt(dateYmd, slotTime(hour, locationY));
  };

  return (
    <View
      onLayout={(e) => setLaneW(e.nativeEvent.layout.width)}
      style={{
        flex: 1,
        position: "relative",
        // Колонка с записью в свободном перемещении — поверх соседних:
        // иначе запись, утащенная в соседний день, уходила бы ПОД его белую
        // колонку и пропадала из-под пальца.
        zIndex: editingId && appointments.some((a) => a.id === editingId) ? 10 : 0,
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
            // ДОЛГОЕ НАЖАТИЕ ПО СВОБОДНОМУ ВРЕМЕНИ (владелец 2026-09-24:
            // «перерыв — интересная идея»): разметка дня без формы записи.
            onLongPress={
              onSlotLongPress
                ? (e) =>
                    onSlotLongPress(
                      dateYmd,
                      slotTime(h, e?.nativeEvent?.locationY ?? 0),
                    )
                : undefined
            }
            delayLongPress={400}
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
            accessibilityLabel={`Свободно в ${time}`}
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
          (cancelled skipped). Placements already exclude all-day events — те
          живут чипами в полосе НАД сеткой — and carry the parsed endMin. */}
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

      {/* ЛИНИЯ «СЕЙЧАС» ЛЕЖИТ ПОД ЗАПИСЯМИ, А НЕ ПОВЕРХ НИХ. Сверху она
          перечёркивала карточку ровно по строке времени — а зачёркивание в
          этом продукте уже занято и означает ОТМЕНЁННУЮ запись: работа, которая
          идёт прямо сейчас, выглядела снятой. Ничего при этом не теряется: где
          мы во времени, говорит красная капсула на рельсе часов — она живёт вне
          колонки и никогда ничем не закрыта, — а в пустых местах колонки линия
          видна как прежде. Рельс отвечает за время, сетка — за записи.
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
        ? placements.map((p) => {
            const deck = decks.get(p.apt.id);
            return (
            <AppointmentBlock
              key={p.apt.id}
              placed={p}
              deckIndex={deck?.index}
              deckSize={deck?.size}
              hourH={hourH}
              laneW={laneW}
              startHour={startHour}
              endHour={endHour}
              stepMinutes={Math.max(5, Math.min(60, stepMinutes))}
              colors={blockColors(p.apt)}
              offLabelColor={offLabelColorFor ? offLabelColorFor(p.apt) : null}
              label={clientName(p.apt) || p.apt.comment || "Запись"}
              service={serviceLabel ? serviceLabel(p.apt) : p.apt.comment || null}
              address={addressFor ? addressFor(p.apt) : null}
              lineH={lineH}
              onMenu={onMenu}
              editing={editingId === p.apt.id}
              dayW={compact && laneW > 0 ? laneW + 1 : undefined}
              overdue={isOverdue(p.apt, todayYmd, isToday ? nowMinutes : null)}
              // Тап по стопке — список её записей, а не первая попавшаяся.
              onEdit={deck ? openDeck : onEdit}
              onReschedule={
                canReschedule?.(p.apt) === false ? undefined : onReschedule
              }
            />
            );
          })
        : null}

      <PickerSheet
        visible={deckOpen != null}
        title={deckOpen ? `${minToHM(deckOpen[0].startMin)} · ${deckOpen.length} ${deckOpen.length < 5 ? "записи" : "записей"}` : ""}
        onClose={() => setDeckOpen(null)}
        items={(deckOpen ?? []).map((p) => ({
          id: p.apt.id,
          label: clientName(p.apt) || p.apt.comment || "Запись",
          hint: `${p.apt.time_start}–${p.apt.time_end}`,
          icon: CalendarClock,
          color: blockColors(p.apt).solid,
          onPress: () => onEdit(p.apt),
        }))}
      />

    </View>
  );
}, dayColumnPropsEqual);

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
//
// `memo` — по той же причине, что у WeekView: пропсы экран держит стабильными.
export const DayView = memo(function DayView({
  dateYmd,
  apptsFor,
  todayYmd,
  clientName,
  serviceLabel,
  addressFor,
  teamColorFor,
  offLabelColorFor,
  onEdit,
  onMenu,
  onCreateAt,
  onSlotLongPress,
  editingId = null,
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
  /** Куда ехать — четвёртая строка блока: снимок адреса записи, иначе адрес
   *  клиента. null — не показывать. */
  addressFor?: (a: Appointment) => string | null;
  teamColorFor?: (a: Appointment) => string | null;
  /** Цвет чужой метки записи — окантовка блока (см. DayColumn). */
  offLabelColorFor?: (a: Appointment) => string | null;
  onEdit: (a: Appointment) => void;
  /** Долгое нажатие без движения по блоку — контекстное меню записи. */
  onMenu?: (a: Appointment) => void;
  onCreateAt?: (dateYmd: string, timeStart: string) => void;
  /** Долгое нажатие по свободному времени — быстрое меню («Перерыв»,
   *  «Метка дня») без формы записи. */
  onSlotLongPress?: (dateYmd: string, timeStart: string) => void;
  /** Запись в режиме правки («Двигать и растягивать» из меню записи): только
   *  у неё палец двигает и тянет за края, и только пока режим включён. */
  editingId?: string | null;
  onReschedule?: (
    a: Appointment,
    newStart: string,
    newEnd: string,
    date?: string,
  ) => void;
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
  /** Час, на котором календарь открывается: начало графика команды в этот
   *  день (см. `deriveScrollHour`). */
  scrollToHour?: number;
  /** Метка дня по дате (undefined — у команды нет меток, шапки чистые). */
  labelFor?: (dateYmd: string) => { name: string; color: string } | null;
  onDayLabelTap?: () => void;
}) {
  const t = useThemeColors();
  const pager = usePeriodPager({ periodKey: dateYmd, onCommit: onCommitPage });
  const dateAt = (off: -1 | 0 | 1) => addDaysYmd(dateYmd, off);
  const bandH = useAllDayBandH();
  // Условие по ВСЕМ трём страницам пейджера: иначе чип выскакивал бы уже после
  // доводки свайпа, а высота полосы менялась бы под пальцем.
  const showBand = ([-1, 0, 1] as const).some((off) =>
    hasAllDay(apptsFor(dateAt(off))),
  );

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
      {showBand ? (
        <View
          style={{
            flexDirection: "row",
            borderBottomWidth: 1,
            borderBottomColor: `${t.ink}1a`,
          }}
        >
          {/* Рельс слева пустой: подпись «Весь день» — ровно тот шум, который
              из продукта убирают, и 13pt в 48pt рельса не влезает. */}
          <View style={{ width: RAIL_W, backgroundColor: t.surface }} />
          <PagedStrip
            pager={pager}
            style={{ height: bandH }}
            renderPage={(off) => (
              <AllDayRow
                appointments={allDayOf(apptsFor(dateAt(off)))}
                clientName={clientName}
                teamColorFor={teamColorFor}
                onEdit={onEdit}
                onMenu={onMenu}
              />
            )}
          />
        </View>
      ) : null}
      <ZoomableTimeGrid
        hourHSv={hourHSv}
        scrollLocked={!!editingId}
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
                addressFor={addressFor}
                teamColorFor={teamColorFor}
                offLabelColorFor={offLabelColorFor}
                isToday={d === todayYmd}
                todayYmd={todayYmd}
                onEdit={onEdit}
                onMenu={onMenu}
                onCreateAt={onCreateAt}
                onSlotLongPress={onSlotLongPress}
                editingId={editingId}
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
                // «Сейчас» — только странице сегодня: соседние страницы его не
                // читают, а тик раз в минуту перерисовывал бы и их.
                nowMinutes={d === todayYmd ? nowMinutes : null}
              />
            );
          }}
        />
      </ZoomableTimeGrid>
    </View>
  );
});
