import { useRouter } from "expo-router";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import {
  resolveChannels,
  useEnabledChannels,
} from "@/features/clients/contact-channels";
import { useGuardedBookingNav } from "@/features/clients/card-booking";
import { NavRow, RowGroup } from "@/features/clients/card-rows";
import { haptics } from "@/lib/haptics";

// ДЕЙСТВИЯ УРОВНЯ ЧЕЛОВЕКА — «Записать» и «Чат», СТРОКАМИ.
//
// Было: два кружка с подписями в ряду на всю ширину. Каждый занимал flex:1,
// поэтому иконки вставали в четвертях строки и читались как случайно
// разбросанные (владелец 2026-07-26: «неправильно расположенные кнопки чат
// записать»). В странице, которая целиком собрана из строк, кружки были
// единственным исключением — и это исключение и бросалось в глаза.
//
// Стало: две строки одного размера в своей группе, сразу под блоком
// идентичности. «Записать» не громче «Чата» (владелец: «кнопка записать
// должна быть такого же размера, как перейти в чат»), обе — обычные строки
// с шевроном, потому что обе УВОДЯТ с экрана.
//
// Каналы связи (звонок, WhatsApp, Telegram, SMS) здесь не живут: они
// свойство КОНКРЕТНОГО номера и висят кнопкой в хвосте своей строки.

export default function ClientContactRow({
  client,
  stats,
}: {
  client: Client;
  stats: ClientStats | undefined;
}) {
  const router = useRouter();
  const { data: enabled = [] } = useEnabledChannels();
  const guardedBook = useGuardedBookingNav();
  // Из общих каналов остаётся только внутренний чат — он с человеком.
  const chat = resolveChannels(client, enabled).find((c) => c.id === "chat");

  const primaryLocationId =
    client.locations?.find((l) => l.isPrimary)?.id ??
    client.locations?.[0]?.id ??
    null;

  return (
    <RowGroup>
      <NavRow
        label="Записать"
        onPress={() =>
          guardedBook(client, {
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
  );
}
