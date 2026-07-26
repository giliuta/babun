import { useRouter } from "expo-router";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import {
  resolveChannels,
  useEnabledChannels,
} from "@/features/clients/contact-channels";
import { useGuardedBookingNav } from "@/features/clients/card-booking";
import { NavRow, RowCaption, RowGroup } from "@/features/clients/card-rows";
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

export default function ClientContactRow({
  client,
  stats,
  draft,
}: {
  client: Client;
  stats: ClientStats | undefined;
  /** Черновик: строка видна, но записывать ещё некого. */
  draft?: boolean;
}) {
  const router = useRouter();
  const { data: enabled = [] } = useEnabledChannels();
  const guardedBook = useGuardedBookingNav();
  const chat = resolveChannels(client, enabled).find((c) => c.id === "chat");

  const primaryLocationId =
    client.locations?.find((l) => l.isPrimary)?.id ??
    client.locations?.[0]?.id ??
    null;

  return (
    <>
      <RowGroup>
        <NavRow
          label="Записать"
          dimmed={draft}
          onPress={() =>
            draft
              ? undefined
              : guardedBook(client, {
                  locationId: primaryLocationId,
                  teamId: stats?.lastTeamId ?? null,
                })
          }
        />
        {chat ? (
          <NavRow
            label="Чат"
            separated
            onPress={() => {
              haptics.tap();
              router.push(chat.url as never);
            }}
          />
        ) : null}
      </RowGroup>
      {/* Не скрываем строку в черновике: владелец требует видеть страницу
          целиком. Но и мёртвого тапа не оставляем — говорим, когда включится. */}
      {draft ? <RowCaption text="Записать можно после сохранения." /> : null}
    </>
  );
}
