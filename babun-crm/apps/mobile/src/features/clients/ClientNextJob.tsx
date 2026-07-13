// Mobile port of apps/web/src/components/clients/ClientNextJob.tsx (web v813).
//
// The NEXT-JOB hero: the single loud surface on the client card. Owns the
// alarm hue (solid red when ТО overdue). Priority:
//   future appointment → overdue ТО → soon ТО → generic «Записать».
// Tapping navigates to the calendar (pre-aimed at the appointment date,
// or a new booking carrying client/location/team so the sheet opens with
// the client preselected).
//
// Presentational. NativeWind className on core RN components; icons from
// lucide-react-native (color/size). No web router — uses expo-router.

import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  Calendar,
  CalendarPlus,
  ChevronRight,
  Wrench,
} from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import type { ServiceDueSummary } from "@babun/shared/local/selectors/service-due";
import { MONTHS_RU_SHORT } from "@/features/clients/format";
import { useThemeColors } from "@/theme/colors";

interface ClientNextJobProps {
  client: Client;
  appointments: Appointment[];
  stats: ClientStats | undefined;
  serviceDue: ServiceDueSummary;
}

type Tone = "accent" | "info" | "alert" | "warn";

// WHERE the next job is — the dispatcher's first question after «when».
// Resolve the appointment the hero names (selector rule: earliest
// upcoming scheduled/in_progress) and return its object as
// «Метка · адрес»; null → caller falls back to the generic hint.
function nextAptPlace(
  client: Client,
  appointments: Appointment[],
  nextApt: { date: string; time: string },
): string | null {
  const apt = appointments.find(
    (a) =>
      a.date === nextApt.date &&
      a.time_start === nextApt.time &&
      (a.status === "scheduled" || a.status === "in_progress"),
  );
  const loc = apt?.location_id
    ? client.locations?.find((l) => l.id === apt.location_id)
    : undefined;
  if (!loc) return null;
  return [loc.label, loc.address].filter(Boolean).join(" · ") || null;
}

function aptLabel(nextApt: { date: string; time: string }): string {
  const [y, m, d] = nextApt.date.split("-").map(Number);
  if (!y || !m || !d) return `${nextApt.date} · ${nextApt.time}`;
  const dt = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((dt.getTime() - today.getTime()) / 86400000);
  if (days === 0) return `сегодня · ${nextApt.time}`;
  if (days === 1) return `завтра · ${nextApt.time}`;
  return `${d} ${MONTHS_RU_SHORT[m - 1] ?? ""} · ${nextApt.time}`;
}

export default function ClientNextJob({
  client,
  appointments,
  stats,
  serviceDue,
}: ClientNextJobProps) {
  const router = useRouter();
  const th = useThemeColors();

  const primaryLocationId =
    client.locations?.find((l) => l.isPrimary)?.id ??
    client.locations?.[0]?.id ??
    null;

  let tone: Tone;
  let Icon: typeof Calendar;
  let title: string;
  let subtitle: string;
  let onPress: () => void;

  // Navigate to the calendar tab. For an existing appointment we pass the
  // date; for a new booking we carry client/location/team as params so the
  // booking sheet can open pre-aimed (consumer side may ignore unknown
  // params → degrades gracefully to a plain calendar open).
  // The calendar lives at the dashboard index route («Календарь» tab).
  const goToDate = (date: string) =>
    router.push({ pathname: "/(dashboard)", params: { date } });
  const goToBooking = (locationId: string | null, teamId: string | null) =>
    router.push({
      pathname: "/(dashboard)",
      params: {
        new: "1",
        clientId: client.id,
        ...(locationId ? { locationId } : {}),
        ...(teamId ? { teamId } : {}),
      },
    });

  if (stats?.nextApt) {
    tone = "info";
    Icon = Calendar;
    title = `Запись · ${aptLabel(stats.nextApt)}`;
    subtitle =
      nextAptPlace(client, appointments, stats.nextApt) ??
      "Открыть в календаре";
    const date = stats.nextApt.date;
    onPress = () => goToDate(date);
  } else if (serviceDue.overdue.length > 0) {
    const u = serviceDue.overdue[0];
    tone = "alert";
    Icon = Wrench;
    title = `ТО просрочено · ${Math.abs(u.due.daysUntil)} дн · ${u.room}`;
    subtitle = "Записать на ТО — команда подставлена";
    onPress = () => goToBooking(u.locationId, stats?.lastTeamId ?? null);
  } else if (serviceDue.soon.length > 0) {
    const u = serviceDue.soon[0];
    tone = "warn";
    Icon = Wrench;
    title = `Скоро ТО · ${u.room}`;
    subtitle = `через ${u.due.daysUntil} дн · записать на ТО`;
    onPress = () => goToBooking(u.locationId, stats?.lastTeamId ?? null);
  } else {
    tone = "accent";
    Icon = CalendarPlus;
    title = "Записать";
    subtitle =
      stats && stats.visits > 0 ? "Новая запись" : "Первый визит этого клиента";
    onPress = () => goToBooking(primaryLocationId, stats?.lastTeamId ?? null);
  }

  // Tone-specific resolved values
  const toneStyles: Record<
    Tone,
    {
      wrapBg: string;
      iconBg: string;
      iconColor: string;
      titleColor: string;
      subColor: string;
      chevColor: string;
    }
  > = {
    alert: {
      wrapBg: th.danger,
      iconBg: "rgba(255,255,255,0.20)",
      iconColor: "#ffffff",
      titleColor: "#ffffff",
      subColor: "rgba(255,255,255,0.85)",
      chevColor: "rgba(255,255,255,0.90)",
    },
    accent: {
      wrapBg: th.accent,
      iconBg: "rgba(255,255,255,0.20)",
      iconColor: "#ffffff",
      titleColor: "#ffffff",
      subColor: "rgba(255,255,255,0.85)",
      chevColor: "rgba(255,255,255,0.90)",
    },
    // Semantic tones are tints of the DS tokens (as in Badge /
    // ClientHeader) — no tailwind-amber / light-cobalt literals, so the
    // dark scheme keeps its own accent (#5a86ff) and warning hues.
    warn: {
      wrapBg: `${th.warning}1a`,
      iconBg: `${th.warning}2e`,
      iconColor: th.warning,
      titleColor: th.warning,
      subColor: th.sub,
      chevColor: th.warning,
    },
    info: {
      wrapBg: th.dark ? `${th.accent}26` : `${th.accent}14`,
      iconBg: th.dark ? `${th.accent}33` : `${th.accent}1f`,
      iconColor: th.accent,
      titleColor: th.accent,
      subColor: th.sub,
      chevColor: th.accent,
    },
  };

  const ts = toneStyles[tone];

  return (
    <View className="mx-3 mt-2">
      <Pressable
        onPress={onPress}
        className="min-h-[62px] flex-row items-center gap-3 rounded-2xl px-3.5 py-2.5 active:opacity-90"
        style={{ backgroundColor: ts.wrapBg }}
      >
        <View
          className="h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: ts.iconBg }}
        >
          <Icon color={ts.iconColor} size={20} strokeWidth={2} />
        </View>
        <View className="flex-1">
          <Text
            className="text-base font-semibold"
            style={{ color: ts.titleColor }}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Text
            className="text-[13px]"
            style={{ color: ts.subColor }}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        </View>
        <ChevronRight color={ts.chevColor} size={22} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}
