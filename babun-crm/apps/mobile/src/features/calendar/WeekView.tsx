import { useEffect, useMemo, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import {
  Gesture,
  GestureDetector,
  ScrollView,
} from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import type { Appointment } from "@babun/shared/local/appointments";
import { formatYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import {
  DayColumn,
  TimeRail,
  RAIL_W,
  HOUR_H_DEFAULT,
  usePinchZoom,
  type WorkBand,
} from "@/features/calendar/DayView";

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
  hourH = HOUR_H_DEFAULT,
  onZoom,
  workStartHour,
  workEndHour,
  workBandFor,
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
  hourH?: number;
  onZoom?: (next: number) => void;
  workStartHour?: number;
  workEndHour?: number;
  /** Per-date work band from team_schedules — resolved per column, so
   *  weekday overrides / days off differ across the week (web DayColumn
   *  parity). See DayColumn.workBand for the null/undefined semantics. */
  workBandFor?: (dateYmd: string) => WorkBand | null | undefined;
  /** Buffer after each appointment (team ?? global), minutes. */
  bufferMinutes?: number;
  nowMinutes?: number | null;
  scrollToHour?: number;
}) {
  const t = useThemeColors();
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (scrollToHour == null) return;
    const y = Math.max(0, (scrollToHour - (startHour ?? 0)) * hourH);
    const raf = requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ y, animated: false }),
    );
    return () => cancelAnimationFrame(raf);
    // hourH intentionally excluded: zoom must NOT re-fire the open-scroll.
  }, [scrollToHour, startHour]);

  const zoom = usePinchZoom({
    scrollRef,
    hourH,
    startHour: startHour ?? 0,
    endHour: endHour ?? 24,
    onZoom,
  });
  const swipe = Gesture.Pan()
    .activeOffsetX([-25, 25])
    .failOffsetY([-18, 18])
    .onEnd((e) => {
      if (e.translationX > 55) runOnJS(onPrev)();
      else if (e.translationX < -55) runOnJS(onNext)();
    });

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
    <GestureDetector gesture={Gesture.Race(swipe, zoom.pinch)}>
    <View style={{ flex: 1 }}>
      {/* day headers */}
      <View
        style={{
          flexDirection: "row",
          paddingBottom: 4,
          borderBottomWidth: 1,
          borderBottomColor: t.separator,
        }}
      >
        <View style={{ width: RAIL_W }} />
        {days.map((d) => {
          const isToday = sameDay(d, today);
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          const dayAppts = byDay.get(formatYMD(d)) ?? [];
          return (
            <Pressable
              key={formatYMD(d)}
              onPress={() => onPickDay(d)}
              accessibilityRole="button"
              accessibilityLabel={`${d.getDate()} ${d.toLocaleDateString("ru-RU", { month: "long" })}${isToday ? ", сегодня" : ""}${dayAppts.length > 0 ? `, записей: ${dayAppts.length}` : ""}`}
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
            </Pressable>
          );
        })}
      </View>

      {/* grid */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 120, paddingTop: 6 }}
        onScroll={zoom.onScroll}
        onLayout={zoom.onLayout}
        scrollEventThrottle={16}
      >
        <View style={{ flexDirection: "row" }}>
          <TimeRail startHour={startHour} endHour={endHour} hourH={hourH} />
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
              bufferMinutes={bufferMinutes}
              nowMinutes={nowMinutes}
            />
          ))}
        </View>
      </ScrollView>
    </View>
    </GestureDetector>
  );
}
