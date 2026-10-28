import { Pressable, Text, View } from "react-native";
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
import { LIST_ROW } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  changeSubject,
  changeTitle,
  changesSummary,
  type ChangeLogItem,
} from "@/lib/change-log";

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

export function iconOf(item: ChangeLogItem): LucideIcon {
  if (item.row.entity === "appointments") {
    return item.row.meta?.kind === "event" ? CalendarClock : CalendarDays;
  }
  return ICONS[item.row.entity] ?? Settings2;
}

/** «09:05» of a change, phone time. */
function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** One line of the change history feed. */
export function ChangeRow({
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
  // ЗЕЛЁНЫЙ В ПРОДУКТЕ — «ДЕНЬГИ ПРИШЛИ». Создание записи им не красится:
  // «Запись создана» зелёным читалось как оплата. Создание — акцент,
  // правка — чернила, удаление — опасность.
  const tone =
    row.action === "delete" ? t.danger : row.action === "update" ? t.sub : t.accent;
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
            style={{ flexShrink: 1, ...LIST_ROW.name, color: t.ink }}
          >
            {changeTitle(row)}
            {item.count > 1 ? ` ×${item.count}` : ""}
          </Text>
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ marginLeft: "auto", ...LIST_ROW.sub, color: t.sub, fontVariant: ["tabular-nums"] }}
          >
            {hhmm(row.created_at)}
          </Text>
        </View>
        {subject ? (
          <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ ...LIST_ROW.sub, color: t.ink }}>
            {subject}
          </Text>
        ) : null}
        {changes ? (
          <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ ...LIST_ROW.sub, color: t.sub }}>
            {changes}
          </Text>
        ) : null}
        <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ ...LIST_ROW.sub, color: t.faint }}>
          {who}
        </Text>
      </View>
    </Pressable>
  );
}
