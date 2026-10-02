import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { ChevronRight } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { formatShortDateRu } from "@/features/clients/format";
import { visitStatus, type VisitStatusKind } from "@/features/clients/visit-status";
import { useThemeColors, type ThemeColors } from "@/theme/colors";

// СТРОКА ЗАПИСИ КЛИЕНТА — ОДНА НА ДВА МЕСТА (владелец 03.10): в «Истории»
// это каждая строка списка, на карточке — последняя запись, «просто как
// показано внутри». Ровные столбцы: дата одной ширины, команда, справа
// состояние своим цветом и шеврон. Услуг нет.

/** Цвет состояния — тем же языком, что метка визита в списке клиентов:
 *  оплачено — зелёным, долг и незакрытая — янтарём, впереди — кобальтом. */
function statusColor(kind: VisitStatusKind, t: ThemeColors): string {
  switch (kind) {
    case "paid":
      return t.success;
    case "debt":
    case "unclosed":
      return t.warning;
    case "ahead":
      return t.accent;
    case "cancelled":
      return t.faint;
    default:
      return t.sub;
  }
}

/** Место даты — под самую длинную («30 сен ’25») при крупном тексте. */
const DATE_COLUMN = 92;

export function VisitRow({
  appointment: a,
  team,
  today,
  showMoney,
  onPress,
}: {
  appointment: Appointment;
  /** Имя команды записи (архивная — с «· в архиве»); пусто — без команды. */
  team: string;
  today: string;
  /** Право «Долг и деньги»: нет — состояние без сумм. */
  showMoney: boolean;
  /** Нет — строка показание, без шеврона. */
  onPress?: () => void;
}) {
  const t = useThemeColors();
  const { fontScale } = useWindowDimensions();
  const dateColumn = Math.round(DATE_COLUMN * Math.min(fontScale, 1.3));
  const status = visitStatus(a, today, showMoney);
  const date = formatShortDateRu(a.date);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={[date, team, status.text].filter(Boolean).join(", ")}
      className="min-h-[56px] flex-row items-center py-2.5 pl-4 pr-3 active:opacity-60"
      style={{ opacity: status.kind === "cancelled" ? 0.55 : 1 }}
    >
      <Text
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        style={{ width: dateColumn, fontSize: 16, fontWeight: "600", color: t.ink, fontVariant: ["tabular-nums"] }}
      >
        {date}
      </Text>
      <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ flex: 1, fontSize: 15, color: t.body }}>
        {team}
      </Text>
      <Text
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        style={{
          marginLeft: 8,
          fontSize: 15,
          fontWeight: "600",
          color: statusColor(status.kind, t),
          fontVariant: ["tabular-nums"],
        }}
      >
        {status.text}
      </Text>
      <View style={{ width: 22, alignItems: "flex-end" }}>
        {onPress ? <ChevronRight color={t.chevron} size={18} strokeWidth={2.2} /> : null}
      </View>
    </Pressable>
  );
}

/** Имя команды записи словами для столбца строки. */
export function visitTeamName(
  teamId: string | null | undefined,
  teamsById: ReadonlyMap<string, { name: string; is_active: boolean }>,
): string {
  const team = teamId ? teamsById.get(teamId) : undefined;
  if (!team) return "";
  return team.is_active ? team.name : `${team.name} · в архиве`;
}
