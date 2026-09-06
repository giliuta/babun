import { useState } from "react";
import { Linking } from "react-native";
import { useRouter } from "expo-router";
import { Phone } from "lucide-react-native";
import {
  resolveChannelsForNumber,
} from "@/features/clients/contact-channels";
import { useEnabledChannels } from "@/features/clients/contact-ways";
import { RowActionButton } from "@/components/ui/card-rows";
import { useDefaultCountry } from "@/features/clients/default-country";
import { useReferenceHref } from "@/features/clients/reference-href";
import { PickerSheet, type PickerSheetItem } from "@/components/ui/PickerSheet";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// КНОПКА У КОНКРЕТНОГО НОМЕРА: ТАП ЗВОНИТ, УДЕРЖАНИЕ — СПОСОБЫ СВЯЗИ.
//
// Владелец 2026-09-06: «когда тапаю на телефончик, показывается, как
// связаться, и потом я уже выбираю… лучше по-другому: один раз нажму — оно
// позвонит, а если задержу — откроются способы связи». До этого (2026-08-06)
// тап открывал лист, а звонок стоял в нём первым пунктом — то есть самое
// частое действие стоило двух тапов. Теперь оно стоит одного, а лист с
// WhatsApp, Telegram и SMS никуда не делся — он за удержанием и, для
// VoiceOver, за действием ротора «Способы связи».
//
// Канал — свойство НОМЕРА, а не клиента (владелец 2026-07-26): у мужа
// WhatsApp, у жены Viber, и звонить надо ровно на тот номер, у которого
// нажали. Поэтому кнопка живёт в хвосте каждой строки-номера и знает только
// свой номер. Лист — ТОТ ЖЕ, что у «Добавить» (владелец 2026-08-02):
// значок канала слева, шестерёнка в углу ведёт в настройки способов связи.

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
  const router = useRouter();
  // Из записи справочник открывается её сиблингом (см. `useReferenceHref`).
  const channelsHref = useReferenceHref().channels;
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

  // Звонок отключить нельзя (`optional: false`), так что у разобранного
  // номера он есть всегда; запасной путь — первый канал списка.
  const call = channels.find((c) => c.id === "call") ?? channels[0];
  const openChannels = () => {
    haptics.tap();
    setOpen(true);
  };

  return (
    <>
      <RowActionButton
        icon={Phone}
        // Акцент, как у маршрута и всех действий в хвосте строки (аудит
        // 2026-09-06): зелёный звонок рядом с синим маршрутом читался как
        // два разных предмета.
        color={t.accent}
        label={label ? `Позвонить · ${label}` : "Позвонить"}
        hint="Удерживайте, чтобы выбрать способ связи"
        onPress={() => void Linking.openURL(call.url)}
        onLongPress={openChannels}
        accessibilityActions={[{ name: "channels", label: "Способы связи" }]}
        onAccessibilityAction={(name) => {
          if (name === "channels") openChannels();
        }}
      />
      <PickerSheet
        visible={open}
        title={number}
        items={items}
        // Страница этого же списка — см. AddContactSheet.
        onSettings={() => router.push(channelsHref)}
        settingsLabel="Способы связи"
        onClose={() => setOpen(false)}
      />
    </>
  );
}
