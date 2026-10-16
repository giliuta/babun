import { memo, useMemo, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { pluralize } from "@babun/shared/common/utils/pluralize";
import { useThemeColors } from "@/theme/colors";
import {
  decksFor,
  layoutDay,
  type PlacedAppt,
} from "@/features/calendar/layout";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { CalendarClock } from "lucide-react-native";
import { useBlockColors } from "@/features/calendar/status-colors";
import { isOverdue } from "@/features/calendar/overdue";
import { useUnstretchedStyle } from "@/features/calendar/zoom";
import { AppointmentBlock } from "@/features/calendar/AppointmentBlock";
import { minToHM } from "@/features/calendar/grid-units";
import { dayColumnPropsEqual } from "@/features/calendar/grid-memo";
import { BufferBands } from "./BufferBands";
import { ColumnWashes } from "./ColumnWashes";
import { DEFAULT_END, DEFAULT_START, DEFAULT_STEP } from "./constants";
import type { DayColumnProps } from "./day-column-props";
import { FreeSlotCubes } from "./FreeSlotCubes";
import { HourCells } from "./HourCells";
import { NowLine } from "./NowLine";
import { workWash } from "./work-wash";

// ZOOM GEOMETRY. Pinch-to-zoom animates ONE value — the grid row height in
// ZoomableTimeGrid — on the UI thread. Everything inside a column is
// positioned in PERCENT of the column height (or flex), so Yoga re-derives
// the whole grid from that single animated height, frame-for-frame, with no
// per-element animated styles and zero React involvement. Pixel-based
// derivations (tap→time, drag→minutes, text fit) use the committed `hourH`
// prop, which the pinch updates once per gesture via onZoom.

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
}: DayColumnProps) {
  const t = useThemeColors();
  // Линия «сейчас» в щипке держит форму точки (см. `useUnstretchedStyle`).
  const nowUnstretched = useUnstretchedStyle();
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
    // Тик уже дал сам блок (`openWithTick`): второй здесь давал бы двойную
    // вибрацию на тап по стопке.
    setDeckOpen(deck.members);
  };

  const nowMin =
    isToday && nowMinutes != null && nowMinutes >= winStartMin && nowMinutes <= winEndMin
      ? nowMinutes - winStartMin
      : null;
  // Сетка «как в Bumpix» (принцип «из чёрного, не серого»): линии и серый
  // нерабочих часов — альфа от ink поверх белого поля («прикрываем, не
  // скрываем»), а не бледные отдельные серые. 20% — отчётливая линия часа.
  const gridLine = `${t.ink}33`;
  // ВСЁ НЕРАБОЧЕЕ — ОДНИМ ЦВЕТОМ: часы до и после смены, перерыв и выходной
  // закрыты одним тёмным слоем (36%), подобранным на выходном.
  const offHoursFill = `${t.ink}5c`;

  const { band, workStart, workEnd, workSegs } = workWash({
    workBand,
    workStartHour,
    workEndHour,
    startHour,
    endHour,
  });

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
      <ColumnWashes
        dateYmd={dateYmd}
        isToday={isToday}
        todayYmd={todayYmd}
        compact={compact}
        tintColor={tintColor}
        band={band}
        workStart={workStart}
        workEnd={workEnd}
        workSegs={workSegs}
        winStartMin={winStartMin}
        winEndMin={winEndMin}
        offHoursFill={offHoursFill}
        nowMin={nowMin}
        nowMinutes={nowMinutes}
      />

      <HourCells
        hours={hours}
        hourH={hourH}
        gridLine={gridLine}
        dateYmd={dateYmd}
        onCreateAt={onCreateAt}
        onSlotLongPress={onSlotLongPress}
        freeSlots={freeSlots}
      />

      <FreeSlotCubes
        freeSlots={freeSlots}
        dateYmd={dateYmd}
        winStartMin={winStartMin}
        winEndMin={winEndMin}
        hourH={hourH}
        fontScale={fontScale}
        onCreateAt={onCreateAt}
      />

      {/* ПОДПИСИ «ВЫХОДНОЙ» НА КОЛОНКЕ НЕТ. Слово по центру пустого дня в Неделе ломалось
          на две строки в 50-точечной колонке и было ровно тем шумом, который из
          продукта убирают: серый уже сказал «здесь не работаем». Кто именно
          выходной — отвечает плашка листа при тапе по слоту («Нерабочий день
          команды»), и поставить запись всё равно можно. */}

      <BufferBands
        placements={placements}
        bufferMinutes={bufferMinutes}
        winStartMin={winStartMin}
        winEndMin={winEndMin}
      />

      {nowMin != null ? (
        <NowLine nowMin={nowMin} totalMin={totalMin} nowUnstretched={nowUnstretched} />
      ) : null}

      {laneW > 0
        ? placements.map((p) => {
            // ОТМЕНЁННАЯ В РЕЖИМЕ ВЫБОРА ВРЕМЕНИ НЕ РИСУЕТСЯ.
            // Время она не держит — под ней лежит зелёный кубик, а карточка
            // ложилась сверху: зачёркнутое имя и «11:00» кубика читались одно
            // поверх другого, и тап по кубику открывал отменённую запись.
            if (freeSlots !== undefined && p.apt.status === "cancelled") return null;
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
              // Шаг колонки — её ширина целиком: `onLayout` уже включает
              // левую линию колонки. С «+1» карточка на дальнем дне недели
              // уезжала на 6pt мимо колонки.
              dayW={compact && laneW > 0 ? laneW : undefined}
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
        // Начало стопки — самое раннее из её записей: первой в стопке лежит
        // самая короткая, и шапка показывала её время.
        title={
          deckOpen
            ? `${minToHM(Math.min(...deckOpen.map((p) => p.startMin)))} · ${pluralize(deckOpen.length, "запись", "записи", "записей")}`
            : ""
        }
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
