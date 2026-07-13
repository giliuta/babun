// ClientActionsSheet — мини-меню клиента по long-press в списке (замена
// системного Alert: web v313 ContextMenu parity, но в мобильном диалекте —
// нижний лист, как пикеры по всему приложению). Иконка + подпись на
// строку, деструктив красным, «Отмена» отдельной кнопкой.

import { Linking, Modal, Pressable, Text, View } from "react-native";
import {
  Bell,
  Check,
  MessageCircle,
  MessageSquare,
  Phone,
  Pin,
  Trash2,
} from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { CHANNEL_COLORS } from "@babun/shared/local/chats";
import { whatsappUrl } from "@babun/shared/common/utils/messenger-links";
import { useThemeColors } from "@/theme/colors";

interface ClientActionsSheetProps {
  /** null → лист закрыт. */
  client: Client | null;
  onClose: () => void;
  onSelectMany: (c: Client) => void;
  onTogglePin: (c: Client) => void;
  onRemind: (c: Client) => void;
  onDelete: (c: Client) => void;
}

export function ClientActionsSheet({
  client,
  onClose,
  onSelectMany,
  onTogglePin,
  onRemind,
  onDelete,
}: ClientActionsSheetProps) {
  const t = useThemeColors();
  if (!client) return null;

  const digits = client.phone?.replace(/\D/g, "") ?? "";
  const wa = whatsappUrl(client.whatsapp_phone || client.phone);
  const pinned = Boolean(client.pinned_at);

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  const Row = ({
    icon,
    label,
    danger,
    onPress,
  }: {
    icon: React.ReactNode;
    label: string;
    danger?: boolean;
    onPress: () => void;
  }) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="min-h-[52px] flex-row items-center gap-3 px-5 active:opacity-60"
    >
      <View
        className="h-8 w-8 items-center justify-center rounded-full"
        style={{ backgroundColor: danger ? `${t.danger}14` : t.fill }}
      >
        {icon}
      </View>
      <Text
        className="flex-1 text-[15px] font-medium"
        style={{ color: danger ? t.danger : t.ink }}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        className="flex-1"
        style={{ backgroundColor: t.scrim }}
        onPress={onClose}
        accessibilityLabel="Закрыть меню"
      />
      <View
        className="rounded-t-3xl pb-8 pt-3"
        style={{ backgroundColor: t.surface }}
      >
        <Text
          className="px-5 pb-2 text-base font-semibold"
          style={{ color: t.ink }}
          numberOfLines={1}
        >
          {client.full_name || client.phone || "Клиент"}
        </Text>

        {digits ? (
          <>
            <Row
              icon={<Phone color={t.success} size={16} />}
              label="Позвонить"
              onPress={run(() => Linking.openURL(`tel:${digits}`))}
            />
            <Row
              icon={<MessageSquare color={t.accent} size={16} />}
              label="Сообщение"
              onPress={run(() => Linking.openURL(`sms:${digits}`))}
            />
          </>
        ) : null}
        {wa ? (
          <Row
            icon={<MessageCircle color={CHANNEL_COLORS.whatsapp} size={16} />}
            label="WhatsApp"
            onPress={run(() => Linking.openURL(wa))}
          />
        ) : null}
        <Row
          icon={<Check color={t.body} size={16} />}
          label="Выбрать несколько"
          onPress={run(() => onSelectMany(client))}
        />
        <Row
          icon={<Pin color={t.accent} size={16} />}
          label={pinned ? "Открепить" : "Закрепить"}
          onPress={run(() => onTogglePin(client))}
        />
        <Row
          icon={<Bell color={t.warning} size={16} />}
          label="Напомнить"
          onPress={run(() => onRemind(client))}
        />
        <Row
          icon={<Trash2 color={t.danger} size={16} />}
          label="Удалить"
          danger
          onPress={run(() => onDelete(client))}
        />

        <View className="px-4 pt-2">
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            className="items-center rounded-2xl py-3.5 active:opacity-70"
            style={{ backgroundColor: t.fill }}
          >
            <Text className="text-[15px] font-semibold" style={{ color: t.ink }}>
              Отмена
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
