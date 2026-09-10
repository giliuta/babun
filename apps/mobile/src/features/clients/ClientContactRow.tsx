import { useRouter } from "expo-router";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { resolveChannels } from "@/features/clients/contact-channels";
import { useEnabledChannels } from "@/features/clients/contact-ways";
import { useGuardedBookingNav } from "@/features/clients/card-booking";
import { useDefaultCountry } from "@/features/clients/default-country";
import { NavRow, RowGroup } from "@/components/ui/card-rows";
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

  // ЧЕРНОВИК БЕЗ МЁРТВЫХ СТРОК (владелец 2026-09-06: «всё как-то более
  // компактно»). Пригашенная «Записать» с подписью «можно после сохранения»
  // занимала карточку и подпись ради тапа, который ничего не делал; записать
  // человека можно сразу после «Готово» — с той же карточки.
  if (draft) return null;

  return (
    <>
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

    </>
  );
}
