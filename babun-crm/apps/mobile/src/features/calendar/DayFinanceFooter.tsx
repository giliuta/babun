import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Service } from "@babun/shared/local/services";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  computeDayFinance,
  getDayMode,
} from "@babun/shared/local/finance/day-summary";
import { getDayExtras } from "@babun/shared/local/day-extras";
import { formatYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import { RAIL_W } from "@/features/calendar/DayView";
import { useServices } from "@/features/services/queries";
import { useDayExtras } from "@/features/calendar/queries";

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
  const { data: services = [] } = useServices();
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

  // DB service rows carry the same runtime shape as the shared local
  // Service (material_costs is a jsonb array) — computeDayFinance only
  // touches id + material_costs. Guard the jsonb in case of bad rows.
  const sharedServices = useMemo(
    () =>
      services.map((s) => ({
        ...s,
        material_costs: Array.isArray(s.material_costs) ? s.material_costs : [],
      })) as unknown as Service[],
    [services],
  );

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
      <View style={{ width: RAIL_W, paddingRight: 5, alignItems: "flex-end", justifyContent: "center" }}>
        <Text style={{ fontSize: 9, fontWeight: "600", color: t.success }}>Доход</Text>
        <Text style={{ fontSize: 9, fontWeight: "600", color: t.danger }}>Расход</Text>
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
            <Text
              style={{ fontSize: days.length > 3 ? 10 : 12, fontWeight: "600", color: t.success }}
              className="tabular-nums"
              numberOfLines={1}
            >
              {formatEUR(income)}
            </Text>
            <Text
              style={{ fontSize: days.length > 3 ? 10 : 12, fontWeight: "600", color: t.danger }}
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
