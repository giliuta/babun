import { Pressable, Text, View } from "react-native";
import {
  CalendarCheck,
  CalendarClock,
  CalendarX2,
  ChevronRight,
  type LucideIcon,
} from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { Card } from "@/components/ui/Card";
import { humanDay } from "@/features/appointments/helpers";
import { visitStatus, type VisitStatusKind } from "@/features/clients/visit-status";
import { useRecordColor } from "@/features/clients/use-record-color";
import { useThemeColors, type ThemeColors } from "@/theme/colors";

// ЗАПИСЬ КЛИЕНТА — БЛОКОМ (владелец 03.10: «не разделитель-волосок, а
// полноценный блок записи: иконка цветом этой записи, долг или оплачено,
// какая команда сделала — информативный, красивый блок»).
//
// Одна и та же запись в двух местах: в «Истории» — каждая отдельной
// карточкой, на карточке клиента — последняя, внутри блока «История» (там
// своей рамки нет, рамка — у блока). Слева плитка цветом записи — тем же,
// что у её блока в календаре (`useRecordColor`, правило `record-color`); значок
// говорит о самой записи (выполнена, впереди, отменена). В середине — день,
// время и команда; справа — состояние своим цветом, с суммой в том же слове.

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

/** Значок — о самой записи: впереди, отменена или уже была. */
function statusIcon(kind: VisitStatusKind): LucideIcon {
  if (kind === "ahead" || kind === "unclosed") return CalendarClock;
  if (kind === "cancelled") return CalendarX2;
  return CalendarCheck;
}

export interface VisitTeam {
  name: string;
  is_active: boolean;
  color?: string | null;
}

export function VisitRow({
  appointment: a,
  team,
  today,
  showMoney,
  framed = true,
  onPress,
}: {
  appointment: Appointment;
  /** Команда записи из справочника с архивом; нет — без подписи команды. */
  team: VisitTeam | undefined;
  today: string;
  /** Право «Долг и деньги»: нет — состояние без сумм. */
  showMoney: boolean;
  /** Своя карточка (в «Истории»); `false` — внутри блока карточки клиента. */
  framed?: boolean;
  /** Нет — блок показание, без шеврона. */
  onPress?: () => void;
}) {
  const t = useThemeColors();
  const status = visitStatus(a, today, showMoney);
  const Icon = statusIcon(status.kind);
  const tile = useRecordColor(a, team?.color, today) || t.accent;
  const teamName = team ? (team.is_active ? team.name : `${team.name} · в архиве`) : "";
  const time = a.time_start ? a.time_start.slice(0, 5) : "";
  const sub = [time, teamName].filter(Boolean).join(" · ");
  const day = humanDay(a.date);
  const body = (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={[day, sub, status.text].filter(Boolean).join(", ")}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 12,
        paddingLeft: 14,
        paddingRight: 10,
        minHeight: 64,
        backgroundColor: pressed && onPress ? t.pressed : "transparent",
        opacity: status.kind === "cancelled" ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          borderCurve: "continuous",
          backgroundColor: tile,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon color="#fff" size={20} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={{ fontSize: 16, fontWeight: "600", color: t.ink }}
        >
          {day}
        </Text>
        {sub ? (
          <Text
            maxFontSizeMultiplier={1.3}
            numberOfLines={1}
            style={{ fontSize: 14, color: t.sub, fontVariant: ["tabular-nums"] }}
          >
            {sub}
          </Text>
        ) : null}
      </View>
      {/* Состояние — про деньги, сумма в том же слове («Оплачено €300»,
          «Ожидается €50», «Долг €30»); серой суммы под ним больше нет. */}
      <Text
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        style={{ fontSize: 15, fontWeight: "600", color: statusColor(status.kind, t), fontVariant: ["tabular-nums"] }}
      >
        {status.text}
      </Text>
      {onPress ? <ChevronRight color={t.chevron} size={18} strokeWidth={2.2} /> : null}
    </Pressable>
  );
  return framed ? <Card style={{ marginHorizontal: 16 }}>{body}</Card> : body;
}
