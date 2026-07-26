import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  CalendarPlus,
  MessageSquare,
  type LucideIcon,
} from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import {
  resolveChannels,
  useEnabledChannels,
} from "@/features/clients/contact-channels";
import { useGuardedBookingNav } from "@/features/clients/card-booking";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// РЯД КНОПОК УРОВНЯ КЛИЕНТА — «Записать» и «Чат» (владелец 2026-07-26).
//
// Каналы связи (звонок, WhatsApp, Telegram, Viber, SMS) отсюда УБРАНЫ: они
// свойство КОНКРЕТНОГО НОМЕРА и живут кнопкой в хвосте своей строки
// (PhoneChannelButton) — у мужа WhatsApp, у жены Viber, и звонить надо
// ровно на тот номер, у которого нажали.
//
// Здесь остаётся то, что относится к человеку, а не к номеру: запись и
// внутренний чат. Размер кнопок один и тот же — «Записать» не громче
// остальных, большой синей строки-hero на карточке нет.

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
  const guardedBook = useGuardedBookingNav();
  // Из общих каналов остаётся только внутренний чат — он с человеком.
  const chat = resolveChannels(client, enabled).find((c) => c.id === "chat");

  const primaryLocationId =
    client.locations?.find((l) => l.isPrimary)?.id ??
    client.locations?.[0]?.id ??
    null;

  // Предупреждение о чёрном списке живёт в общем хелпере: тем же путём
  // записывают со страницы объекта и из «Обслуживания».
  const book = () =>
    guardedBook(client, {
      locationId: primaryLocationId,
      teamId: stats?.lastTeamId ?? null,
    });

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
      {chat ? (
        <ActionButton
          label="Чат"
          color={chat.color}
          Icon={MessageSquare}
          onPress={() => {
            haptics.tap();
            router.push(chat.url as never);
          }}
        />
      ) : null}
      <ActionButton
        label="Записать"
        color={t.accent}
        Icon={CalendarPlus}
        onPress={book}
      />
    </View>
  );
}
