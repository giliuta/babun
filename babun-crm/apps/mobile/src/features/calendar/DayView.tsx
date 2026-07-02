import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  Gesture,
  GestureDetector,
  ScrollView,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Check } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { STATUS_LABELS } from "@babun/shared/local/appointments";
import { pad2 } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import { layoutDay, type PlacedAppt } from "@/features/calendar/layout";
import { useBlockColors, type BlockColors } from "@/features/calendar/status-colors";

export const HOUR_H = 64;
export const RAIL_W = 48;
const GAP = 3;
// Visible window fallback — mirrors shared DEFAULT_CALENDAR_SETTINGS
// (startHour 0 / endHour 24): the grid shows the whole day, work hours
// only drive the grey off-hours wash.
const DEFAULT_START = 0;
const DEFAULT_END = 24;
// Snap granularity fallback — mirrors DEFAULT_CALENDAR_SETTINGS.gridStep.
// Callers pass settings.gridStep (15/30/60) like the web DayColumn's
// snapMinutes; it drives both drag snapping and empty-slot creation.
const DEFAULT_STEP = 30;
// All-day events render as thin strips on the left edge of the column
// (web DayColumn v496) instead of joining the overlap layout.
const ALL_DAY_W = 8;
const ALL_DAY_GAP = 2;

const minToHM = (min: number) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

function Block({
  placed,
  laneX,
  laneW,
  startHour,
  endHour,
  stepMinutes,
  colors,
  label,
  service,
  compact,
  onEdit,
  onReschedule,
}: {
  placed: PlacedAppt;
  laneX: number;
  laneW: number;
  startHour: number;
  endHour: number;
  stepMinutes: number;
  colors: BlockColors;
  label: string;
  service: string | null;
  compact: boolean;
  onEdit: (a: Appointment) => void;
  onReschedule: (a: Appointment, s: string, e: string) => void;
}) {
  const t = useThemeColors();
  const { apt, startMin, endMin, colIndex, colCount } = placed;
  const ty = useSharedValue(0);
  const active = useSharedValue(0);

  const winStart = startHour * 60;
  const winEnd = endHour * 60;
  // Clamp into the visible window (web windowStart/windowEnd semantics):
  // a block starting before the window pins to the top instead of getting
  // a negative top and vanishing above the grid.
  const visStart = Math.max(startMin, winStart);
  const visEnd = Math.min(endMin, winEnd);
  const colW = laneW / colCount;
  const top = ((visStart - winStart) / 60) * HOUR_H;
  const height = Math.max(((visEnd - visStart) / 60) * HOUR_H - 2, 22);
  const left = laneX + colIndex * colW + 1;
  const width = colW - GAP;
  const cancelled = apt.status === "cancelled";
  const completed = apt.status === "completed";

  const commit = (translationY: number) => {
    const duration = Math.max(15, endMin - startMin);
    // Base the move on the UNCLAMPED startMin (like moveBy below), not on
    // the clamped visual `top`: a block clipped by the visible window
    // (e.g. 06:30 with startHour=7) must keep its real start, not get
    // silently pinned to the window edge. The DELTA snaps to gridStep so
    // an off-grid start keeps its offset — exactly what the a11y actions
    // do.
    const step = Math.max(5, Math.min(60, stepMinutes));
    const deltaMin =
      Math.round(((translationY / HOUR_H) * 60) / step) * step;
    let newStart = startMin + deltaMin;
    // Clamp into the window, but never TIGHTER than where the block
    // already sits — a clipped block may legitimately stay clipped.
    const lo = Math.min(startMin, winStart);
    const hi = Math.max(endMin, winEnd) - duration;
    newStart = Math.max(lo, Math.min(hi, newStart));
    if (newStart === startMin) return;
    onReschedule(apt, minToHM(newStart), minToHM(newStart + duration));
  };

  const moveBy = (deltaMin: number) => {
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
      runOnJS(commit)(e.translationY);
      ty.value = withSpring(0);
      active.value = withSpring(0);
    });
  const tap = Gesture.Tap()
    .maxDuration(250)
    .onEnd(() => runOnJS(onEdit)(apt));
  const gesture = Gesture.Exclusive(pan, tap);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }, { scale: 1 + active.value * 0.03 }],
    zIndex: active.value > 0 ? 20 : 1,
    shadowColor: "#000",
    shadowOpacity: active.value * 0.25,
    shadowRadius: active.value * 8,
    shadowOffset: { width: 0, height: 3 },
  }));

  const tall = height > 34;

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${apt.time_start}–${apt.time_end}, ${label}, ${STATUS_LABELS[apt.status]}`}
        accessibilityActions={[
          { name: "activate", label: "Открыть" },
          { name: "increment", label: `Позже на ${stepMinutes} минут` },
          { name: "decrement", label: `Раньше на ${stepMinutes} минут` },
        ]}
        onAccessibilityAction={(e) => {
          const action = e.nativeEvent.actionName;
          if (action === "activate") onEdit(apt);
          else if (action === "increment") moveBy(stepMinutes);
          else if (action === "decrement") moveBy(-stepMinutes);
        }}
        style={[
          {
            position: "absolute",
            top,
            left,
            width,
            height,
            backgroundColor: colors.fill,
            borderLeftColor: colors.stripe,
            borderLeftWidth: 3,
            borderRadius: 6,
            paddingHorizontal: compact ? 3 : 6,
            paddingVertical: 2,
            overflow: "hidden",
            opacity: cancelled ? 0.55 : 1,
          },
          style,
        ]}
      >
        <View
          style={{ position: "absolute", top: 0, left: 3, right: 0, height: 1, backgroundColor: t.highlight }}
        />
        <Text
          style={{ color: colors.base, fontSize: compact ? 9 : 11, fontWeight: "700", opacity: 0.9 }}
          className="tabular-nums"
          numberOfLines={1}
        >
          {apt.time_start}
        </Text>
        <Text
          style={{
            color: t.ink,
            fontSize: compact ? 9 : 11,
            fontWeight: "700",
            textDecorationLine: cancelled ? "line-through" : "none",
          }}
          numberOfLines={tall ? 2 : 1}
        >
          {label}
        </Text>
        {tall && !compact && service ? (
          <Text style={{ color: t.sub, fontSize: 11 }} numberOfLines={1}>
            {service}
          </Text>
        ) : null}
        {completed && !compact ? (
          <View
            style={{
              position: "absolute",
              top: 3,
              right: 3,
              height: 15,
              width: 15,
              borderRadius: 8,
              backgroundColor: t.success,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Check color="#fff" size={10} strokeWidth={3} />
          </View>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

// The fixed hour-label rail on the left of the grid.
export function TimeRail({
  startHour = DEFAULT_START,
  endHour = DEFAULT_END,
}: {
  startHour?: number;
  endHour?: number;
}) {
  const t = useThemeColors();
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = startHour; h <= endHour; h++) out.push(h);
    return out;
  }, [startHour, endHour]);
  return (
    <View style={{ width: RAIL_W, height: (endHour - startHour) * HOUR_H }}>
      {hours.map((h) => (
        <Text
          key={h}
          style={{
            position: "absolute",
            top: (h - startHour) * HOUR_H - (h === startHour ? 0 : 7),
            right: 6,
            width: RAIL_W - 8,
            textAlign: "right",
            color: t.sub,
            fontSize: 12,
            fontWeight: "600",
          }}
          className="tabular-nums"
        >
          {`${pad2(h % 24)}:00`}
        </Text>
      ))}
    </View>
  );
}

// One day lane: gridlines, off-hours wash, past-wash, empty-slot tap,
// positioned blocks, all-day strips, now-line.
// Reused by both DayView (1 column) and WeekView (N columns).
export function DayColumn({
  dateYmd,
  appointments,
  clientName,
  serviceLabel,
  teamColorFor,
  isToday,
  compact = false,
  onEdit,
  onCreateAt,
  onReschedule,
  startHour = DEFAULT_START,
  endHour = DEFAULT_END,
  stepMinutes = DEFAULT_STEP,
  workStartHour,
  workEndHour,
  nowMinutes,
}: {
  dateYmd: string;
  appointments: Appointment[];
  clientName: (a: Appointment) => string;
  serviceLabel?: (a: Appointment) => string | null;
  teamColorFor?: (a: Appointment) => string | null;
  isToday: boolean;
  compact?: boolean;
  onEdit: (a: Appointment) => void;
  onCreateAt: (dateYmd: string, timeStart: string) => void;
  onReschedule: (a: Appointment, newStart: string, newEnd: string) => void;
  startHour?: number;
  endHour?: number;
  /** Snap granularity for drag + empty-slot taps (settings.gridStep) —
   *  web DayColumn `snapMinutes` semantics. */
  stepMinutes?: number;
  /** Work band — everything outside gets the grey off-hours wash (web
   *  DayColumn out-of-hours overlays). Defaults to the visible window. */
  workStartHour?: number;
  workEndHour?: number;
  /** Current time in minutes since midnight (business timezone), ticked
   *  by the parent every minute. Null/undefined → no now-line. */
  nowMinutes?: number | null;
}) {
  const t = useThemeColors();
  const blockColors = useBlockColors(teamColorFor);
  const [laneW, setLaneW] = useState(0);

  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = startHour; h <= endHour; h++) out.push(h);
    return out;
  }, [startHour, endHour]);
  const totalH = (endHour - startHour) * HOUR_H;
  const winStartMin = startHour * 60;
  const winEndMin = endHour * 60;

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
  const nowTop = nowMin != null ? (nowMin / 60) * HOUR_H : null;
  const halfLine = t.dark ? "rgba(255,255,255,0.05)" : "rgba(60,60,67,0.07)";

  const workStart = Math.max((workStartHour ?? startHour) * 60, winStartMin);
  const workEnd = Math.min((workEndHour ?? endHour) * 60, winEndMin);

  return (
    <View
      onLayout={(e) => setLaneW(e.nativeEvent.layout.width)}
      style={{
        flex: 1,
        height: totalH,
        position: "relative",
        borderLeftWidth: 1,
        borderLeftColor: t.separator,
      }}
    >
      {/* off-hours wash: before work start / after work end */}
      {workStart > winStartMin ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: ((workStart - winStartMin) / 60) * HOUR_H,
            backgroundColor: t.pressed,
          }}
        />
      ) : null}
      {workEnd < winEndMin ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: ((workEnd - winStartMin) / 60) * HOUR_H,
            left: 0,
            right: 0,
            height: ((winEndMin - workEnd) / 60) * HOUR_H,
            backgroundColor: t.pressed,
          }}
        />
      ) : null}

      {nowTop != null ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: nowTop,
            // dark: 0.02 неотличима от фона на реальном OLED — 0.055 даёт
            // едва заметный, но читаемый wash (light не трогаем).
            backgroundColor: t.dark ? "rgba(255,255,255,0.055)" : "rgba(11,18,32,0.02)",
          }}
        />
      ) : null}

      {hours.map((h) => (
        <View key={h}>
          <View
            style={{
              position: "absolute",
              top: (h - startHour) * HOUR_H,
              left: 0,
              right: 0,
              height: 1,
              backgroundColor: t.separator,
            }}
          />
          {h < endHour ? (
            <View
              style={{
                position: "absolute",
                top: (h - startHour) * HOUR_H + HOUR_H / 2,
                left: 0,
                right: 0,
                height: 1,
                backgroundColor: halfLine,
              }}
            />
          ) : null}
        </View>
      ))}

      {hours.slice(0, -1).map((h) => (
        <Pressable
          key={`slot-${h}`}
          onPress={(e) => {
            // Sub-hour snap by touch position (web handleColumnClick
            // parity): floor to multiples of gridStep, so a tap at 11:27
            // with a 30-min step creates 11:00, at 11:40 → 11:30. Screen-
            // reader activation has no coordinates → whole hour, matching
            // the accessibilityLabel.
            const step = Math.max(5, Math.min(60, stepMinutes));
            const y = e?.nativeEvent?.locationY ?? 0;
            const offset = Math.min(
              60 - step,
              Math.floor(((y / HOUR_H) * 60) / step) * step,
            );
            onCreateAt(dateYmd, minToHM(h * 60 + Math.max(0, offset)));
          }}
          accessibilityRole="button"
          accessibilityLabel={`Создать запись в ${pad2(h)}:00`}
          style={{
            position: "absolute",
            top: (h - startHour) * HOUR_H,
            left: 0,
            right: 0,
            height: HOUR_H,
          }}
        />
      ))}

      {allDay.map((a, idx) => {
        const c = blockColors(a);
        return (
          <Pressable
            key={a.id}
            onPress={() => onEdit(a)}
            accessibilityRole="button"
            accessibilityLabel={`Весь день, ${clientName(a) || a.comment || "Событие"}`}
            style={{
              position: "absolute",
              top: 1,
              bottom: 1,
              left: idx * (ALL_DAY_W + ALL_DAY_GAP),
              width: ALL_DAY_W,
              borderRadius: 4,
              backgroundColor: c.stripe,
              opacity: a.status === "cancelled" ? 0.4 : 0.85,
            }}
          />
        );
      })}

      {laneW > 0
        ? placements.map((p) => (
            <Block
              key={p.apt.id}
              placed={p}
              laneX={reservedW}
              laneW={Math.max(laneW - reservedW, 0)}
              startHour={startHour}
              endHour={endHour}
              stepMinutes={Math.max(5, Math.min(60, stepMinutes))}
              colors={blockColors(p.apt)}
              label={clientName(p.apt) || p.apt.comment || "Запись"}
              service={serviceLabel ? serviceLabel(p.apt) : p.apt.comment || null}
              compact={compact}
              onEdit={onEdit}
              onReschedule={onReschedule}
            />
          ))
        : null}

      {nowTop != null ? (
        <View
          style={{
            position: "absolute",
            top: nowTop,
            left: -4,
            right: 0,
            flexDirection: "row",
            alignItems: "center",
          }}
          pointerEvents="none"
        >
          <View style={{ height: 9, width: 9, borderRadius: 5, backgroundColor: t.danger }} />
          <View style={{ height: 1.5, flex: 1, backgroundColor: t.danger, opacity: 0.85 }} />
        </View>
      ) : null}
    </View>
  );
}

// Single-day grid: hour rail + one day column, vertically scrollable.
export function DayView({
  dateYmd,
  appointments,
  clientName,
  serviceLabel,
  teamColorFor,
  isToday,
  onEdit,
  onCreateAt,
  onReschedule,
  onPrev,
  onNext,
  startHour = DEFAULT_START,
  endHour = DEFAULT_END,
  stepMinutes = DEFAULT_STEP,
  workStartHour,
  workEndHour,
  nowMinutes,
  scrollToHour,
}: {
  dateYmd: string;
  appointments: Appointment[];
  clientName: (a: Appointment) => string;
  serviceLabel?: (a: Appointment) => string | null;
  teamColorFor?: (a: Appointment) => string | null;
  isToday: boolean;
  onEdit: (a: Appointment) => void;
  onCreateAt: (dateYmd: string, timeStart: string) => void;
  onReschedule: (a: Appointment, newStart: string, newEnd: string) => void;
  onPrev?: () => void;
  onNext?: () => void;
  startHour?: number;
  endHour?: number;
  stepMinutes?: number;
  workStartHour?: number;
  workEndHour?: number;
  nowMinutes?: number | null;
  /** Auto-scroll target on open (settings.scrollOpenHour). */
  scrollToHour?: number;
}) {
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (scrollToHour == null) return;
    const y = Math.max(0, (scrollToHour - startHour) * HOUR_H);
    const raf = requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ y, animated: false }),
    );
    return () => cancelAnimationFrame(raf);
  }, [scrollToHour, startHour]);

  const swipe = Gesture.Pan()
    .activeOffsetX([-25, 25])
    .failOffsetY([-18, 18])
    .onEnd((e) => {
      if (e.translationX > 55 && onPrev) runOnJS(onPrev)();
      else if (e.translationX < -55 && onNext) runOnJS(onNext)();
    });
  return (
    <GestureDetector gesture={swipe}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 120, paddingTop: 6 }}
      >
        <View style={{ flexDirection: "row" }}>
          <TimeRail startHour={startHour} endHour={endHour} />
          <DayColumn
            dateYmd={dateYmd}
            appointments={appointments}
            clientName={clientName}
            serviceLabel={serviceLabel}
            teamColorFor={teamColorFor}
            isToday={isToday}
            onEdit={onEdit}
            onCreateAt={onCreateAt}
            onReschedule={onReschedule}
            startHour={startHour}
            endHour={endHour}
            stepMinutes={stepMinutes}
            workStartHour={workStartHour}
            workEndHour={workEndHour}
            nowMinutes={nowMinutes}
          />
        </View>
      </ScrollView>
    </GestureDetector>
  );
}
