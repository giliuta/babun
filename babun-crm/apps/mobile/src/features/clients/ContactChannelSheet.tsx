import { Linking, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  MessageCircle,
  MessageSquare,
  Phone,
  Send,
  type LucideIcon,
} from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  resolveChannels,
  useEnabledChannels,
  type ChannelId,
} from "@/features/clients/contact-channels";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// «КАК СВЯЗАТЬСЯ» — мини-лист по одной кнопке у номера (владелец
// 2026-07-26). Вместо ряда круглых иконок под телефоном: один тап — и
// видно все способы, которые у этого клиента ЕСТЬ и которые включены в
// настройках. Каналов без данных в листе не бывает.

const ICONS: Record<ChannelId, LucideIcon> = {
  call: Phone,
  whatsapp: MessageCircle,
  telegram: Send,
  viber: MessageCircle,
  sms: MessageSquare,
  chat: MessageSquare,
};

export function ContactChannelSheet({
  visible,
  client,
  onClose,
}: {
  visible: boolean;
  client: Client;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const { data: enabled = [] } = useEnabledChannels();
  const channels = resolveChannels(client, enabled);

  const open = (url: string, internal?: boolean) => {
    haptics.tap();
    onClose();
    if (internal) router.push(url as never);
    else void Linking.openURL(url);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeightRatio={0.8}>
      <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 }}>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 17, fontWeight: "600", color: t.ink }}
        >
          Как связаться
        </Text>
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{ marginTop: 2, fontSize: 13, color: t.faint }}
        >
          {client.full_name || client.phone}
        </Text>
      </View>

      <View style={{ paddingHorizontal: 20, paddingBottom: 28 }}>
        <View
          style={{
            borderRadius: 12,
            overflow: "hidden",
            backgroundColor: t.rowFill,
          }}
        >
          {channels.map((c, i) => {
            const Icon = ICONS[c.id];
            return (
              <Pressable
                key={c.id}
                onPress={() => open(c.url, c.internal)}
                accessibilityRole="button"
                accessibilityLabel={c.label}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  minHeight: 52,
                  paddingHorizontal: 16,
                  borderTopWidth: i > 0 ? 1 : 0,
                  borderTopColor: t.separator,
                  backgroundColor: pressed
                    ? t.rowFillPressed
                    : "transparent",
                })}
              >
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: `${c.color}1a`,
                  }}
                >
                  <Icon color={c.color} size={15} strokeWidth={2.2} />
                </View>
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={{ fontSize: 16, fontWeight: "600", color: t.ink }}
                >
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {channels.length === 0 ? (
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ paddingVertical: 18, fontSize: 15, color: t.faint }}
          >
            Не хватает данных для связи — впишите телефон или мессенджер.
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}
