import { useMemo, useState } from "react";
import { Pressable, SectionList, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import {
  Bookmark,
  Briefcase,
  CalendarClock,
  CalendarDays,
  Clock,
  FileText,
  Folder,
  HandCoins,
  KeyRound,
  Landmark,
  Mail,
  Megaphone,
  Receipt,
  Settings2,
  Shapes,
  Shield,
  SlidersHorizontal,
  Tags,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react-native";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { GUTTER } from "@/components/ui/tokens";
import { useCompanyMembers } from "@/features/access/queries";
import { useTeams } from "@/features/reference/queries";
import { useMyCalendars } from "@/features/settings/workspaces";
import { dayTitle } from "@/features/sms/sms-history-view";
import { usePullRefresh } from "@/lib/pull-refresh";
import { haptics } from "@/lib/haptics";
import { useSession } from "@/providers/SessionProvider";
import { useThemeColors } from "@/theme/colors";
import {
  EMPTY_HISTORY_FILTER,
  changeSubject,
  changeTarget,
  changeTitle,
  changesSummary,
  collapseBursts,
  filterChanges,
  historyFacetCounts,
  historyFilterCount,
  type ChangeLogItem,
  type HistoryFilter,
  type HistoryPeriod,
} from "./change-log";
import { ChangeDetailSheet } from "./ChangeDetailSheet";
import { HistoryFilterSheet } from "./HistoryFilterSheet";
import { useAccountName, useAccountScope } from "./account-scope";
import { useChangeLogPeriod } from "./use-change-log";

// «ИСТОРИЯ ИЗМЕНЕНИЙ» (Кабинет → Компания, владелец 03.10: «любое изменение
// записывается в историю… чётко отслеживать, что делаю я и что делает каждый
// из моих партнёров»).
//
// ФИЛЬТРЫ — КАК В КЛИЕНТАХ (03.10): значок справа в шапке, точка на нём —
// фильтр включён; шторка «Фильтры» (`HistoryFilterSheet`): период, кто,
// команда, что, действие. Ниже — лента по дням: что случилось, с чем, что
// поменялось, кто и где, время. Тап по строке — подробности до секунды и
// все поля «было → стало» (`ChangeDetailSheet`), оттуда — в запись или
// клиента.

const ICONS: Record<string, LucideIcon> = {
  clients: UserRound,
  finance_transactions: Wallet,
  debts: HandCoins,
  invoices: FileText,
  receipts: Receipt,
  teams: CalendarDays,
  accounts: Landmark,
  services: Briefcase,
  cities: Bookmark,
  client_tags: Tags,
  client_sources: Megaphone,
  location_labels: Shapes,
  finance_categories: Folder,
  personal_event_types: Shapes,
  member_access: Shield,
  member_calendars: KeyRound,
  tenant_members: Users,
  invitations: Mail,
  team_design: Settings2,
  team_schedules: Clock,
};

function iconOf(item: ChangeLogItem): LucideIcon {
  if (item.row.entity === "appointments") {
    return item.row.meta?.kind === "event" ? CalendarClock : CalendarDays;
  }
  return ICONS[item.row.entity] ?? Settings2;
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

interface Day {
  key: string;
  title: string;
  data: ChangeLogItem[];
}

export function HistoryScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { session } = useSession();
  const me = session?.user?.id ?? null;
  // С архивными: строка о команде, которую потом удалили, всё равно знает её имя.
  // ЖУРНАЛ АККАУНТА СТРАНИЦЫ (04.10): из блока аккаунта в Кабинете — его, а не
  // открытого на телефоне. Тогда команды называет лента календарей, партнёров
  // аккаунта телефон не знает (подпись строки — имя на тот момент), а дверей
  // к записи и клиенту нет: они открылись бы в открытом аккаунте.
  const scope = useAccountScope();
  const accountName = useAccountName();
  const { data: activeTeams = [] } = useTeams({ includeInactive: true });
  const { data: calendars = [] } = useMyCalendars();
  const teams = useMemo(
    () =>
      scope.foreign
        ? calendars
            .filter((c) => c.tenantId === scope.tenantId)
            .map((c) => ({ id: c.teamId, name: c.teamName, color: c.teamColor, is_active: true }))
        : activeTeams,
    [scope.foreign, scope.tenantId, calendars, activeTeams],
  );
  const { data: activeMembers = [] } = useCompanyMembers();
  const members = scope.foreign ? [] : activeMembers;
  const [period, setPeriod] = useState<HistoryPeriod>("all");
  const [filter, setFilter] = useState<HistoryFilter>(EMPTY_HISTORY_FILTER);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [detail, setDetail] = useState<ChangeLogItem | null>(null);
  const log = useChangeLogPeriod(period);
  const pull = usePullRefresh(log.refetch);
  const rows = useMemo(() => log.data?.rows ?? [], [log.data]);

  const teamName = (id: string | null) => (id ? (teams.find((x) => x.id === id)?.name ?? null) : null);
  const actorName = (row: ChangeLogItem["row"]) =>
    row.actor_id == null
      ? "Система"
      : row.actor_id === me
        ? "Я"
        : (members.find((m) => m.userId === row.actor_id)?.name ?? row.actor_name ?? "Партнёр");

  // Варианты «Кто»: «Я», партнёры аккаунта и все, кто есть в журнале (в том
  // числе бывшие партнёры — по имени на тот момент), «Система» — если была.
  const people = useMemo(() => {
    const out = new Map<string, string>();
    if (me) out.set(me, "Я");
    for (const m of members) if (m.userId !== me) out.set(m.userId, m.name);
    for (const r of rows) {
      const key = r.actor_id ?? "system";
      if (!out.has(key)) out.set(key, r.actor_id == null ? "Система" : (r.actor_name ?? "Партнёр"));
    }
    return [...out].map(([value, label]) => ({ value, label, color: "" }));
  }, [members, me, rows]);
  const teamOptions = useMemo(() => {
    const seen = new Set(rows.map((r) => r.team_id));
    const out = teams
      .filter((x) => x.is_active || seen.has(x.id))
      .map((x) => ({ value: x.id, label: x.name, color: x.color ?? "" }));
    if (rows.some((r) => r.team_id == null)) out.push({ value: "none", label: "Без команды", color: "" });
    return out;
  }, [teams, rows]);

  const filtered = useMemo(() => filterChanges(rows, filter), [rows, filter]);
  const counts = useMemo(() => historyFacetCounts(rows, filter), [rows, filter]);
  const active = historyFilterCount(filter) + (period === "all" ? 0 : 1);

  const days = useMemo<Day[]>(() => {
    const now = new Date();
    const out: Day[] = [];
    for (const item of collapseBursts(filtered)) {
      const key = dayKey(item.row.created_at);
      let day = out[out.length - 1];
      if (!day || day.key !== key) {
        day = { key, title: dayTitle(new Date(item.row.created_at), now), data: [] };
        out.push(day);
      }
      day.data.push(item);
    }
    return out;
  }, [filtered]);

  const openTarget = (item: ChangeLogItem) => {
    const target = item.count === 1 ? changeTarget(item.row) : null;
    if (!target) return;
    setDetail(null);
    haptics.tap();
    if (target.kind === "appointment") {
      router.push({ pathname: "/book", params: { appointmentId: target.id } } as unknown as Href);
    } else {
      router.push(`/clients/${target.id}` as Href);
    }
  };

  const filterButton = (
    <Pressable
      onPress={() => {
        haptics.tap();
        setSheetOpen(true);
      }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={active > 0 ? `Фильтры, включено ${active}` : "Фильтры"}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: t.radius.card,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <SlidersHorizontal color={active > 0 ? t.accent : t.sub} size={21} strokeWidth={2} />
      {active > 0 ? (
        <View
          style={{
            position: "absolute",
            top: 9,
            right: 8,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: t.accent,
            borderWidth: 1.5,
            borderColor: t.surface,
          }}
        />
      ) : null}
    </Pressable>
  );

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title="История изменений"
        subtitle={scope.foreign || scope.viewRole !== "owner" ? (accountName ?? undefined) : undefined}
        right={filterButton}
      />
      {log.isLoading ? (
        <EmptyState state="loading" fill />
      ) : log.isError ? (
        <EmptyState
          state="error"
          fill
          subtitle={log.error instanceof Error ? log.error.message : undefined}
          action={{ label: "Повторить", onPress: () => void log.refetch() }}
        />
      ) : (
        <SectionList
          sections={days}
          keyExtractor={(item) => item.key}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 24, paddingTop: 4 }}
          renderSectionHeader={({ section }) => (
            <Text
              maxFontSizeMultiplier={1.2}
              style={{
                paddingHorizontal: GUTTER + 4,
                paddingTop: 16,
                paddingBottom: 6,
                fontSize: 13,
                fontWeight: "600",
                letterSpacing: 0.4,
                color: t.sub,
              }}
            >
              {section.title}
            </Text>
          )}
          renderItem={({ item, index, section }) => (
            <View
              style={{
                marginHorizontal: GUTTER,
                backgroundColor: t.surface,
                borderTopLeftRadius: index === 0 ? t.radius.card : 0,
                borderTopRightRadius: index === 0 ? t.radius.card : 0,
                borderBottomLeftRadius: index === section.data.length - 1 ? t.radius.card : 0,
                borderBottomRightRadius: index === section.data.length - 1 ? t.radius.card : 0,
                borderCurve: "continuous",
              }}
            >
              {index > 0 ? <Divider inset={52} /> : null}
              <ChangeRow
                item={item}
                Icon={iconOf(item)}
                actor={actorName(item.row)}
                team={item.row.entity === "teams" ? null : teamName(item.row.team_id)}
                onPress={() => {
                  haptics.tap();
                  setDetail(item);
                }}
              />
            </View>
          )}
          ListFooterComponent={
            log.data?.capped ? (
              <Text
                maxFontSizeMultiplier={1.3}
                style={{ paddingHorizontal: GUTTER + 4, paddingTop: 16, fontSize: 13, color: t.sub }}
              >
                Показаны последние 3000 изменений — более ранние откроет период
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState title={rows.length === 0 ? "Изменений пока нет" : "Ничего не найдено"} />
          }
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
        />
      )}

      <HistoryFilterSheet
        visible={sheetOpen}
        period={period}
        filter={filter}
        people={people}
        teams={teamOptions}
        counts={counts}
        shownCount={filtered.length}
        onPeriod={setPeriod}
        onFilter={setFilter}
        onClose={() => setSheetOpen(false)}
      />
      <ChangeDetailSheet
        item={detail}
        actor={detail ? actorName(detail.row) : ""}
        team={detail && detail.row.entity !== "teams" ? teamName(detail.row.team_id) : null}
        onOpen={scope.foreign ? undefined : openTarget}
        onClose={() => setDetail(null)}
      />
    </Screen>
  );
}

function ChangeRow({
  item,
  Icon,
  actor,
  team,
  onPress,
}: {
  item: ChangeLogItem;
  Icon: LucideIcon;
  actor: string;
  team: string | null;
  onPress?: () => void;
}) {
  const t = useThemeColors();
  const { row } = item;
  const tone =
    row.action === "delete" ? t.danger : row.action === "update" ? t.accent : t.success;
  const subject =
    item.count > 1
      ? [item.labels.slice(0, 2).join(", "), item.labels.length > 2 ? `ещё ${item.labels.length - 2}` : ""]
          .filter(Boolean)
          .join(" и ")
      : changeSubject(row);
  const changes = item.count > 1 ? "" : changesSummary(row.changes);
  const who = [actor, team].filter(Boolean).join(" · ");
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? "button" : "text"}
      style={({ pressed }) => ({
        flexDirection: "row",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <View style={{ width: 24, paddingTop: 1, alignItems: "center" }}>
        <Icon size={20} strokeWidth={2} color={tone} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            style={{ flexShrink: 1, fontSize: 16, fontWeight: "600", color: t.ink }}
          >
            {changeTitle(row)}
            {item.count > 1 ? ` ×${item.count}` : ""}
          </Text>
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ marginLeft: "auto", fontSize: 13, color: t.sub, fontVariant: ["tabular-nums"] }}
          >
            {hhmm(row.created_at)}
          </Text>
        </View>
        {subject ? (
          <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize: 14, color: t.ink }}>
            {subject}
          </Text>
        ) : null}
        {changes ? (
          <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: t.sub }}>
            {changes}
          </Text>
        ) : null}
        <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: t.faint }}>
          {who}
        </Text>
      </View>
    </Pressable>
  );
}

export default HistoryScreen;
