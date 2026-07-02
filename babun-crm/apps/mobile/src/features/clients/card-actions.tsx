// card-actions — the 5 always-visible quick actions of the client card
// (mobile port of apps/web/src/components/clients/ClientQuickActions.tsx,
// visual language from the LOCKED client-app.html mockup «qa» row):
//
//   Звонок · Записать · WhatsApp · Чат · Напомнить
//
// Color budget: neutral circles; green ONLY on the comms that dial out
// (Звонок, WhatsApp). Disabled-not-hidden (no phone → dimmed) so the row
// never reflows. «Записать» opens the calendar pre-aimed via card-booking;
// «Напомнить» sets client.reminder_at through quick presets (web uses a
// native date input — RN has no such input, presets keep it 2 taps).

import { Alert, Linking, Pressable, Text, View } from "react-native";
import {
  Bell,
  CalendarPlus,
  MessageCircle,
  MessageSquare,
  Phone,
} from "lucide-react-native";
import { useRouter } from "expo-router";
import type { Client } from "@babun/shared/local/clients";
import { CHANNEL_COLORS } from "@babun/shared/local/chats";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import {
  telUrl,
  whatsappUrl,
} from "@babun/shared/common/utils/messenger-links";
import { useBookingNav } from "@/features/clients/card-booking";
import { formatShortDateRu } from "@/features/clients/format";
import { useThemeColors } from "@/theme/colors";

interface CardActionsProps {
  client: Client;
  stats: ClientStats | undefined;
  update: (patch: Partial<Client>) => void;
}

function ymdInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CardActions({ client, stats, update }: CardActionsProps) {
  const t = useThemeColors();
  const router = useRouter();
  const book = useBookingNav();

  const tel = telUrl(client.phone);
  const wa = whatsappUrl(client.whatsapp_phone || client.phone);
  const primaryLocationId =
    client.locations?.find((l) => l.isPrimary)?.id ??
    client.locations?.[0]?.id ??
    null;

  const onBook = () =>
    book({
      clientId: client.id,
      locationId: primaryLocationId,
      teamId: stats?.lastTeamId ?? null,
    });

  // Mobile chats list doesn't take a client filter param yet — plain open
  // (degrades gracefully, same tab the web deep-link lands on).
  const onChat = () => router.push("/(dashboard)/chats");

  const onRemind = () => {
    Alert.alert(
      "Напомнить о клиенте",
      client.reminder_at
        ? `Сейчас стоит на ${formatShortDateRu(client.reminder_at) || client.reminder_at}`
        : undefined,
      [
        { text: "Завтра", onPress: () => update({ reminder_at: ymdInDays(1) }) },
        { text: "Через неделю", onPress: () => update({ reminder_at: ymdInDays(7) }) },
        { text: "Через месяц", onPress: () => update({ reminder_at: ymdInDays(30) }) },
        ...(client.reminder_at
          ? [
              {
                text: "Убрать напоминание",
                style: "destructive" as const,
                onPress: () => update({ reminder_at: null }),
              },
            ]
          : []),
        { text: "Отмена", style: "cancel" as const },
      ],
    );
  };

  return (
    <View className="mx-3 mb-1 mt-3 flex-row items-start justify-between px-1">
      <Action
        label="Звонок"
        icon={<Phone color={tel ? t.success : t.faint} size={21} strokeWidth={2} />}
        onPress={tel ? () => Linking.openURL(tel) : undefined}
      />
      <Action
        label="Записать"
        icon={<CalendarPlus color={t.ink} size={21} strokeWidth={2} />}
        onPress={onBook}
      />
      <Action
        label="WhatsApp"
        icon={
          <MessageCircle
            color={wa ? CHANNEL_COLORS.whatsapp : t.faint}
            size={21}
            strokeWidth={2}
          />
        }
        onPress={wa ? () => Linking.openURL(wa) : undefined}
      />
      <Action
        label="Чат"
        icon={<MessageSquare color={t.ink} size={21} strokeWidth={2} />}
        onPress={onChat}
      />
      <Action
        label="Напомнить"
        icon={<Bell color={t.ink} size={21} strokeWidth={2} />}
        onPress={onRemind}
      />
    </View>
  );
}

function Action({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  onPress?: () => void;
}) {
  const t = useThemeColors();
  const enabled = !!onPress;
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      className={`items-center gap-1.5 active:opacity-70 ${enabled ? "" : "opacity-40"}`}
    >
      <View
        className="h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: t.fill }}
      >
        {icon}
      </View>
      <Text className="text-[11px]" style={{ color: t.sub }}>
        {label}
      </Text>
    </Pressable>
  );
}
