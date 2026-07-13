import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import type { Appointment } from "@babun/shared/local/appointments";
import { formatYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import {
  DayColumn,
  TimeRail,
  RAIL_W,
  type WorkBand,
} from "@/features/calendar/DayView";
import { ZoomableTimeGrid } from "@/features/calendar/zoom";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Week / 3-day grid: a fixed day-header row + a shared hour rail with N day
// columns. Reuses DayColumn so the block/gridline/now-line rendering is
// identical to the day view (now-line is scoped to today's column).
// The finance footer is rendered by the parent (under both this and DayView).
export function WeekView({
  days,
  appointments,
  clientName,
  serviceLabel,
  teamColorFor,
  today,
  onEdit,
  onCreateAt,
  onReschedule,
  onPickDay,
  onPrev,
  onNext,
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
  days: Date[];
  appointments: Appointment[];
  clientName: (a: Appointment) => string;
  serviceLabel?: (a: Appointment) => string | null;
  teamColorFor?: (a: Appointment) => string | null;
  today: Date;
  onEdit: (a: Appointment) => void;
  onCreateAt: (dateYmd: string, timeStart: string) => void;
  onReschedule: (a: Appointment, s: string, e: string) => void;
  onPickDay: (d: Date) => void;
  onPrev: () => void;
  onNext: () => void;
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
  /** Day label (city/tag) for the header pill — resolved by the parent:
   *  explicit day_cities → team default_city (web DayColumn city pill).
   *  No picker here: tapping a header opens the day view, whose header
   *  pill is the tappable one (web parity). */
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

  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const arr = m.get(a.date) ?? [];
      arr.push(a);
      m.set(a.date, arr);
    }
    return m;
  }, [appointments]);

  return (
    <View style={{ flex: 1 }}>
      {/* day headers */}
      <View
        style={{
          flexDirection: "row",
          paddingBottom: 4,
          borderBottomWidth: 1,
          // В тон линиям сетки (20% ink) — шапка «прошита» той же сеткой.
          borderBottomColor: `${t.ink}33`,
        }}
      >
        <View style={{ width: RAIL_W }} />
        {days.map((d) => {
          const isToday = sameDay(d, today);
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          const dayAppts = byDay.get(formatYMD(d)) ?? [];
          const label = labelFor?.(formatYMD(d)) ?? null;
          return (
            <Pressable
              key={formatYMD(d)}
              onPress={() => onPickDay(d)}
              accessibilityRole="button"
              accessibilityLabel={`${d.getDate()} ${d.toLocaleDateString("ru-RU", { month: "long" })}${isToday ? ", сегодня" : ""}${dayAppts.length > 0 ? `, записей: ${dayAppts.length}` : ""}${label ? `, метка: ${label.name}` : ""}`}
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
                    color: isToday ? "#fff" : weekend ? t.danger : t.ink,
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
                    dayAppts.length > 0
                      ? isToday
                        ? t.accent
                        : t.faint
                      : "transparent",
                }}
              />
              {/* Метка дня — web DayColumn header, variant C: цветной текст
                  (3 буквы) + 3px спайн по нижней кромке колонки. Скана
                  недели читается рядом цветных полосок. Рендерится после
                  точки занятости, чтобы точка держала одну высоту. */}
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
                      bottom: -4,
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

      {/* grid */}
      <ZoomableTimeGrid
        hourHSv={hourHSv}
        onZoom={onZoom}
        startHour={startHour ?? 0}
        endHour={endHour ?? 24}
        scrollToHour={scrollToHour}
        onPrev={onPrev}
        onNext={onNext}
      >
        <TimeRail startHour={startHour} endHour={endHour} />
        {days.map((d) => (
          <DayColumn
            key={formatYMD(d)}
            dateYmd={formatYMD(d)}
            appointments={byDay.get(formatYMD(d)) ?? []}
            clientName={clientName}
            serviceLabel={serviceLabel}
            teamColorFor={teamColorFor}
            isToday={sameDay(d, today)}
            compact={days.length > 3}
            onEdit={onEdit}
            onCreateAt={onCreateAt}
            onReschedule={onReschedule}
            startHour={startHour}
            endHour={endHour}
            stepMinutes={stepMinutes}
            hourH={hourH}
            workStartHour={workStartHour}
            workEndHour={workEndHour}
            workBand={workBandFor?.(formatYMD(d))}
            tintColor={labelTintFor?.(formatYMD(d)) ?? null}
            bufferMinutes={bufferMinutes}
            nowMinutes={nowMinutes}
          />
        ))}
      </ZoomableTimeGrid>
    </View>
  );
}
