import { useMemo } from "react";
import { Text } from "react-native";
import { useRouter } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { resolveChannels } from "@/features/clients/contact-channels";
import { useEnabledChannels } from "@/features/clients/contact-ways";
import { useDefaultCountry } from "@/features/reference/default-country";
import { MessageCircle } from "lucide-react-native";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { ClientSummaryCard } from "@/features/clients/ClientSummaryCard";
import { lastClientRecord } from "@/features/clients/last-record";
import { moreLabel } from "@/lib/more-label";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ДЕЙСТВИЯ УРОВНЯ ЧЕЛОВЕКА — строками, а не кружками.
//
// Не кружки с подписями в ряду на всю ширину: при flex:1 иконки встают в
// четвертях строки и читаются как случайно разбросанные, а на странице,
// целиком собранной из строк, кружки были бы единственным исключением.
// Поэтому — обычные строки той же высоты и веса, что все остальные. Действие
// не громче соседей, шеврон и есть признак «уводит».
//
// «Чат» рисуется только когда каналы сообщений реально подключены — сейчас
// MESSAGING_READINESS держит все предпосылки в false, а ссылка вела в корень
// чужого таба (см. contact-channels.ts).
//
// Каналы связи (звонок, WhatsApp, Telegram, SMS) здесь не живут: они
// свойство КОНКРЕТНОГО номера и висят кнопкой в хвосте своей строки.

// БЛОК «ИСТОРИЯ»: сводка визитов и денег — вход в полный перечень. Карточки
// без шапки были бы единственными безымянными на странице.
//
// «ЗАПИСАТЬ» ЗДЕСЬ НЕТ. Лицо блока — последняя запись
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
  /** Право «История»: нет — блока нет вовсе. */
  showSummary?: boolean;
  /** Деньги идут вместе с «Историей»; нет — `caps.money`. */
  showMoney?: boolean;
  /** Черновик: записей у него ещё нет. */
  draft?: boolean;
  /** Открыть историю записей; нет — запись просто показание. */
  onOpenHistory?: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  // «Способы связи» — команды клиента (у каждой команды свои).
  const enabled = useEnabledChannels(client.team_id ?? null);
  const country = useDefaultCountry(client.team_id ?? null);
  const chat = resolveChannels(client, enabled, { country }).find(
    (c) => c.id === "chat",
  );
  const lastRecord = useMemo(() => lastClientRecord(appointments), [appointments]);
  // «Ещё N» — записей сверх показанной последней (те же, что на странице
  // истории: только работы, без событий).
  const more = moreLabel(appointments.filter((a) => !a.kind || a.kind === "work").length);

  // Истории ему не открыли — блока нет (недоступный блок просто отсутствует).
  // Проверка — до черновика: черновик показывает те же блоки, что будут у
  // созданного клиента, а не больше.
  if (!showSummary && !chat) return null;
  // В НОВОМ КЛИЕНТЕ — ТОТ ЖЕ БЛОК (при создании — те же блоки): записей у него ещё нет — так и сказано, словами.
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
  return (
    <SectionCard
      title="История"
      action={
        showSummary && onOpenHistory && more
          ? { label: more, pill: true, onPress: onOpenHistory }
          : undefined
      }
    >
        {showSummary ? (
          <ClientSummaryCard
            lastRecord={lastRecord}
            onOpenHistory={onOpenHistory}
            showMoney={showMoney}
          />
        ) : null}
        {/* Строки «Как в прошлый раз» здесь нет: повтор прошлого визита —
            дело формы записи, а не карточки. */}
        {/* СТРОКИ «НАПОМНИТЬ ОБ ОПЛАТЕ» ЗДЕСЬ НЕТ: человек сам решает, когда
            напомнить об оплате; повторять не надо. Долг человек видит в сводке карточки и в разрезе «Долги»,
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
