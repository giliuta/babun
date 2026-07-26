import { Alert, Linking, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  CalendarPlus,
  MessageCircle,
  MessageSquare,
  Phone,
  Send,
  type LucideIcon,
} from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import {
  resolveChannels,
  useEnabledChannels,
  type ChannelId,
} from "@/features/clients/contact-channels";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// РЯД МАЛЕНЬКИХ КНОПОК ПОД ТЕЛЕФОНОМ (владелец 2026-07-26: «не нравится,
// что вылазит снизу; хочу под номером телефона сразу такие маленькие
// кнопочки — WhatsApp, Telegram, Viber, чат; и кнопка "Записать" такого
// же размера»).
//
// Отменяет предыдущий заход с одной кнопкой и мини-листом: лишний тап и
// экран поверх экрана вместо прямого действия. Здесь каждый способ — это
// одно нажатие, а «Записать» стоит в том же ряду и того же размера, то
// есть большой синей строки-hero на карточке больше нет вообще.
//
// Кнопка появляется ТОЛЬКО если способ реально доступен этому клиенту и
// включён в «Настройках клиентов → Способы связи».

const ICONS: Record<ChannelId, LucideIcon> = {
  call: Phone,
  whatsapp: MessageCircle,
  telegram: Send,
  viber: MessageCircle,
  sms: MessageSquare,
  chat: MessageSquare,
};

/** Короткие подписи для тесного ряда. */
const ROW_LABELS: Partial<Record<ChannelId, string>> = {
  call: "Звонок",
  chat: "Чат",
};

function ActionButton({
  label,
  color,
  Icon,
  onPress,
}: {
  label: string;
  color: string;
  Icon: LucideIcon;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: "center",
        gap: 4,
        paddingVertical: 6,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${color}1a`,
        }}
      >
        <Icon color={color} size={16} strokeWidth={2.2} />
      </View>
      <Text
        maxFontSizeMultiplier={1.1}
        numberOfLines={1}
        style={{ fontSize: 10, fontWeight: "600", color: t.sub }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function ClientContactRow({
  client,
  stats,
  separated,
}: {
  client: Client;
  stats: ClientStats | undefined;
  separated?: boolean;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const { data: enabled = [] } = useEnabledChannels();
  const channels = resolveChannels(client, enabled);

  const primaryLocationId =
    client.locations?.find((l) => l.isPrimary)?.id ??
    client.locations?.[0]?.id ??
    null;

  const book = () => {
    haptics.tap();
    const go = () =>
      router.push({
        pathname: "/(dashboard)",
        params: {
          new: "1",
          clientId: client.id,
          ...(primaryLocationId ? { locationId: primaryLocationId } : {}),
          ...(stats?.lastTeamId ? { teamId: stats.lastTeamId } : {}),
        },
      });
    // Записать человека из чёрного списка можно, но не молча.
    if (client.blacklisted) {
      Alert.alert("Клиент в чёрном списке", "Всё равно записать?", [
        { text: "Отмена", style: "cancel" },
        { text: "Записать", onPress: go },
      ]);
      return;
    }
    go();
  };

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        paddingHorizontal: 8,
        paddingBottom: 8,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
      }}
    >
      {channels.map((c) => (
        <ActionButton
          key={c.id}
          // Подписи в ряду короткие — иначе обрезаются: полные имена
          // живут в настройках («Чат в Babun»).
          label={ROW_LABELS[c.id] ?? c.label}
          color={c.color}
          Icon={ICONS[c.id]}
          onPress={() => {
            haptics.tap();
            if (c.internal) router.push(c.url as never);
            else void Linking.openURL(c.url);
          }}
        />
      ))}
      {/* «Записать» — того же размера, что каналы: это тоже одно действие
          над клиентом, а не отдельная громкая поверхность. */}
      <ActionButton
        label="Записать"
        color={t.accent}
        Icon={CalendarPlus}
        onPress={book}
      />
    </View>
  );
}
