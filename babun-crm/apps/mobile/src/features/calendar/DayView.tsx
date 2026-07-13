import { useMemo, useState } from "react";
import { Pressable, Text, View, type DimensionValue } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { Check } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { STATUS_LABELS } from "@babun/shared/local/appointments";
import { pad2 } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import { layoutDay, type PlacedAppt } from "@/features/calendar/layout";
import { useBlockColors, type BlockColors } from "@/features/calendar/status-colors";
import { ZoomableTimeGrid } from "@/features/calendar/zoom";

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

// Per-date work band (minutes since midnight) resolved from team_schedules
// by the parent via shared getDayScheduleForDate — web DayColumn.tsx:231.
export type WorkBand = { startMin: number; endMin: number };

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
// wash, buffer bands.
function MinuteBand({
  fromMin,
  toMin,
  winStartMin,
  winEndMin,
  color,
}: {
  fromMin: number;
  toMin: number;
  winStartMin: number;
  winEndMin: number;
  color: string;
}) {
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
      }}
    />
  );
}

function Block({
  placed,
  hourH,
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
  /** Committed pixels-per-hour — px math (drag snap, text fit) only;
   *  the on-screen geometry is percent-based and zoom-independent. */
  hourH: number;
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

  const commit = (translationY: number) => {
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

  // The wrapper owns position + stacking (zIndex must live among siblings);
  // the card owns the drag transform + shadow, so the wrapper's percent
  // geometry stays untouched by the gesture springs.
  const wrapperStyle = useAnimatedStyle(() => ({
    zIndex: active.value > 0 ? 20 : 1,
  }));
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }, { scale: 1 + active.value * 0.03 }],
    shadowColor: "#000",
    shadowOpacity: active.value * 0.25,
    shadowRadius: active.value * 8,
    shadowOffset: { width: 0, height: 3 },
  }));

  // Committed-zoom px height (same formula the card renders to via percents;
  // the min-clamp cancels out) — drives how many text lines fit.
  const tall = ((visEnd - visStart) / 60) * hourH - 2 > 34;

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
              // 2px breathing gap to the next block (was `height - 2`).
              bottom: 2,
              backgroundColor: colors.fill,
              borderLeftColor: colors.stripe,
              borderLeftWidth: 3,
              borderRadius: 8,
              paddingHorizontal: compact ? 3 : 6,
              paddingVertical: 2,
              overflow: "hidden",
              opacity: cancelled ? 0.55 : 1,
            },
            cardStyle,
          ]}
        >
          <View
            style={{ position: "absolute", top: 0, left: 3, right: 0, height: 1, backgroundColor: t.highlight }}
          />
          <Text
            style={{ color: t.sub, fontSize: compact ? 9 : 11, fontWeight: "600" }}
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
      </Animated.View>
    </GestureDetector>
  );
}

// The fixed hour-label rail on the left of the grid: one flex cell per hour
// (equal split of the animated grid height), each label riding its cell top.
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
    for (let h = startHour; h < endHour; h++) out.push(h);
    return out;
  }, [startHour, endHour]);
  const labelStyle = {
    position: "absolute" as const,
    right: 6,
    width: RAIL_W - 8,
    textAlign: "right" as const,
    color: t.sub,
    fontSize: 12,
    fontWeight: "600" as const,
  };
  return (
    <View style={{ width: RAIL_W }}>
      {hours.map((h) => (
        <View key={h} style={{ flex: 1 }}>
          <Text
            style={[labelStyle, { top: h === startHour ? 0 : -7 }]}
            className="tabular-nums"
          >
            {`${pad2(h % 24)}:00`}
          </Text>
        </View>
      ))}
      {/* endHour label — anchored to the rail bottom, no cell needed. */}
      <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 0 }}>
        <Text style={[labelStyle, { top: -7 }]} className="tabular-nums">
          {`${pad2(endHour % 24)}:00`}
        </Text>
      </View>
    </View>
  );
}

// One day lane: gridlines, off-hours wash, past-wash, empty-slot tap,
// positioned blocks, all-day strips, now-line.
// Reused by both DayView (1 column) and WeekView (N columns).
//
// Structure: the hour grid is a column of FLEX cells (one per hour) that
// carry the hour line (borderTop), the half-hour line (top 50%) and the
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
  isToday,
  compact = false,
  onEdit,
  onCreateAt,
  onReschedule,
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
  const halfLine = t.dark ? "rgba(255,255,255,0.05)" : "rgba(60,60,67,0.07)";

  // Off-hours wash band: per-date team schedule wins (workBand), else the
  // global hour props. band === null → нерабочий день, wash suppressed
  // entirely (workStart/End collapse onto the window edges), matching web
  // DayColumn v473 (day-off signal lives in the header, body stays plain).
  const band =
    workBand === undefined
      ? {
          startMin: (workStartHour ?? startHour) * 60,
          endMin: (workEndHour ?? endHour) * 60,
        }
      : workBand;
  const workStart = band ? Math.max(band.startMin, winStartMin) : winStartMin;
  const workEnd = band ? Math.min(band.endMin, winEndMin) : winEndMin;

  const onSlotPress = (hour: number, locationY: number) => {
    // Sub-hour snap by touch position (web handleColumnClick parity):
    // floor to multiples of gridStep, so a tap at 11:27 with a 30-min step
    // creates 11:00, at 11:40 → 11:30. Screen-reader activation has no
    // coordinates → whole hour, matching the accessibilityLabel.
    const step = Math.max(5, Math.min(60, stepMinutes));
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
        borderLeftColor: t.separator,
        // ~5% alpha of the label colour — reads as a hue, not a fill, so
        // gridlines / washes / blocks above keep their contrast.
        backgroundColor: tintColor ? `${tintColor}0d` : undefined,
      }}
    >
      {/* off-hours wash: before work start / after work end */}
      {workStart > winStartMin ? (
        <MinuteBand
          fromMin={winStartMin}
          toMin={workStart}
          winStartMin={winStartMin}
          winEndMin={winEndMin}
          color={t.pressed}
        />
      ) : null}
      {workEnd < winEndMin ? (
        <MinuteBand
          fromMin={workEnd}
          toMin={winEndMin}
          winStartMin={winStartMin}
          winEndMin={winEndMin}
          color={t.pressed}
        />
      ) : null}

      {nowMin != null ? (
        // dark: 0.02 неотличима от фона на реальном OLED — 0.055 даёт
        // едва заметный, но читаемый wash (light не трогаем).
        <MinuteBand
          fromMin={winStartMin}
          toMin={winStartMin + nowMin}
          winStartMin={winStartMin}
          winEndMin={winEndMin}
          color={t.dark ? "rgba(255,255,255,0.055)" : "rgba(11,18,32,0.02)"}
        />
      ) : null}

      {/* hour cells: gridline + half-line + create-slot in one flex node */}
      {hours.map((h) => (
        <Pressable
          key={h}
          onPress={(e) => onSlotPress(h, e?.nativeEvent?.locationY ?? 0)}
          accessibilityRole="button"
          accessibilityLabel={`Создать запись в ${pad2(h)}:00`}
          style={{
            flex: 1,
            borderTopWidth: 1,
            borderTopColor: t.separator,
          }}
        >
          <View
            style={{
              position: "absolute",
              top: "50%",
              left: 0,
              right: 0,
              height: 1,
              backgroundColor: halfLine,
            }}
          />
        </Pressable>
      ))}
      {/* closing line of the last hour */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 1,
          backgroundColor: t.separator,
        }}
      />

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
              hourH={hourH}
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
    </View>
  );
}

// Sticky date header above the day grid — web parity (DayColumn header):
// the user must always see WHICH day is open. Same visual language as the
// WeekView days-row: uppercase weekday, 26pt date circle (cobalt = today),
// red weekends. `label` reserves the slot for the per-day city tag.
const WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function DayHeader({
  dateYmd,
  isToday,
  label,
  onLabelTap,
}: {
  dateYmd: string;
  isToday: boolean;
  /** Метка дня (город бригады) — web parity DayColumn city pill. */
  label?: { name: string; color: string } | null;
  onLabelTap?: () => void;
}) {
  const t = useThemeColors();
  const [y, m, d] = dateYmd.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  return (
    <View
      style={{
        alignItems: "center",
        paddingBottom: 4,
        paddingTop: 2,
        borderBottomWidth: 1,
        borderBottomColor: t.separator,
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: "600",
          color: weekend ? t.danger : t.faint,
          textTransform: "uppercase",
        }}
      >
        {WEEKDAYS_RU[(date.getDay() + 6) % 7]}
      </Text>
      <View
        style={{
          marginTop: 2,
          height: 26,
          minWidth: 26,
          borderRadius: 13,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: isToday ? t.accent : "transparent",
          paddingHorizontal: 6,
        }}
      >
        <Text
          className="tabular-nums"
          style={{
            fontSize: 15,
            fontWeight: "700",
            color: isToday ? "#fff" : weekend ? t.danger : t.ink,
          }}
        >
          {date.getDate()}
        </Text>
      </View>
      {/* Пилл метки дня: короткое имя (3 буквы, web parity slice(0,3));
          без метки — тихий «+ метка». Тап открывает пикер. */}
      {onLabelTap ? (
        <Pressable
          onPress={onLabelTap}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={label ? `Метка дня: ${label.name}` : "Задать метку дня"}
          className="mt-1 rounded-full px-2 py-0.5 active:opacity-70"
          style={{ backgroundColor: label ? `${label.color}1f` : t.fill }}
        >
          <Text
            style={{
              fontSize: 10,
              fontWeight: "700",
              letterSpacing: 0.5,
              textTransform: "uppercase",
              color: label ? label.color : t.faint,
            }}
          >
            {label ? label.name.slice(0, 3) : "+ метка"}
          </Text>
        </Pressable>
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
  hourH,
  hourHSv,
  onZoom,
  workStartHour,
  workEndHour,
  workBandFor,
  labelTintFor,
  bufferMinutes,
  nowMinutes,
  scrollToHour,
  dayLabel,
  onDayLabelTap,
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
  /** Per-date day-label colour → light column wash; undefined resolver
   *  when team.tint_days_by_label is off (see DayColumn.tintColor). */
  labelTintFor?: (dateYmd: string) => string | null;
  /** Buffer after each appointment (team ?? global), minutes. */
  bufferMinutes?: number;
  nowMinutes?: number | null;
  /** Auto-scroll target on open (settings.scrollOpenHour). */
  scrollToHour?: number;
  /** Метка дня для шапки (город бригады). */
  dayLabel?: { name: string; color: string } | null;
  onDayLabelTap?: () => void;
}) {
  return (
    <View style={{ flex: 1 }}>
      <DayHeader
        dateYmd={dateYmd}
        isToday={isToday}
        label={dayLabel}
        onLabelTap={onDayLabelTap}
      />
      <ZoomableTimeGrid
        hourHSv={hourHSv}
        onZoom={onZoom}
        startHour={startHour}
        endHour={endHour}
        scrollToHour={scrollToHour}
        onPrev={onPrev}
        onNext={onNext}
      >
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
          hourH={hourH}
          workStartHour={workStartHour}
          workEndHour={workEndHour}
          workBand={workBandFor?.(dateYmd)}
          tintColor={labelTintFor?.(dateYmd) ?? null}
          bufferMinutes={bufferMinutes}
          nowMinutes={nowMinutes}
        />
      </ZoomableTimeGrid>
    </View>
  );
}
