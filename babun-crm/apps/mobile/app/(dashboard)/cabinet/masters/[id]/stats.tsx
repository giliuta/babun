import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Card } from "@/components/ui/Card";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Field } from "@/components/ui/Field";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import { useMaster, useTeams, type Team } from "@/features/reference/queries";
import { useAppointments } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";

// Статистика мастера (порт web masters/[id]/stats/page.tsx). Период-переключатель
// Неделя / Месяц / Квартал / Год / Свой; всё считается на лету из общего кэша
// appointments по (master_id + окно периода). Метрики: выручка Σtotal_amount по
// completed, средний чек, всего / закрыто / отменено, % закрытия. Плюс сравнение
// с командой (медиана + ранг по коллегам) и топ-5 клиентов — как на вебе.

type Period = "week" | "month" | "quarter" | "year" | "custom";

const PERIOD_OPTIONS: readonly { value: Period; label: string }[] = [
  { value: "week", label: "Неделя" },
  { value: "month", label: "Месяц" },
  { value: "quarter", label: "Квартал" },
  { value: "year", label: "Год" },
  { value: "custom", label: "Свой" },
];

const PERIOD_LABELS: Record<Period, string> = {
  week: "Неделя",
  month: "Месяц",
  quarter: "Квартал",
  year: "Год",
  custom: "Свой",
};

// lead_ids / helper_ids приходят из Supabase как Json — узкое приведение к
// string[]. Инлайним (не тянем shared getTeamLeadIds: у него более широкий Team,
// на моб-Row не ложится) — та же логика, что в хабе мастера.
function teamHelperIds(t: Team): string[] {
  return Array.isArray(t.helper_ids)
    ? (t.helper_ids as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
}
function teamLeadIds(t: Team): string[] {
  const arr = Array.isArray(t.lead_ids)
    ? (t.lead_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  if (arr.length > 0) return Array.from(new Set(arr));
  return t.lead_id ? [t.lead_id] : [];
}

export default function MasterStatsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useThemeColors();
  const { data: master, isLoading } = useMaster(id);
  const { data: teams = [] } = useTeams();
  const { data: appointments = [] } = useAppointments();
  const { data: clients = [] } = useClients();

  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [customTo, setCustomTo] = useState(() => todayKey());

  // Команды мастера — team_id + все бригады, где он lead/helper (web parity).
  const assignedTeams = useMemo<Team[]>(() => {
    if (!master) return [];
    const seen = new Map<string, Team>();
    if (master.team_id) {
      const primary = teams.find((x) => x.id === master.team_id);
      if (primary) seen.set(primary.id, primary);
    }
    for (const team of teams) {
      if (
        teamLeadIds(team).includes(master.id) ||
        teamHelperIds(team).includes(master.id)
      ) {
        if (!seen.has(team.id)) seen.set(team.id, team);
      }
    }
    return Array.from(seen.values());
  }, [master, teams]);

  const teamIds = useMemo(
    () => new Set(assignedTeams.map((x) => x.id)),
    [assignedTeams],
  );

  const { start, end } = useMemo(
    () => periodWindow(period, customFrom, customTo),
    [period, customFrom, customTo],
  );

  const myApts = useMemo(() => {
    if (!master) return [] as Appointment[];
    return appointments.filter((a) => {
      if (a.master_id !== master.id) return false;
      if (a.team_id && !teamIds.has(a.team_id)) return false;
      const d = parseISODate(a.date);
      return d >= start && d < end;
    });
  }, [appointments, master, teamIds, start, end]);

  const teamApts = useMemo(() => {
    return appointments.filter((a) => {
      if (!a.team_id || !teamIds.has(a.team_id)) return false;
      const d = parseISODate(a.date);
      return d >= start && d < end;
    });
  }, [appointments, teamIds, start, end]);

  const stats = useMemo(() => {
    let completed = 0;
    let cancelled = 0;
    let revenue = 0;
    for (const a of myApts) {
      if (a.status === "completed") {
        completed += 1;
        revenue += a.total_amount ?? 0;
      } else if (a.status === "cancelled") {
        cancelled += 1;
      }
    }
    const total = myApts.length;
    const avgCheck = completed > 0 ? Math.round(revenue / completed) : 0;
    const completionRate =
      total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, cancelled, revenue, avgCheck, completionRate };
  }, [myApts]);

  // Сравнение с командой: выручка каждого коллеги (completed) за период →
  // медиана + место мастера. Тот же расчёт, что на вебе.
  const teamBenchmark = useMemo(() => {
    const revenueByMaster = new Map<string, number>();
    for (const a of teamApts) {
      if (a.status !== "completed" || !a.master_id) continue;
      revenueByMaster.set(
        a.master_id,
        (revenueByMaster.get(a.master_id) ?? 0) + (a.total_amount ?? 0),
      );
    }
    const peers = Array.from(revenueByMaster.values());
    if (peers.length === 0) return null;
    const sorted = peers.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const rank = sorted.filter((v) => v < stats.revenue).length + 1;
    return {
      median,
      rank,
      total: sorted.length,
      vsMedianPct:
        median > 0 ? Math.round((stats.revenue / median) * 100) : null,
    };
  }, [teamApts, stats.revenue]);

  const topClients = useMemo(() => {
    const byClient = new Map<string, number>();
    for (const a of myApts) {
      if (a.status !== "completed" || !a.client_id) continue;
      byClient.set(
        a.client_id,
        (byClient.get(a.client_id) ?? 0) + (a.total_amount ?? 0),
      );
    }
    return Array.from(byClient.entries())
      .map(([cid, total]) => {
        const c = clients.find((x) => x.id === cid);
        return { id: cid, name: c?.full_name ?? "Клиент", total };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [myApts, clients]);

  if (isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Статистика" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (!master) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Статистика" />
        <EmptyState fill title="Мастер не найден" />
      </Screen>
    );
  }

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Статистика" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Период — SegmentedControl. «Свой» раскрывает С / По. */}
        <View className="mx-3 mt-3">
          <SegmentedControl
            options={PERIOD_OPTIONS}
            value={period}
            onChange={setPeriod}
          />
          {period === "custom" ? (
            <View className="mt-2">
              <Card>
                <View className="px-4 pt-4">
                  <Field
                    label="С"
                    value={customFrom}
                    onChangeText={setCustomFrom}
                    placeholder="ГГГГ-ММ-ДД"
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="none"
                  />
                  <Field
                    label="По"
                    value={customTo}
                    onChangeText={setCustomTo}
                    placeholder="ГГГГ-ММ-ДД"
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="none"
                  />
                </View>
              </Card>
            </View>
          ) : null}
        </View>

        {/* Крупная карточка выручки. */}
        <View className="mx-3 mt-4">
          <Card>
            <View
              className="px-4 py-4"
              style={{
                backgroundColor: t.accent + "14",
                borderRadius: t.radius.card,
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  color: t.sub,
                }}
              >
                Выручка
              </Text>
              <Text
                style={{
                  fontSize: 34,
                  fontWeight: "700",
                  color: t.ink,
                  marginTop: 4,
                }}
              >
                {Math.round(stats.revenue).toLocaleString("ru-RU")} €
              </Text>
              <Text style={{ fontSize: 12, color: t.sub, marginTop: 8 }}>
                средний чек ·{" "}
                <Text style={{ fontWeight: "700", color: t.ink }}>
                  {stats.avgCheck.toLocaleString("ru-RU")} €
                </Text>
              </Text>
            </View>
          </Card>
        </View>

        {/* Сетка чисел 2×2. */}
        <View className="mx-3 mt-3 flex-row flex-wrap gap-2">
          <StatBox label="Всего визитов" value={String(stats.total)} />
          <StatBox label="Закрыто" value={String(stats.completed)} />
          <StatBox label="Отменено" value={String(stats.cancelled)} />
          <StatBox
            label="Закрытие"
            value={`${stats.completionRate}%`}
            warning={stats.completionRate < 70 && stats.total > 0}
          />
        </View>

        {/* Сравнение с командой. */}
        {teamBenchmark ? (
          <View className="mx-3 mt-4">
            <Eyebrow>Сравнение с командой</Eyebrow>
            <Card>
              <View className="px-4 py-3">
                <ComparisonRow
                  label="Место в команде"
                  value={`${teamBenchmark.rank} из ${teamBenchmark.total}`}
                />
                <ComparisonRow
                  label="Медиана коллег"
                  value={`${Math.round(teamBenchmark.median).toLocaleString("ru-RU")} €`}
                />
                {teamBenchmark.vsMedianPct !== null ? (
                  <ComparisonRow
                    label="Относительно медианы"
                    value={`${teamBenchmark.vsMedianPct}%`}
                    emphasise={
                      teamBenchmark.vsMedianPct >= 100 ? "good" : "bad"
                    }
                  />
                ) : null}
              </View>
            </Card>
          </View>
        ) : null}

        {/* Топ-5 клиентов. */}
        {topClients.length > 0 ? (
          <View className="mx-3 mt-4">
            <Eyebrow>{`Топ клиентов · ${periodCaption(period, customFrom, customTo)}`}</Eyebrow>
            <Card>
              {topClients.map((c, i) => (
                <View key={c.id}>
                  {i > 0 ? <Divider inset={16} /> : null}
                  <View className="flex-row items-center gap-3 px-4 py-2.5">
                    <View
                      className="h-6 w-6 items-center justify-center rounded-full"
                      style={{ backgroundColor: t.fill }}
                    >
                      <Text
                        style={{ fontSize: 11, fontWeight: "700", color: t.sub }}
                      >
                        {i + 1}
                      </Text>
                    </View>
                    <Text
                      style={{ flex: 1, fontSize: 14, color: t.ink }}
                      numberOfLines={1}
                    >
                      {c.name}
                    </Text>
                    <Text
                      style={{ fontSize: 13, fontWeight: "700", color: t.ink }}
                    >
                      {Math.round(c.total).toLocaleString("ru-RU")} €
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        {stats.total === 0 ? (
          <View className="mx-3 mt-4">
            <Card>
              <View className="items-center px-4 py-6">
                <Text style={{ fontSize: 13, color: t.faint, textAlign: "center" }}>
                  {periodCaption(period, customFrom, customTo)} — визитов нет.
                </Text>
              </View>
            </Card>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

// ─── Period math ────────────────────────────────────────────────────

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function isoToDate(iso: string): Date | null {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const out = new Date(y, m - 1, d);
  out.setHours(0, 0, 0, 0);
  return out;
}

// Локальная дата из «YYYY-MM-DD» — new Date(iso) трактует ISO как UTC и в
// минусовых зонах смещает день, ломая границы окна.
function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  const out = new Date(y || 1970, (m || 1) - 1, d || 1);
  out.setHours(0, 0, 0, 0);
  return out;
}

function periodWindow(
  period: Period,
  customFrom: string,
  customTo: string,
): { start: Date; end: Date } {
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  switch (period) {
    case "week":
      start.setDate(now.getDate() - 6);
      break;
    case "month":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "quarter": {
      const q = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), q * 3, 1);
      break;
    }
    case "year":
      start = new Date(now.getFullYear(), 0, 1);
      break;
    case "custom": {
      const from = isoToDate(customFrom);
      const to = isoToDate(customTo);
      if (from) start = from;
      if (to) {
        end = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
      }
      // Инверсия from > to — молча меняем местами, а не показываем пусто.
      if (start > end) {
        const tmp = start;
        start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
        end = new Date(tmp.getFullYear(), tmp.getMonth(), tmp.getDate() + 1);
      }
      break;
    }
  }
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function periodCaption(
  period: Period,
  customFrom?: string,
  customTo?: string,
): string {
  if (period !== "custom") {
    return `за ${PERIOD_LABELS[period].toLowerCase()}`;
  }
  if (!customFrom || !customTo) return "за выбранный период";
  return `${formatDateShort(customFrom)} — ${formatDateShort(customTo)}`;
}

function formatDateShort(iso: string): string {
  const d = isoToDate(iso);
  if (!d) return iso;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

// ─── Layout primitives ──────────────────────────────────────────────

function Eyebrow({ children }: { children: string }) {
  const t = useThemeColors();
  return (
    <Text
      style={{
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: t.faint,
        marginBottom: 6,
        marginLeft: 4,
      }}
    >
      {children}
    </Text>
  );
}

function StatBox({
  label,
  value,
  warning,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View style={{ width: "48.5%" }}>
      <Card>
        <View className="px-3 py-3">
          <Text
            style={{
              fontSize: 22,
              fontWeight: "700",
              color: warning ? t.warning : t.ink,
            }}
          >
            {value}
          </Text>
          <Text
            style={{
              fontSize: 11,
              color: t.faint,
              textTransform: "uppercase",
              letterSpacing: 0.3,
              marginTop: 6,
            }}
          >
            {label}
          </Text>
        </View>
      </Card>
    </View>
  );
}

function ComparisonRow({
  label,
  value,
  emphasise,
}: {
  label: string;
  value: string;
  emphasise?: "good" | "bad";
}) {
  const t = useThemeColors();
  const color =
    emphasise === "good" ? t.success : emphasise === "bad" ? t.warning : t.ink;
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <Text style={{ fontSize: 14, color: t.sub }}>{label}</Text>
      <Text style={{ fontSize: 14, fontWeight: "700", color }}>{value}</Text>
    </View>
  );
}
