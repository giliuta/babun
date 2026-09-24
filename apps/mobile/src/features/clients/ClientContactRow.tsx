import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { resolveChannels } from "@/features/clients/contact-channels";
import { useEnabledChannels } from "@/features/clients/contact-ways";
import { useGuardedBookingNav } from "@/features/clients/card-booking";
import { useDefaultCountry } from "@/features/clients/default-country";
import { CalendarPlus, MessageCircle } from "lucide-react-native";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { ClientSummaryCard } from "@/features/clients/ClientSummaryCard";
import { haptics } from "@/lib/haptics";

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
// визитов и денег — вход в полный перечень, под ней дверь «Записать». Были
// две карточки без шапки — единственные безымянные на странице.

export default function ClientContactRow({
  client,
  stats,
  draft,
  onOpenHistory,
  onDraftBook,
  bookOnArrive,
  onArrived,
}: {
  client: Client;
  stats: ClientStats | undefined;
  /** Черновик: строка видна, но записывать ещё некого. */
  draft?: boolean;
  /** Открыть историю записей; нет — сводка просто текст. */
  onOpenHistory?: () => void;
  /** Новый клиент: «Записать» сперва создаёт карточку. */
  onDraftBook?: () => void;
  /** Карточку только что создали ради записи — сразу открыть форму. */
  bookOnArrive?: boolean;
  onArrived?: () => void;
}) {
  const router = useRouter();
  const enabled = useEnabledChannels();
  const guardedBook = useGuardedBookingNav();
  const country = useDefaultCountry();
  const chat = resolveChannels(client, enabled, { country }).find(
    (c) => c.id === "chat",
  );

  const primaryLocationId =
    client.locations?.find((l) => l.isPrimary)?.id ??
    client.locations?.[0]?.id ??
    null;

  const book = () =>
    guardedBook(client, {
      locationId: primaryLocationId,
      teamId: stats?.lastTeamId ?? null,
    });
  // Карточку создали из черновика ради записи — форма открывается сама.
  const bookRef = useRef(book);
  bookRef.current = book;
  // Один раз: `onArrived` новый на каждой отрисовке, и пока параметр не
  // снят, эффект иначе открыл бы форму второй раз.
  const booked = useRef(false);
  useEffect(() => {
    if (!bookOnArrive || booked.current) return;
    booked.current = true;
    onArrived?.();
    bookRef.current();
  }, [bookOnArrive, onArrived]);

  // В НОВОМ КЛИЕНТЕ — ТОТ ЖЕ БЛОК (владелец 22.09: «при создании — те же
  // самые блоки»). Записать можно только того, кто есть: дверь сперва
  // создаёт карточку, а форма записи открывается уже на ней.
  if (draft) {
    return onDraftBook ? (
      <SectionCard title="История">
        <ChooseRow compact icon={CalendarPlus} label="Записать" onPress={onDraftBook} />
      </SectionCard>
    ) : null;
  }

  return (
    <SectionCard title="История">
        <ClientSummaryCard
          client={client}
          stats={stats}
          onOpenHistory={onOpenHistory}
        />
        <ChooseRow
          compact
          icon={CalendarPlus}
          label="Записать"
          onPress={book}
        />
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
