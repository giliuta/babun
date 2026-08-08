import { Pressable, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import type { Appointment } from "@babun/shared/local/appointments";
import { formatYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import {
  DayColumn,
  TimeRail,
  RAIL_W,
  HEADER_H,
  type WorkBand,
  type FreeSlotRange,
} from "@/features/calendar/DayView";
import { ZoomableTimeGrid } from "@/features/calendar/zoom";
import { PagedStrip, usePeriodPager } from "@/features/calendar/pager";
import { DateCell } from "@/features/calendar/date-header";

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function addDays(d: Date, n: number) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

// Week grid: live-paged day-header row + a shared hour rail with 7 day
// columns per page (prev/cur/next weeks ride the shared pager axis — swipe
// drags the neighbouring week in under the finger). Reuses DayColumn so the
// block/gridline/now-line rendering is identical to the day view.
// The finance footer is rendered by the parent (under both this and DayView).
export function WeekView({
  days,
  apptsFor,
  clientName,
  serviceLabel,
  teamColorFor,
  today,
  onEdit,
  onMenu,
  onCreateAt,
  onReschedule,
  canReschedule,
  onPickDay,
  onPickLabelDay,
  onCommitPage,
  startHour,
  endHour,
  stepMinutes,
  hourH,
  hourHSv,
  onZoom,
  workStartHour,
  workEndHour,
  workBandFor,
  freeSlotsFor,
  labelFor,
  labelTintFor,
  bufferMinutes,
  nowMinutes,
  scrollToHour,
}: {
  /** 7 дат центральной (закоммиченной) недели, Monday-first. */
  days: Date[];
  /** Записи по дате — страницы пейджера сами берут свои недели. */
  apptsFor: (dateYmd: string) => Appointment[];
  clientName: (a: Appointment) => string;
  serviceLabel?: (a: Appointment) => string | null;
  teamColorFor?: (a: Appointment) => string | null;
  today: Date;
  onEdit: (a: Appointment) => void;
  /** Долгое нажатие без движения по блоку — контекстное меню записи. */
  onMenu?: (a: Appointment) => void;
  /** Undefined for crew: empty slots and blocks are read-only. */
  onCreateAt?: (dateYmd: string, timeStart: string) => void;
  onReschedule?: (a: Appointment, s: string, e: string) => void;
  /** Per-record mutation guard (shared team events are creator-only). */
  canReschedule?: (a: Appointment) => boolean;
  /** Долгий тап по шапке даты — открыть её Днём. */
  onPickDay: (d: Date) => void;
  /** Тап по шапке даты — попап метки этой даты (undefined, когда у бригады
   *  нет меток: тогда и обычный тап открывает День). */
  onPickLabelDay?: (dateYmd: string) => void;
  /** Палец долистал страницу: родитель сдвигает неделю на ±7 дней. */
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
  /** Per-date work band from team_schedules — resolved per column, so
   *  weekday overrides / days off differ across the week (web DayColumn
   *  parity). See DayColumn.workBand for the null/undefined semantics. */
  workBandFor?: (dateYmd: string) => WorkBand | null | undefined;
  /** Режим подбора времени: зелёные кубики свободного в каждой колонке. */
  freeSlotsFor?: (dateYmd: string) => readonly FreeSlotRange[] | undefined;
  /** Day label (city/tag) for the header — resolved by the parent:
   *  explicit day_cities → team default_city (web DayColumn city pill).
   *  No picker here: tapping a header opens the day view, whose header
   *  is the tappable one (web parity). */
  labelFor?: (dateYmd: string) => { name: string; color: string } | null;
  /** Per-date day-label colour → light column wash; undefined resolver
   *  when team.tint_days_by_label is off (see DayColumn.tintColor). */
  labelTintFor?: (dateYmd: string) => string | null;
  /** Buffer after each appointment (team ?? global), minutes. */
  bufferMinutes?: number;
  nowMinutes?: number | null;
  scrollToHour?: number;
}) {
  const t = useThemeColors();
  const pager = usePeriodPager({
    periodKey: formatYMD(days[0]),
    onCommit: onCommitPage,
  });
  const weekAt = (off: -1 | 0 | 1) => days.map((d) => addDays(d, off * 7));

  return (
    <View style={{ flex: 1 }}>
      {/* Полоса шапок дат — страницы недель едут в локстепе с колонками;
          линия сетки живёт на обёртке и не скользит. Граница волосяная:
          шапка должна читаться продолжением сетки, а не отдельной плитой. */}
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
          renderPage={(off) => (
            <WeekHeaderRow
              days={weekAt(off)}
              today={today}
              apptsFor={apptsFor}
              labelFor={labelFor}
              onPickDay={onPickDay}
              onPickLabelDay={onPickLabelDay}
            />
          )}
        />
      </View>

      {/* grid */}
      <ZoomableTimeGrid
        hourHSv={hourHSv}
        onZoom={onZoom}
        startHour={startHour ?? 0}
        endHour={endHour ?? 24}
        scrollToHour={scrollToHour}
        pageGesture={pager.pan}
      >
        <TimeRail
          startHour={startHour}
          endHour={endHour}
          nowMinutes={
            days.some((d) => sameDay(d, today)) ? nowMinutes : null
          }
        />
        <PagedStrip
          pager={pager}
          renderPage={(off) => (
            <View style={{ flex: 1, flexDirection: "row" }}>
              {weekAt(off).map((d) => {
                const ymd = formatYMD(d);
                return (
                  <DayColumn
                    key={ymd}
                    dateYmd={ymd}
                    appointments={apptsFor(ymd)}
                    clientName={clientName}
                    serviceLabel={serviceLabel}
                    teamColorFor={teamColorFor}
                    isToday={sameDay(d, today)}
                    todayYmd={formatYMD(today)}
                    compact
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
                    workBand={workBandFor?.(ymd)}
                    freeSlots={freeSlotsFor?.(ymd)}
                    tintColor={labelTintFor?.(ymd) ?? null}
                    bufferMinutes={bufferMinutes}
                    nowMinutes={nowMinutes}
                  />
                );
              })}
            </View>
          )}
        />
      </ZoomableTimeGrid>
    </View>
  );
}

// Одна страница полосы шапок: 7 ячеек DateCell. Семантика (редизайн
// 2026-07-16 v2, по владельцу): тап = попап метки дня (когда метки есть,
// иначе сразу День), долгий тап = провалиться в День. «Выбранного дня»
// в Неделе нет — ничего не выделяется.
function WeekHeaderRow({
  days,
  today,
  apptsFor,
  labelFor,
  onPickDay,
  onPickLabelDay,
}: {
  days: Date[];
  today: Date;
  apptsFor: (dateYmd: string) => Appointment[];
  labelFor?: (dateYmd: string) => { name: string; color: string } | null;
  onPickDay: (d: Date) => void;
  onPickLabelDay?: (dateYmd: string) => void;
}) {
  const todayYmd = formatYMD(today);
  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      {days.map((d) => {
        const ymd = formatYMD(d);
        const isToday = sameDay(d, today);
        const count = apptsFor(ymd).length;
        const label = labelFor?.(ymd) ?? null;
        return (
          <Pressable
            key={ymd}
            onPress={() =>
              onPickLabelDay ? onPickLabelDay(ymd) : onPickDay(d)
            }
            onLongPress={() => onPickDay(d)}
            delayLongPress={350}
            accessibilityRole="button"
            accessibilityLabel={`${d.getDate()} ${d.toLocaleDateString("ru-RU", { month: "long" })}${isToday ? ", сегодня" : ""}${count > 0 ? `, записей: ${count}` : ""}${label ? `, метка: ${label.name}` : ""}`}
            accessibilityHint={
              onPickLabelDay
                ? "Нажатие меняет метку, долгое нажатие открывает день"
                : "Нажатие открывает день"
            }
            style={{ flex: 1 }}
          >
            <DateCell
              date={d}
              size="sm"
              isToday={isToday}
              isPast={ymd < todayYmd}
              count={count}
              label={label}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
