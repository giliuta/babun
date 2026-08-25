import { useState } from "react";
import { Linking } from "react-native";
import { useRouter } from "expo-router";
import { MessageCircle } from "lucide-react-native";
import {
  resolveChannelsForNumber,
  useEnabledChannels,
} from "@/features/clients/contact-channels";
import { RowActionButton } from "@/features/clients/card-rows";
import { useDefaultCountry } from "@/features/clients/default-country";
import { PickerSheet, type PickerSheetItem } from "@/components/ui/PickerSheet";
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
// Лист — ТОТ ЖЕ, что у «Добавить» (владелец 2026-08-02: «сделай всё то же
// самое, как добавить, красивый дизайн»): значок канала слева, шестерёнка в
// углу ведёт в настройки, где эти способы включают тумблерами. Системное
// меню «что сделать» ни того, ни другого не умело.

export default function PhoneChannelButton({
  number,
  telegramUsername,
  label,
  size,
}: {
  number: string;
  /** @username клиента — только у основного номера. */
  telegramUsername?: string | null;
  /** Для озвучки: «Связаться · Жена». */
  label?: string;
  /** Диаметр кружка: 32 в хвосте строки карточки, 44 в списке клиентов. */
  size?: number;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const enabled = useEnabledChannels();
  const country = useDefaultCountry();
  const channels = resolveChannelsForNumber(number, enabled, {
    telegramUsername,
    country,
  });

  // Нет разбираемого номера — нет и кнопки: мёртвых контролов не держим.
  if (channels.length === 0) return null;

  const items: PickerSheetItem[] = channels.map((c) => ({
    id: c.id,
    label: c.label,
    icon: c.icon,
    color: c.color,
    // Все каналы НОМЕРА — внешние ссылки: внутренний чат ведётся с клиентом,
    // а не с номером, и в этот список не попадает (contact-channels.ts).
    onPress: () => void Linking.openURL(c.url),
  }));

  return (
    <>
      <RowActionButton
        icon={MessageCircle}
        color={t.success}
        size={size}
        label={label ? `Связаться · ${label}` : "Связаться"}
        hint="Выбор способа связи с этим номером"
        onPress={() => {
          haptics.tap();
          setOpen(true);
        }}
      />
      <PickerSheet
        visible={open}
        title={number}
        items={items}
        // Страница этого же списка — см. AddContactSheet.
        onSettings={() => router.push("/clients/channels")}
        settingsLabel="Способы связи"
        onClose={() => setOpen(false)}
      />
    </>
  );
}
