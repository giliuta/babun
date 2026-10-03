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
import { formatPhoneForDisplay, tryToE164 } from "@/features/clients/phone";
import { useClientSettingsDoor } from "@/features/clients/use-settings-door";
import { PickerSheet, type PickerSheetItem } from "@/components/ui/PickerSheet";
import { useSmsComposeContext } from "@/features/sms/SmsCompose";
import { SmsSendSheet } from "@/features/sms/SmsSendSheet";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// КНОПКА У КОНКРЕТНОГО НОМЕРА: ТАП — «СВЯЗАТЬСЯ», УДЕРЖАНИЕ — ЗВОНОК.
//
// Владелец 2026-09-22: «звоночек справа должен открывать, как я хочу
// связаться». Это разворот его же закона от 2026-09-06 (тап звонил, лист
// способов был за удержанием): номер ведёт то в WhatsApp, то в Telegram, и
// угадывать за него способ хуже, чем показать все. Поэтому тап открывает
// лист «Связаться» в постоянном порядке «Способов связи» (рука запоминает
// место строки), а удержание — прежний звонок в одно движение. Способ
// один (включён только звонок) — листа нет, тап сразу звонит: шторка из
// одной строки — лишний этап.
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
  smsName,
  teamId = null,
}: {
  number: string;
  /** @username клиента — только у основного номера. */
  telegramUsername?: string | null;
  /** Для озвучки: «Связаться · Жена». */
  label?: string;
  /** Чей номер, если не клиента страницы: [Имя] в шаблоне SMS — его. */
  smsName?: string | null;
  /** Команда клиента — её «Способы связи» (у каждой команды свои, 30.09);
   *  нет — набор компании. */
  teamId?: string | null;
}) {
  const t = useThemeColors();
  const router = useRouter();
  // Шестерёнка — в «Связь» ЭТОЙ команды в её компании (из записи — сиблингом
  // записи, см. `useReferenceHref`); строки, закрытой человеку, нет и в листе.
  const settingsHref = useClientSettingsDoor("ways", teamId);
  const [open, setOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  // Где стоит номер — запись или карточка: её поля встанут в шаблоны SMS
  // (STORY-089). Нет контекста (список клиентов) — «Сообщения» телефона.
  const smsContext = useSmsComposeContext();
  const enabled = useEnabledChannels(teamId);
  const country = useDefaultCountry(teamId);
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
    // «SMS» — единственная дверь отправки (владелец 03.10): шаблон галкой,
    // внизу «Отправить от …» и «Со своего телефона».
    onPress:
      c.id === "sms" && smsContext
        ? () => setSmsOpen(true)
        : () => void Linking.openURL(c.url),
  }));

  // Звонок отключить нельзя (`optional: false`), так что у разобранного
  // номера он есть всегда; запасной путь — первый канал списка.
  const call = channels.find((c) => c.id === "call") ?? channels[0];
  const single = channels.length === 1;
  const dial = () => {
    haptics.tap();
    void Linking.openURL(call.url);
  };
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
        label={label ? `Связаться · ${label}` : "Связаться"}
        hint={single ? undefined : "Удерживайте, чтобы сразу позвонить"}
        onPress={single ? dial : openChannels}
        onLongPress={single ? undefined : dial}
        accessibilityActions={single ? undefined : [{ name: "call", label: "Позвонить" }]}
        onAccessibilityAction={(name) => {
          if (name === "call") dial();
        }}
      />
      <PickerSheet
        visible={open}
        // Номер — как его диктуют (своя страна без «+357»), а не сырой из базы.
        title={formatPhoneForDisplay(number, country)}
        items={items}
        // Страница этого же списка — см. AddContactSheet.
        onSettings={settingsHref ? () => router.push(settingsHref) : undefined}
        settingsLabel="Связь"
        onClose={() => setOpen(false)}
      />
      {smsContext ? (
        <SmsSendSheet
          visible={smsOpen}
          // Без записи — от команды клиента (её «Способы связи» уже здесь).
          context={{ ...smsContext, teamId: smsContext.teamId ?? teamId }}
          phone={tryToE164(number, country) ?? number}
          name={smsName}
          onClose={() => setSmsOpen(false)}
        />
      ) : null}
    </>
  );
}
