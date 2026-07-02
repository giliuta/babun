import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, SectionList, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { Screen } from "@/components/ui/Screen";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import { formatYMD, humanDay, parseYMD } from "@/features/appointments/helpers";
import { AppointmentSheet } from "@/features/appointments/AppointmentSheet";
import { DayView } from "@/features/calendar/DayView";
import { WeekView } from "@/features/calendar/WeekView";
import { type CalMode } from "@/features/calendar/ViewModeDropdown";
import { CalendarHeader } from "@/features/calendar/CalendarHeader";
import { MiniCalendar } from "@/features/calendar/MiniCalendar";
import { TeamChips } from "@/features/calendar/TeamChips";
import { MonthView } from "@/features/calendar/MonthView";
import { DayFinanceFooter } from "@/features/calendar/DayFinanceFooter";
import { useAppointments } from "@/features/calendar/queries";
import { useUpdateAppointment } from "@/features/calendar/mutations";
import { useToast } from "@/components/ui/Toast";
import { useClients } from "@/features/clients/queries";
import { useServices } from "@/features/services/queries";
import { useTeams } from "@/features/reference/queries";
import { useCalendarSettings } from "@/features/settings/local-settings";

// Agenda horizon — web AgendaView parity («what's next», not «this month»).
const AGENDA_HORIZON_DAYS = 60;

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function mondayOf(d: Date) {
  const x = startOfDay(d);
  const wd = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - wd);
  return x;
}
function addDays(d: Date, n: number) {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}
function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function AppointmentRow({
  apt,
  clientName,
  serviceSummary,
  onPress,
}: {
  apt: Appointment;
  clientName: string;
  serviceSummary: string;
  onPress: () => void;
}) {
  const th = useThemeColors();
  const debt = getDebtAmount(apt);
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-4 py-3 active:opacity-60"
      style={{ backgroundColor: th.surface }}
    >
      <View className="w-14">
        <Text className="text-sm font-semibold tabular-nums" style={{ color: th.ink }}>
          {apt.time_start}
        </Text>
        <Text className="text-xs tabular-nums" style={{ color: th.sub }}>{apt.time_end}</Text>
      </View>
      <View className="ml-2 flex-1 border-l pl-3" style={{ borderColor: th.separator }}>
        <Text className="text-base font-semibold" style={{ color: th.ink }} numberOfLines={1}>
          {clientName || apt.comment || "Запись"}
        </Text>
        {serviceSummary || apt.comment ? (
          <Text className="text-sm" style={{ color: th.sub }} numberOfLines={1}>
            {serviceSummary || apt.comment}
          </Text>
        ) : null}
        <View className="mt-1 flex-row items-center gap-2">
          <StatusBadge status={apt.status} />
        </View>
      </View>
      {apt.total_amount ? (
        <View className="ml-2 items-end">
          <Text className="text-sm font-semibold tabular-nums" style={{ color: th.ink }}>
            {formatEUR(apt.total_amount)}
          </Text>
          {debt > 0 ? (
            <Text className="text-xs tabular-nums" style={{ color: th.danger }}>
              {formatEUR(debt)} к оплате
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export default function CalendarTab() {
  const { data: appts = [], isLoading, error } = useAppointments();
  const { data: clients = [] } = useClients();
  const { data: services = [] } = useServices();
  const { data: teams = [] } = useTeams();
  const { data: calSettings } = useCalendarSettings();
  const updateAppt = useUpdateAppointment();
  const toast = useToast();

  const reschedule = (apt: Appointment, newStart: string, newEnd: string) => {
    if (apt.time_start === newStart) return;
    updateAppt.mutate(
      { id: apt.id, patch: { time_start: newStart, time_end: newEnd } },
      {
        onSuccess: () => toast(`Перенесено на ${newStart}`),
        onError: () => toast("Не удалось перенести"),
      },
    );
  };

  const router = useRouter();
  const params = useLocalSearchParams<{
    new?: string;
    clientId?: string;
    locationId?: string;
    teamId?: string;
    date?: string;
  }>();

  const [mode, setMode] = useState<CalMode>("week");
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [miniCalOpen, setMiniCalOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [bookDefaults, setBookDefaults] = useState<
    {
      date?: string;
      time_start?: string;
      client_id?: string | null;
      location_id?: string | null;
      team_id?: string | null;
    } | undefined
  >(undefined);

  // «Now» in the BUSINESS timezone (settings.timezone, web parity), ticked
  // every minute so the now-line / past-wash / isToday stay live while the
  // screen is open — including across midnight.
  const timezone = calSettings?.timezone;
  const readNow = useCallback(
    () => (timezone ? getCurrentTimeInZone(timezone) : getCurrentCyprusTime()),
    [timezone],
  );
  const [now, setNow] = useState(readNow);
  useEffect(() => {
    setNow(readNow());
    const id = setInterval(() => setNow(readNow()), 60000);
    return () => clearInterval(id);
  }, [readNow]);
  const todayYmd = formatYMD(now);
  const tomorrowYmd = formatYMD(addDays(now, 1));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  useEffect(() => {
    if (params.new === "1") {
      setEditing(null);
      setBookDefaults({
        client_id: params.clientId ?? null,
        // «Записать сюда» / «Записать ТО» с карточки клиента шлют объект —
        // предвыбираем его в шите (LOCKED «Карта-диспетчер»: букинг в 2 тапа).
        location_id: params.locationId ?? null,
        team_id: params.teamId ?? null,
      });
      setSheetOpen(true);
      router.setParams({
        new: undefined,
        clientId: undefined,
        locationId: undefined,
        teamId: undefined,
      });
    } else if (params.date) {
      const d = parseYMD(params.date);
      setCursor(startOfMonth(d));
      setDay(startOfDay(d));
      router.setParams({ date: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.new, params.clientId, params.date]);

  const nameById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.full_name])),
    [clients],
  );
  const clientName = (a: Appointment) =>
    a.client_id ? nameById.get(a.client_id) ?? "" : "";

  const serviceNameById = useMemo(
    () => new Map(services.map((s) => [s.id, s.name])),
    [services],
  );
  // «Чистка, x2 Диагностика» — web AgendaView service summary.
  const serviceSummaryFor = useCallback(
    (a: Appointment) => {
      const qty = new Map<string, number>();
      for (const id of a.service_ids) qty.set(id, (qty.get(id) ?? 0) + 1);
      return [...qty.entries()]
        .map(([id, q]) => {
          const name = serviceNameById.get(id) ?? "Услуга";
          return q > 1 ? `x${q} ${name}` : name;
        })
        .join(", ");
    },
    [serviceNameById],
  );
  const serviceLabel = useCallback(
    (a: Appointment) => serviceSummaryFor(a) || a.comment || null,
    [serviceSummaryFor],
  );

  const teamColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const tm of teams as { id: string; color?: string | null }[]) {
      if (tm.color) m.set(tm.id, tm.color);
    }
    return m;
  }, [teams]);
  const teamColorFor = useCallback(
    (a: Appointment) => (a.team_id ? teamColor.get(a.team_id) ?? null : null),
    [teamColor],
  );

  const hideCancelled = !!calSettings?.hideCancelled;
  const byTeam = (a: Appointment) =>
    (teamFilter ? a.team_id === teamFilter : true) &&
    (!hideCancelled || a.status !== "cancelled");

  // Team-filtered set — MonthView counts every visible cell (incl. the
  // prev/next-month tails) and the MiniCalendar dots from this.
  const visibleAppts = useMemo(
    () => appts.filter(byTeam),
    [appts, teamFilter, hideCancelled],
  );

  const dayYmd = formatYMD(day);
  const dayAppts = useMemo(
    () => visibleAppts.filter((a) => a.date === dayYmd),
    [visibleAppts, dayYmd],
  );

  const weekDays = useMemo(() => {
    const mon = mondayOf(day);
    return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  }, [day]);
  const threeDays = useMemo(
    () => Array.from({ length: 3 }, (_, i) => addDays(day, i)),
    [day],
  );
  const gridDays = mode === "3days" ? threeDays : weekDays;
  const gridYmds = useMemo(() => gridDays.map(formatYMD), [gridDays]);
  const gridAppts = useMemo(
    () => visibleAppts.filter((a) => gridYmds.includes(a.date)),
    [visibleAppts, gridYmds],
  );

  // Agenda — «what's next»: from the selected day forward 60 days
  // (web AgendaView HORIZON_DAYS), not the cursor month.
  const agendaSections = useMemo(() => {
    const startKey = formatYMD(day);
    const endKey = formatYMD(addDays(day, AGENDA_HORIZON_DAYS));
    const filtered = visibleAppts
      .filter((a) => a.date >= startKey && a.date <= endKey)
      .sort((a, b) =>
        a.date !== b.date
          ? a.date.localeCompare(b.date)
          : a.time_start.localeCompare(b.time_start),
      );
    const byDate = new Map<string, Appointment[]>();
    for (const a of filtered) {
      const arr = byDate.get(a.date) ?? [];
      arr.push(a);
      byDate.set(a.date, arr);
    }
    return [...byDate.entries()].map(([d, data]) => ({ title: d, data }));
  }, [visibleAppts, day]);

  const agendaHeader = (ymdStr: string) => {
    if (ymdStr === todayYmd) return "Сегодня";
    if (ymdStr === tomorrowYmd) return "Завтра";
    return humanDay(ymdStr);
  };

  const openCreate = (defaults?: typeof bookDefaults) => {
    setEditing(null);
    setBookDefaults(defaults);
    setSheetOpen(true);
  };
  const openEdit = (apt: Appointment) => {
    setEditing(apt);
    setBookDefaults(undefined);
    setSheetOpen(true);
  };

  const t = useThemeColors();

  const headerTitle = (
    mode === "week" ? weekDays[3] : mode === "month" ? cursor : day
  )
    .toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
    .replace(/\s*г\.?\s*$/i, "");

  const isOnToday =
    mode === "month"
      ? cursor.getFullYear() === now.getFullYear() &&
        cursor.getMonth() === now.getMonth()
      : mode === "week" || mode === "3days"
        ? gridYmds.includes(todayYmd)
        : dayYmd === todayYmd;

  const goToday = () => {
    setDay(startOfDay(now));
    setCursor(startOfMonth(now));
  };
  const jumpToDate = (d: Date) => {
    setDay(startOfDay(d));
    setCursor(startOfMonth(d));
    setMiniCalOpen(false);
  };
  const prevMonth = () =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
  const nextMonth = () =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));
  const monthSwipe = Gesture.Pan()
    .activeOffsetX([-25, 25])
    .failOffsetY([-18, 18])
    .onEnd((e) => {
      if (e.translationX > 55) runOnJS(prevMonth)();
      else if (e.translationX < -55) runOnJS(nextMonth)();
    });

  // Visible grid window = settings.startHour/endHour (web parity, default
  // 0..24). workStartHour/EndHour only paint the grey off-hours wash.
  const visStartHour = calSettings?.startHour ?? 0;
  const visEndHour = calSettings?.endHour ?? 24;
  const scrollToHour =
    calSettings?.scrollOpenHour ?? calSettings?.workStartHour ?? 9;

  const gridProps = {
    clientName,
    serviceLabel,
    teamColorFor,
    onEdit: openEdit,
    onReschedule: reschedule,
    startHour: visStartHour,
    endHour: visEndHour,
    // «Шаг сетки» (15/30/60) — drives drag snapping and empty-slot taps,
    // like the web DayColumn snapMinutes.
    stepMinutes: calSettings?.gridStep ?? 30,
    workStartHour: calSettings?.workStartHour,
    workEndHour: calSettings?.workEndHour,
    nowMinutes,
    scrollToHour,
  };

  const pickDay = (d: Date) => {
    setDay(startOfDay(d));
    setMode("day");
  };

  return (
    <Screen>
      <CalendarHeader
        monthTitle={headerTitle}
        mode={mode}
        todayNumber={now.getDate()}
        isOnToday={isOnToday}
        onModeChange={setMode}
        onGear={() => router.push("/cabinet")}
        onTitlePress={() => setMiniCalOpen(true)}
        onToday={goToday}
      />
      <TeamChips teams={teams} activeId={teamFilter} onSelect={setTeamFilter} />

      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : error ? (
        <EmptyState state="error" fill subtitle={(error as Error).message} />
      ) : mode === "agenda" ? (
        <SectionList
          style={{ flex: 1 }}
          sections={agendaSections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled
          contentContainerStyle={{ paddingBottom: 96, flexGrow: 1 }}
          renderSectionHeader={({ section }) => (
            <Text
              className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider"
              style={{ backgroundColor: t.canvas, color: t.sub }}
            >
              {agendaHeader(section.title)}
            </Text>
          )}
          renderItem={({ item }) => (
            <AppointmentRow
              apt={item}
              clientName={clientName(item)}
              serviceSummary={serviceSummaryFor(item)}
              onPress={() => openEdit(item)}
            />
          )}
          ItemSeparatorComponent={() => <View className="h-px" style={{ backgroundColor: t.separator }} />}
          ListEmptyComponent={
            <EmptyState
              title="Записей не запланировано"
              subtitle={`Ближайшие ${AGENDA_HORIZON_DAYS} дней пусты`}
              action={{ label: "Новая запись", onPress: () => openCreate() }}
            />
          }
        />
      ) : mode === "week" || mode === "3days" ? (
        <>
          <WeekView
            days={gridDays}
            appointments={gridAppts}
            today={now}
            onCreateAt={(d, timeStart) =>
              openCreate({ date: d, time_start: timeStart })
            }
            onPickDay={pickDay}
            onPrev={() => setDay((d) => addDays(d, -gridDays.length))}
            onNext={() => setDay((d) => addDays(d, gridDays.length))}
            {...gridProps}
          />
          <DayFinanceFooter
            days={gridDays}
            appointments={gridAppts}
            teamId={teamFilter}
            todayYmd={todayYmd}
            onTapDay={pickDay}
          />
        </>
      ) : mode === "day" ? (
        <>
          <DayView
            dateYmd={dayYmd}
            appointments={dayAppts}
            isToday={dayYmd === todayYmd}
            onCreateAt={(d, timeStart) =>
              openCreate({ date: d, time_start: timeStart })
            }
            onPrev={() => setDay((d) => addDays(d, -1))}
            onNext={() => setDay((d) => addDays(d, 1))}
            {...gridProps}
          />
          <DayFinanceFooter
            days={[day]}
            appointments={dayAppts}
            teamId={teamFilter}
            todayYmd={todayYmd}
          />
        </>
      ) : (
        <GestureDetector gesture={monthSwipe}>
          <View className="flex-1">
            <MonthView
              month={cursor}
              appointments={visibleAppts}
              todayYmd={todayYmd}
              onPickDay={(d) => {
                setDay(startOfDay(d));
                setCursor(startOfMonth(d));
                setMode("day");
              }}
            />
          </View>
        </GestureDetector>
      )}

      <MiniCalendar
        visible={miniCalOpen}
        currentDate={day}
        todayYmd={todayYmd}
        appointments={visibleAppts}
        onSelectDate={jumpToDate}
        onClose={() => setMiniCalOpen(false)}
      />

      <AppointmentSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        appointment={editing}
        defaults={bookDefaults}
      />
    </Screen>
  );
}
