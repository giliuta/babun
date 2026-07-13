import { memo, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  computeDayFinance,
  type DayFinanceTotals,
} from "@babun/shared/local/finance/day-summary";
import { getDayExtras } from "@babun/shared/local/day-extras";
import { useDayExtras, useFinanceServices } from "@/features/calendar/queries";
import { useThemeColors } from "@/theme/colors";

const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

// Month overview — web MonthView parity: bordered 6×7 grid (Monday-first),
// out-of-month cells on the grouped canvas, today = filled accent pill,
// weekend numbers red, appointment-count chip top-right, and the per-day
// money mini-list (planned / earned / spent / profit) from the same
// day-summary source as the week footer, so the two can never disagree.
// memo: три страницы месяца живут в пейджере — соседи не должны
// пересчитываться на каждый тик родителя.
export const MonthView = memo(function MonthView({
  month,
  appointments,
  teamId,
  todayYmd,
  onPickDay,
}: {
  month: Date; // first of the displayed month
  appointments: Appointment[];
  /** Active team — day extras are stored per (team, date); with no team
   *  selected extras are skipped (same as the day-finance footer). */
  teamId: string | null;
  /** Business-timezone today (YYYY-MM-DD); falls back to device time. */
  todayYmd?: string;
  onPickDay: (d: Date) => void;
}) {
  const cells = useMemo(() => {
    const y = month.getFullYear();
    const m = month.getMonth();
    const startDow = (new Date(y, m, 1).getDay() + 6) % 7; // Monday = 0
    const out: Date[] = [];
    for (let i = 0; i < 42; i++) out.push(new Date(y, m, 1 - startDow + i));
    return out;
  }, [month]);

  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const arr = map.get(a.date) ?? [];
      arr.push(a);
      map.set(a.date, arr);
    }
    return map;
  }, [appointments]);

  const services = useFinanceServices();
  const { data: extrasMap = {} } = useDayExtras();

  // Финансы всех дней одной мемоизацией (аудит: computeDayFinance гонялся
  // по 42 клеткам в каждом рендере). Дни без записей, но с ручными
  // операциями (extras) тоже попадают в карту.
  const totalsByDay = useMemo(() => {
    const m = new Map<string, DayFinanceTotals>();
    const dates = new Set(byDay.keys());
    if (teamId) {
      const prefix = `${teamId}:`;
      for (const k of Object.keys(extrasMap)) {
        if (k.startsWith(prefix)) dates.add(k.slice(prefix.length));
      }
    }
    for (const date of dates) {
      m.set(
        date,
        computeDayFinance(
          byDay.get(date) ?? [],
          services,
          getDayExtras(extrasMap, teamId, date),
        ),
      );
    }
    return m;
  }, [byDay, services, extrasMap, teamId]);

  const t = useThemeColors();
  const todayStr = todayYmd ?? ymd(new Date());
  const accentTint = `${t.accent}1f`;

  return (
    <View style={{ flex: 1, backgroundColor: t.surface }}>
      {/* weekday header — weekend columns red (полный danger, без
          приглушения: принцип «из чёрного, не серого» + контраст AA). */}
      <View
        className="flex-row"
        style={{
          backgroundColor: t.canvas,
          borderBottomWidth: 1,
          borderBottomColor: t.separator,
        }}
      >
        {WD.map((w, i) => (
          <Text
            key={w}
            className="flex-1 py-2 text-center"
            style={{
              fontSize: 12,
              fontWeight: "600",
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: i >= 5 ? t.danger : t.sub,
            }}
          >
            {w}
          </Text>
        ))}
      </View>
      <View className="flex-1">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <View key={row} className="flex-1 flex-row">
            {cells.slice(row * 7, row * 7 + 7).map((d) => {
              const key = ymd(d);
              const inMonth = d.getMonth() === month.getMonth();
              const isToday = key === todayStr;
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
              const count = byDay.get(key)?.length ?? 0;
              const totals = totalsByDay.get(key) ?? null;
              return (
                <Pressable
                  key={key}
                  onPress={() => onPickDay(d)}
                  accessibilityRole="button"
                  accessibilityLabel={`${d.getDate()} ${d.toLocaleDateString("ru-RU", { month: "long" })}${isToday ? ", сегодня" : ""}${count > 0 ? `, записей: ${count}` : ""}`}
                  className="flex-1 active:opacity-60"
                  style={{
                    padding: 4,
                    borderRightWidth: 1,
                    borderBottomWidth: 1,
                    borderColor: t.separator,
                    backgroundColor: inMonth ? t.surface : t.canvas,
                    overflow: "hidden",
                  }}
                >
                  <View className="w-full flex-row items-center justify-between">
                    {isToday ? (
                      <View
                        className="h-6 w-6 items-center justify-center rounded-full"
                        style={{ backgroundColor: t.accent }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: "700", color: t.onAccent }}>
                          {d.getDate()}
                        </Text>
                      </View>
                    ) : (
                      <Text
                        style={{
                          fontSize: 13,
                          fontWeight: "600",
                          color: inMonth
                            ? isWeekend
                              ? t.danger
                              : t.ink
                            : t.faint,
                        }}
                      >
                        {d.getDate()}
                      </Text>
                    )}
                    {count > 0 ? (
                      <View
                        className="rounded-full px-1.5"
                        style={{ backgroundColor: accentTint }}
                      >
                        <Text
                          style={{
                            fontSize: 10,
                            fontWeight: "700",
                            lineHeight: 16,
                            color: t.accent,
                          }}
                        >
                          {count}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {totals?.hasAny ? (
                    <View className="mt-0.5 w-full">
                      <MoneyRow v={totals.planned} color={t.sub} skipZero />
                      <MoneyRow v={totals.earned} color={t.success} skipZero />
                      <MoneyRow v={totals.spent} color={t.danger} skipZero />
                      <MoneyRow
                        v={totals.profit}
                        color={totals.profit < 0 ? t.danger : t.accent}
                      />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
});

// One line of the in-cell money mini-list. Zero rows are dropped (web
// parity) — except profit, which always renders when the day has numbers.
function MoneyRow({
  v,
  color,
  skipZero,
}: {
  v: number;
  color: string;
  skipZero?: boolean;
}) {
  if (skipZero && v === 0) return null;
  return (
    <Text
      className="tabular-nums"
      numberOfLines={1}
      maxFontSizeMultiplier={1.3}
      style={{ fontSize: 10, fontWeight: "600", lineHeight: 13, color }}
    >
      {formatEUR(v)}
    </Text>
  );
}
