import { Pressable, Text, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import type { Appointment } from "@babun/shared/local/appointments";
import { formatYMD } from "@/features/appointments/helpers";
import { useThemeColors, type ThemeColors } from "@/theme/colors";
import {
  DayColumn,
  TimeRail,
  RAIL_W,
  HEADER_H,
  type WorkBand,
} from "@/features/calendar/DayView";
import { ZoomableTimeGrid } from "@/features/calendar/zoom";
import { PagedStrip, usePeriodPager } from "@/features/calendar/pager";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

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
  onCreateAt,
  onReschedule,
  onPickDay,
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
  onCreateAt: (dateYmd: string, timeStart: string) => void;
  onReschedule: (a: Appointment, s: string, e: string) => void;
  onPickDay: (d: Date) => void;
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
          линия сетки живёт на обёртке и не скользит. */}
      <View
        style={{
          flexDirection: "row",
          borderBottomWidth: 1,
          borderBottomColor: `${t.ink}33`,
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
              t={t}
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
        <TimeRail startHour={startHour} endHour={endHour} />
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
                    compact
                    onEdit={onEdit}
                    onCreateAt={onCreateAt}
                    onReschedule={onReschedule}
                    startHour={startHour}
                    endHour={endHour}
                    stepMinutes={stepMinutes}
                    hourH={hourH}
                    workStartHour={workStartHour}
                    workEndHour={workEndHour}
                    workBand={workBandFor?.(ymd)}
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

// Одна страница полосы шапок: 7 ячеек (день недели, число, точка занятости,
// метка + спайн). Тап по ячейке открывает день.
function WeekHeaderRow({
  days,
  today,
  apptsFor,
  labelFor,
  onPickDay,
  t,
}: {
  days: Date[];
  today: Date;
  apptsFor: (dateYmd: string) => Appointment[];
  labelFor?: (dateYmd: string) => { name: string; color: string } | null;
  onPickDay: (d: Date) => void;
  t: ThemeColors;
}) {
  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      {days.map((d) => {
        const ymd = formatYMD(d);
        const isToday = sameDay(d, today);
        const weekend = d.getDay() === 0 || d.getDay() === 6;
        const count = apptsFor(ymd).length;
        const label = labelFor?.(ymd) ?? null;
        return (
          <Pressable
            key={ymd}
            onPress={() => onPickDay(d)}
            accessibilityRole="button"
            accessibilityLabel={`${d.getDate()} ${d.toLocaleDateString("ru-RU", { month: "long" })}${isToday ? ", сегодня" : ""}${count > 0 ? `, записей: ${count}` : ""}${label ? `, метка: ${label.name}` : ""}`}
            style={{ flex: 1, alignItems: "center", paddingTop: 4 }}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: "600",
                color: weekend ? t.danger : t.faint,
                textTransform: "uppercase",
              }}
            >
              {WEEKDAYS[(d.getDay() + 6) % 7]}
            </Text>
            <View
              style={{
                marginTop: 2,
                height: 26,
                width: 26,
                borderRadius: 13,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: isToday ? t.accent : "transparent",
              }}
            >
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: "700",
                  color: isToday ? t.onAccent : weekend ? t.danger : t.ink,
                }}
                className="tabular-nums"
              >
                {d.getDate()}
              </Text>
            </View>
            {/* Presence dot (Apple/Google native): a filled dot when the day
                has bookings — denser than a raw count that reads like a
                second date. Exact count lives in the day view + a11y label. */}
            <View
              style={{
                marginTop: 3,
                height: 5,
                width: 5,
                borderRadius: 3,
                backgroundColor:
                  count > 0 ? (isToday ? t.accent : t.faint) : "transparent",
              }}
            />
            {/* Метка дня — web DayColumn header, variant C: цветной текст
                (3 буквы) + 3px спайн по нижней кромке (сидит на линии
                обёртки). Ряд недель читается рядом цветных полосок. */}
            {label ? (
              <>
                <Text
                  numberOfLines={1}
                  style={{
                    marginTop: 2,
                    fontSize: 9,
                    fontWeight: "700",
                    letterSpacing: 0.5,
                    textTransform: "uppercase",
                    color: label.color,
                  }}
                >
                  {label.name.slice(0, 3)}
                </Text>
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 6,
                    right: 6,
                    height: 3,
                    borderTopLeftRadius: 3,
                    borderTopRightRadius: 3,
                    backgroundColor: label.color,
                  }}
                />
              </>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
