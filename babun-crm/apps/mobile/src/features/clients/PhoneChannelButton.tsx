import { ActionSheetIOS, Linking, Pressable } from "react-native";
import { MessageCircle } from "lucide-react-native";
import {
  resolveChannelsForNumber,
  useEnabledChannels,
} from "@/features/clients/contact-channels";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// КНОПКА СВЯЗИ У КОНКРЕТНОГО НОМЕРА (владелец 2026-07-26: «с правой
// стороны нажимаешь кнопку и выбираешь, что делать — WhatsApp, Telegram;
// и если добавляю новый номер, кнопка появляется чётко на этот номер»).
//
// Канал — свойство НОМЕРА, а не клиента: у мужа WhatsApp, у жены Viber, и
// звонить надо ровно на тот номер, у которого нажали. Поэтому кнопка живёт
// в хвосте каждой строки-номера и знает только свой номер.
//
// Выбор — нативным ActionSheetIOS: это системное меню «что сделать», а не
// экран поверх экрана (владелец отверг кастомный лист снизу).

export default function PhoneChannelButton({
  number,
  telegramUsername,
  label,
}: {
  number: string;
  /** @username клиента — только у основного номера. */
  telegramUsername?: string | null;
  /** Для озвучки: «Связаться · Жена». */
  label?: string;
}) {
  const t = useThemeColors();
  const { data: enabled = [] } = useEnabledChannels();
  const channels = resolveChannelsForNumber(number, enabled, {
    telegramUsername,
  });

  // Нет разбираемого номера — нет и кнопки: мёртвых контролов не держим.
  if (channels.length === 0) return null;

  const onPress = () => {
    haptics.tap();
    const options = [...channels.map((c) => c.label), "Отмена"];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: number,
        options,
        cancelButtonIndex: options.length - 1,
      },
      (i) => {
        const chosen = channels[i];
        if (chosen) void Linking.openURL(chosen.url);
      },
    );
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ? `Связаться · ${label}` : "Связаться"}
      accessibilityHint="Выбор способа связи с этим номером"
      hitSlop={8}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `${t.success}1a`,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <MessageCircle color={t.success} size={16} strokeWidth={2.2} />
    </Pressable>
  );
}
