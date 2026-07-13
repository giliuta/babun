import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  computeDayFinance,
  getDayMode,
} from "@babun/shared/local/finance/day-summary";
import { getDayExtras } from "@babun/shared/local/day-extras";
import { formatYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import { RAIL_W } from "@/features/calendar/DayView";
import { useDayExtras, useFinanceServices } from "@/features/calendar/queries";

// Thin money strip pinned under the day/week grid — per-day Доход (green) over
// Расход (red), aligned to the day columns (gutter width = the hour rail).
//
// Web parity (web DayFinanceFooter + shared day-summary): «Доход» is
// contextual — past days show what was actually EARNED (paid), today and
// future show the day's PLANNED revenue so a booked tomorrow never reads €0.
// «Расход» comes from computeDayFinance (materials + manual expenses +
// day extras), never a hardcoded zero.
export function DayFinanceFooter({
  days,
  appointments,
  teamId,
  todayYmd,
  onTapDay,
}: {
  days: Date[];
  appointments: Appointment[];
  /** Active team filter — day extras are stored per (team, date), so with
   *  no team selected extras are skipped (same as web's personal tab). */
  teamId: string | null;
  /** Business-timezone today (YYYY-MM-DD) — drives earned vs planned. */
  todayYmd: string;
  onTapDay?: (d: Date) => void;
}) {
  const t = useThemeColors();
  const sharedServices = useFinanceServices();
  const { data: extrasMap = {} } = useDayExtras();

  const byDate = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const arr = m.get(a.date) ?? [];
      arr.push(a);
      m.set(a.date, arr);
    }
    return m;
  }, [appointments]);

  return (
    <View
      style={{
        flexDirection: "row",
        borderTopWidth: 1,
        borderTopColor: t.separator,
        backgroundColor: t.surface,
        paddingVertical: 4,
      }}
    >
      {/* Лейблы — нейтральный t.sub: семантический цвет несут только суммы. */}
      <View style={{ width: RAIL_W, paddingRight: 5, alignItems: "flex-end", justifyContent: "center" }}>
        <Text style={{ fontSize: 9, fontWeight: "600", color: t.sub }}>Доход</Text>
        <Text style={{ fontSize: 9, fontWeight: "600", color: t.sub }}>Расход</Text>
      </View>
      {days.map((d, i) => {
        const ymd = formatYMD(d);
        const totals = computeDayFinance(
          byDate.get(ymd) ?? [],
          sharedServices,
          getDayExtras(extrasMap, teamId, ymd),
        );
        // Past → actually earned; today/future → planned revenue.
        const income =
          getDayMode(ymd, todayYmd) === "past" ? totals.earned : totals.planned;
        return (
          <Pressable
            key={ymd}
            onPress={() => onTapDay?.(d)}
            accessibilityRole="button"
            accessibilityLabel={`Финансы за ${ymd}: доход ${formatEUR(income)}, расход ${formatEUR(totals.spent)}`}
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: 1,
              borderLeftWidth: i === 0 ? 0 : 1,
              borderLeftColor: t.separator,
            }}
          >
            {/* €0 — приглушённый t.faint: зелёный/красный только там, где
                есть реальные деньги (цвет = смысл). */}
            <Text
              style={{ fontSize: days.length > 3 ? 10 : 12, fontWeight: "600", color: income !== 0 ? t.success : t.faint }}
              className="tabular-nums"
              numberOfLines={1}
            >
              {formatEUR(income)}
            </Text>
            <Text
              style={{ fontSize: days.length > 3 ? 10 : 12, fontWeight: "600", color: totals.spent !== 0 ? t.danger : t.faint }}
              className="tabular-nums"
              numberOfLines={1}
            >
              {formatEUR(totals.spent)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
