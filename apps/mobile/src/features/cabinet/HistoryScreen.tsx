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
import { ScopeChips } from "@/components/ui/ScopeChips";
import { GUTTER } from "@/components/ui/tokens";
import { useCompanyMembers } from "@/features/access/queries";
import { useTeams } from "@/features/reference/queries";
import { dayTitle } from "@/features/sms/sms-history-view";
import { usePullRefresh } from "@/lib/pull-refresh";
import { haptics } from "@/lib/haptics";
import { useSession } from "@/providers/SessionProvider";
import { useThemeColors } from "@/theme/colors";
import {
  changeSubject,
  changeTarget,
  changeTitle,
  changesSummary,
  collapseBursts,
  type ChangeLogItem,
} from "./change-log";
import { useChangeLog, type ActorFilter } from "./use-change-log";

// «ИСТОРИЯ ИЗМЕНЕНИЙ» (Кабинет → Компания, владелец 03.10: «любое изменение
// записывается в историю… чётко отслеживать, что делаю я и что делает каждый
// из моих партнёров»).
//
// Вверху две ленты: люди («Я» и каждый партнёр) и календари — как в истории
// SMS: ничего не выбрано — видно всё, тап выбирает, повторный снимает. Ниже —
// лента по дням: что случилось, с чем, что поменялось, кто и где. Тап по
// записи или клиенту открывает его; удалённое никуда не ведёт.

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
  const { data: teams = [] } = useTeams();
  const { data: members = [] } = useCompanyMembers();
  const [actor, setActor] = useState<ActorFilter>("all");
  const [teamId, setTeamId] = useState<string | null>(null);
  const log = useChangeLog(actor, teamId);
  const pull = usePullRefresh(log.refetch);

  // «Я» первым, дальше партнёры по имени (сервер уже отдаёт по имени).
  const people = useMemo(() => {
    const others = members.filter((m) => m.userId !== me).map((m) => ({ id: m.userId, name: m.name }));
    return me ? [{ id: me, name: "Я" }, ...others] : others;
  }, [members, me]);
  const teamName = (id: string | null) => (id ? (teams.find((x) => x.id === id)?.name ?? null) : null);
  const actorName = (item: ChangeLogItem) =>
    item.row.actor_id == null
      ? "Система"
      : item.row.actor_id === me
        ? "Я"
        : (members.find((m) => m.userId === item.row.actor_id)?.name ?? item.row.actor_name ?? "Партнёр");

  const days = useMemo<Day[]>(() => {
    const rows = log.data?.pages.flat() ?? [];
    const now = new Date();
    const out: Day[] = [];
    for (const item of collapseBursts(rows)) {
      const key = dayKey(item.row.created_at);
      let day = out[out.length - 1];
      if (!day || day.key !== key) {
        day = { key, title: dayTitle(new Date(item.row.created_at), now), data: [] };
        out.push(day);
      }
      day.data.push(item);
    }
    return out;
  }, [log.data]);

  const open = (item: ChangeLogItem) => {
    const target = item.count === 1 ? changeTarget(item.row) : null;
    if (!target) return;
    haptics.tap();
    if (target.kind === "appointment") {
      router.push({ pathname: "/book", params: { appointmentId: target.id } } as unknown as Href);
    } else {
      router.push(`/clients/${target.id}` as Href);
    }
  };

  const header = (
    <View style={{ paddingTop: 12, gap: 10, marginBottom: 4 }}>
      {people.length > 1 ? (
        <ScopeChips
          onCanvas
          seam={false}
          items={people}
          activeId={actor === "all" || actor === "system" ? null : actor}
          onSelect={(id) => {
            haptics.tap();
            setActor((cur) => (cur === id ? "all" : id));
          }}
        />
      ) : null}
      {teams.length > 0 ? (
        <ScopeChips
          onCanvas
          seam={false}
          items={teams.map((x) => ({ id: x.id, name: x.name, color: x.color }))}
          activeId={teamId}
          onSelect={(id) => {
            haptics.tap();
            setTeamId((cur) => (cur === id ? null : id));
          }}
        />
      ) : null}
    </View>
  );

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="История изменений" />
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
          ListHeaderComponent={header}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 24 }}
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
                actor={actorName(item)}
                team={item.row.entity === "teams" ? null : teamName(item.row.team_id)}
                onPress={item.count === 1 && changeTarget(item.row) ? () => open(item) : undefined}
              />
            </View>
          )}
          ListEmptyComponent={
            <EmptyState
              title={actor === "all" && !teamId ? "Изменений пока нет" : "Здесь изменений нет"}
            />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (log.hasNextPage && !log.isFetchingNextPage) void log.fetchNextPage();
          }}
          ListFooterComponent={log.isFetchingNextPage ? <EmptyState state="loading" /> : null}
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
        />
      )}
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
