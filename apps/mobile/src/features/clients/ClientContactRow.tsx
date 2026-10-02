import { useMemo } from "react";
import { Text } from "react-native";
import { useRouter } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { resolveChannels } from "@/features/clients/contact-channels";
import { useEnabledChannels } from "@/features/clients/contact-ways";
import { useDefaultCountry } from "@/features/clients/default-country";
import { MessageCircle } from "lucide-react-native";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { ClientSummaryCard } from "@/features/clients/ClientSummaryCard";
import { lastClientRecord } from "@/features/clients/last-record";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ДЕЙСТВИЯ УРОВНЯ ЧЕЛОВЕКА — строками, а не кружками.
//
// Было: два кружка с подписями в ряду на всю ширину. Каждый занимал flex:1,
// поэтому иконки вставали в четвертях строки и читались как случайно
// разбросанные (владелец 2026-07-26: «неправильно расположенные кнопки чат
// записать»). На странице, целиком собранной из строк, кружки были
// единственным исключением — и именно оно бросалось в глаза.
//
// Стало: обычные строки той же высоты и веса, что все остальные. «Записать»
// не громче соседей (владелец: «кнопка записать должна быть такого же
// размера, как перейти в чат»), шеврон и есть признак «уводит».
//
// «Чат» рисуется только когда каналы сообщений реально подключены — сейчас
// MESSAGING_READINESS держит все предпосылки в false, а ссылка вела в корень
// чужого таба (см. contact-channels.ts).
//
// Каналы связи (звонок, WhatsApp, Telegram, SMS) здесь не живут: они
// свойство КОНКРЕТНОГО номера и висят кнопкой в хвосте своей строки.

// БЛОК «ИСТОРИЯ» (владелец 22.09, «делай как считаешь нужным»): сводка
// визитов и денег — вход в полный перечень. Были две карточки без шапки —
// единственные безымянные на странице.
//
// «ЗАПИСАТЬ» ЗДЕСЬ БОЛЬШЕ НЕТ (владелец 03.10: «нужно убрать кнопку записать
// и сделать полноценно последнюю запись»). Лицо блока — последняя запись
// целиком (`ClientSummaryCard`), тап — история со всеми записями. Записать
// клиента — «⋯» карточки и долгое нажатие в списке.

export default function ClientContactRow({
  client,
  stats,
  appointments,
  draft,
  onOpenHistory,
  showSummary = true,
  showMoney,
}: {
  client: Client;
  stats: ClientStats | undefined;
  /** Записи клиента — из них лицо блока, последняя запись. */
  appointments: readonly Appointment[];
  /** Право «История» (30.09): нет — блока нет вовсе. */
  showSummary?: boolean;
  /** Право «Долг и деньги» (30.09); нет — `caps.money`. */
  showMoney?: boolean;
  /** Черновик: записей у него ещё нет. */
  draft?: boolean;
  /** Открыть историю записей; нет — запись просто показание. */
  onOpenHistory?: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  // «Способы связи» — команды клиента (у каждой команды свои, 30.09).
  const enabled = useEnabledChannels(client.team_id ?? null);
  const country = useDefaultCountry(client.team_id ?? null);
  const chat = resolveChannels(client, enabled, { country }).find(
    (c) => c.id === "chat",
  );
  const lastRecord = useMemo(() => lastClientRecord(appointments), [appointments]);

  // В НОВОМ КЛИЕНТЕ — ТОТ ЖЕ БЛОК (владелец 22.09: «при создании — те же
  // самые блоки»): записей у него ещё нет — так и сказано, словами.
  if (draft) {
    return (
      <SectionCard title="История">
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 15, color: t.sub, paddingHorizontal: 16, paddingVertical: 12 }}
        >
          Записей пока нет
        </Text>
      </SectionCard>
    );
  }
  // Истории ему не открыли — блока нет (владелец 20.09: недоступный блок
  // просто отсутствует).
  if (!showSummary && !chat) return null;

  return (
    <SectionCard title="История">
        {showSummary ? (
          <ClientSummaryCard
            client={client}
            stats={stats}
            lastRecord={lastRecord}
            onOpenHistory={onOpenHistory}
            showMoney={showMoney}
          />
        ) : null}
        {/* Строки «Как в прошлый раз» здесь больше нет (владелец 2026-09-07:
            «это в клиентах не надо»). Повтор прошлого визита — дело формы
            записи, а не карточки. */}
        {/* СТРОКИ «НАПОМНИТЬ ОБ ОПЛАТЕ» ЗДЕСЬ БОЛЬШЕ НЕТ (владелец 2026-09-10:
            «этот блок надо вообще убрать — напомнить об оплате я сам буду
            связываться, повторять не надо»). Это второе такое решение подряд:
            кнопку «Напомнить» он снял и из списка долгов 2026-09-09 теми же
            словами. Долг человек видит в сводке карточки и в разрезе «Долги»,
            а звонить или писать решает сам — каналы связи висят у номера. */}
        {chat ? (
          <ChooseRow
            compact
            icon={MessageCircle}
            label="Чат"
            onPress={() => {
              haptics.tap();
              router.push(chat.url as never);
            }}
          />
        ) : null}
    </SectionCard>
  );
}
