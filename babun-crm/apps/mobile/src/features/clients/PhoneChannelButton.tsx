import { Linking } from "react-native";
import { MessageCircle } from "lucide-react-native";
import {
  resolveChannelsForNumber,
  useEnabledChannels,
} from "@/features/clients/contact-channels";
import { RowActionButton } from "@/features/clients/card-rows";
import { chooseOption } from "@/lib/choose";
import { useThemeColors } from "@/theme/colors";

// КНОПКА СВЯЗИ У КОНКРЕТНОГО НОМЕРА (владелец 2026-07-26: «с правой
// стороны нажимаешь кнопку и выбираешь, что делать — WhatsApp, Telegram;
// и если добавляю новый номер, кнопка появляется чётко на этот номер»).
//
// Канал — свойство НОМЕРА, а не клиента: у мужа WhatsApp, у жены Viber, и
// звонить надо ровно на тот номер, у которого нажали. Поэтому кнопка живёт
// в хвосте каждой строки-номера и знает только свой номер.
//
// Выбор — через общий chooseOption (на iOS это системное меню): «что
// сделать», а не
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

  const onPress = async () => {
    const i = await chooseOption(
      number,
      channels.map((c) => ({ label: c.label })),
    );
    const chosen = i === null ? null : channels[i];
    if (chosen) void Linking.openURL(chosen.url);
  };

  return (
    <RowActionButton
      icon={MessageCircle}
      color={t.success}
      label={label ? `Связаться · ${label}` : "Связаться"}
      hint="Выбор способа связи с этим номером"
      onPress={() => void onPress()}
    />
  );
}
