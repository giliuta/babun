import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Minus, TrendingDown, TrendingUp } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import { formatCountRu, FORMS_RAZ } from "@babun/shared/common/utils/plural-ru";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { Chip } from "@/components/ui/Chip";
import { useThemeColors, type ThemeColors } from "@/theme/colors";
import { useAppointments } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { useServices } from "@/features/services/queries";
import { useTeams } from "@/features/reference/queries";

// «Сводка» — mobile port of apps/web/src/app/dashboard/insights/page.tsx.
// KPI tiles + top-3 leaderboards by period. Pure derivations over the same
// four datasets; the period/delta math is copied 1:1 (incl. the v686 rule:
// prev=0 → no delta chip, never a «999%» sentinel).

// ─── Period helpers (web parity) ─────────────────────────────────────────

type PeriodKey = "today" | "week" | "month" | "year";
interface PeriodRange {
  fromKey: string;
  toKey: string;
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function periodRange(period: PeriodKey): PeriodRange {
  const now = new Date();
  const toKey = toDateKey(now);
  if (period === "today") return { fromKey: toKey, toKey };
  if (period === "week") {
    const d = new Date(now);
    const day = d.getDay(); // 0=Sun; неделя с понедельника (web parity)
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return { fromKey: toDateKey(d), toKey };
  }
  if (period === "month") {
    return { fromKey: toDateKey(new Date(now.getFullYear(), now.getMonth(), 1)), toKey };
  }
  return { fromKey: toDateKey(new Date(now.getFullYear(), 0, 1)), toKey };
}

function prevPeriodRange(period: PeriodKey): PeriodRange {
  const now = new Date();
  if (period === "today") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    const key = toDateKey(d);
    return { fromKey: key, toKey: key };
  }
  if (period === "week") {
    const d = new Date(now);
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    const prevMon = new Date(d);
    prevMon.setDate(d.getDate() - 7);
    const prevSun = new Date(d);
    prevSun.setDate(d.getDate() - 1);
    return { fromKey: toDateKey(prevMon), toKey: toDateKey(prevSun) };
  }
  if (period === "month") {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { fromKey: toDateKey(first), toKey: toDateKey(last) };
  }
  const first = new Date(now.getFullYear() - 1, 0, 1);
  const last = new Date(now.getFullYear() - 1, 11, 31);
  return { fromKey: toDateKey(first), toKey: toDateKey(last) };
}

/** Work appointments (no personal events) inside the range. */
function filterWork(apts: Appointment[], range: PeriodRange): Appointment[] {
  return apts.filter(
    (a) =>
      (a.kind === undefined || a.kind === "work") &&
      a.date >= range.fromKey &&
      a.date <= range.toKey,
  );
}

/** prev=0 → null (no chip); web v686: «↗999%» sentinel was confusing. */
function toDeltaPct(raw: number | null): number | null {
  if (raw === null || !Number.isFinite(raw)) return null;
  return raw;
}

function deltaOf(current: number, prev: number): number | null {
  if (prev === 0) return current > 0 ? Number.POSITIVE_INFINITY : null;
  return ((current - prev) / prev) * 100;
}

// ─── Presentational pieces ───────────────────────────────────────────────

function KpiTile({
  label,
  value,
  delta,
  color,
  t,
}: {
  label: string;
  value: string;
  delta: number | null;
  color: string;
  t: ThemeColors;
}) {
  const deltaColor = delta === null ? t.sub : delta > 0 ? t.success : delta < 0 ? t.danger : t.sub;
  const DeltaIcon = delta === null ? null : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  return (
    <View
      className="flex-1 px-3 py-3"
      style={{ backgroundColor: t.surface, borderRadius: t.radius.card, boxShadow: t.cardShadow }}
    >
      <Text className="text-lg font-bold" style={{ color }} numberOfLines={1}>
        {value}
      </Text>
      <Text className="mt-0.5 text-[11px]" style={{ color: t.sub }} numberOfLines={1}>
        {label}
      </Text>
      {DeltaIcon ? (
        <View className="mt-1.5 flex-row items-center gap-0.5">
          <DeltaIcon color={deltaColor} size={12} strokeWidth={2} />
          <Text className="text-xs font-medium" style={{ color: deltaColor }}>
            {delta === null ? "" : `${Math.abs(Math.round(delta))}%`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

interface LeaderItem {
  id: string;
  name: string;
  value: number;
  valueLabel: string;
}

function LeaderCard({ title, items, t }: { title: string; items: LeaderItem[]; t: ThemeColors }) {
  const maxVal = items[0]?.value ?? 0;
  return (
    <SectionCard title={title}>
      {items.length === 0 ? (
        <Text className="px-4 py-3 text-[13px]" style={{ color: t.faint }}>
          За выбранный период данных нет
        </Text>
      ) : (
        <View className="gap-3 px-4 py-3">
          {items.map((item, idx) => (
            <View key={item.id} className="gap-1">
              <View className="flex-row items-center justify-between gap-2">
                <View className="min-w-0 flex-1 flex-row items-center gap-2">
                  <Text className="w-4 text-xs font-semibold" style={{ color: t.faint }}>
                    {idx + 1}
                  </Text>
                  <Text className="flex-1 text-sm font-medium" style={{ color: t.ink }} numberOfLines={1}>
                    {item.name}
                  </Text>
                </View>
                <Text className="text-[13px] font-semibold" style={{ color: t.ink }}>
                  {item.valueLabel}
                </Text>
              </View>
              <View className="h-1 overflow-hidden rounded-full" style={{ backgroundColor: t.fill }}>
                <View
                  className="h-full rounded-full"
                  style={{
                    backgroundColor: t.accent,
                    width: `${Math.max(maxVal > 0 ? Math.round((item.value / maxVal) * 100) : 0, 4)}%`,
                  }}
                />
              </View>
            </View>
          ))}
        </View>
      )}
    </SectionCard>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Сегодня" },
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
  { key: "year", label: "Год" },
];

export default function InsightsScreen() {
  const t = useThemeColors();
  const [period, setPeriod] = useState<PeriodKey>("week");
  const { data: appointments = [] } = useAppointments();
  const { data: clients = [] } = useClients();
  const { data: teams = [] } = useTeams();
  const { data: services = [] } = useServices();

  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.full_name])), [clients]);
  const teamName = useMemo(() => new Map(teams.map((tm) => [tm.id, tm.name])), [teams]);
  const serviceName = useMemo(() => new Map(services.map((s) => [s.id, s.name])), [services]);

  const range = useMemo(() => periodRange(period), [period]);
  const prevRange = useMemo(() => prevPeriodRange(period), [period]);
  const currentApts = useMemo(() => filterWork(appointments, range), [appointments, range]);
  const prevApts = useMemo(() => filterWork(appointments, prevRange), [appointments, prevRange]);
  const completedApts = useMemo(
    () => currentApts.filter((a) => a.status === "completed"),
    [currentApts],
  );

  // KPI + PoP-дельты (web parity: count / revenue / completed).
  const revenue = completedApts.reduce((s, a) => s + (a.total_amount ?? 0), 0);
  const prevCompleted = prevApts.filter((a) => a.status === "completed");
  const prevRevenue = prevCompleted.reduce((s, a) => s + (a.total_amount ?? 0), 0);
  const countDelta = deltaOf(currentApts.length, prevApts.length);
  const revenueDelta = deltaOf(revenue, prevRevenue);
  const completedDelta = deltaOf(completedApts.length, prevCompleted.length);

  const topTeams = useMemo((): LeaderItem[] => {
    const map = new Map<string, number>();
    for (const a of completedApts) {
      if (!a.team_id) continue;
      map.set(a.team_id, (map.get(a.team_id) ?? 0) + (a.total_amount ?? 0));
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, val]) => ({ id, name: teamName.get(id) ?? id, value: val, valueLabel: formatEUR(val) }));
  }, [completedApts, teamName]);

  const topServices = useMemo((): LeaderItem[] => {
    const map = new Map<string, number>();
    for (const a of currentApts) {
      if (a.services && a.services.length > 0) {
        for (const s of a.services) map.set(s.serviceId, (map.get(s.serviceId) ?? 0) + (s.quantity ?? 1));
      } else {
        for (const sid of a.service_ids ?? []) map.set(sid, (map.get(sid) ?? 0) + 1);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, count]) => ({
        id,
        name: serviceName.get(id) ?? id,
        value: count,
        valueLabel: formatCountRu(count, FORMS_RAZ),
      }));
  }, [currentApts, serviceName]);

  const topClients = useMemo((): LeaderItem[] => {
    const map = new Map<string, number>();
    for (const a of completedApts) {
      if (!a.client_id) continue;
      map.set(a.client_id, (map.get(a.client_id) ?? 0) + (a.total_amount ?? 0));
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, val]) => ({ id, name: clientName.get(id) ?? "—", value: val, valueLabel: formatEUR(val) }));
  }, [completedApts, clientName]);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Сводка" />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="flex-row gap-2 px-4 pb-3 pt-2">
          {PERIODS.map(({ key, label }) => (
            <Chip key={key} label={label} selected={period === key} onPress={() => setPeriod(key)} />
          ))}
        </View>

        <View className="flex-row gap-2.5 px-4">
          <KpiTile label="Записей" value={String(currentApts.length)} delta={toDeltaPct(countDelta)} color={t.accent} t={t} />
          <KpiTile label="Выручка" value={formatEUR(revenue)} delta={toDeltaPct(revenueDelta)} color={t.success} t={t} />
          <KpiTile label="Завершено" value={String(completedApts.length)} delta={toDeltaPct(completedDelta)} color={t.ink} t={t} />
        </View>

        <LeaderCard title="Топ команды" items={topTeams} t={t} />
        <LeaderCard title="Топ услуги" items={topServices} t={t} />
        <LeaderCard title="Топ клиенты" items={topClients} t={t} />
      </ScrollView>
    </Screen>
  );
}
