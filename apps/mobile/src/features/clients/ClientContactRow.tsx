import { useRouter } from "expo-router";
import type { Client, ClientNote } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import {
  resolveChannels,
  useEnabledChannels,
} from "@/features/clients/contact-channels";
import { useMemo, useState } from "react";
import { Linking } from "react-native";
import { randomUuid } from "@babun/shared/sync/uuid";
import { formatEUR } from "@babun/shared/common/utils/money";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { useToast } from "@/components/ui/Toast";
import { useClientAppointments } from "@/features/clients/appointments";
import {
  debtReminderChannels,
  debtReminderNote,
} from "@/features/clients/debt-reminder";
import { firstName } from "@/features/clients/bulk-sms";
import { useJsonArrayWriter } from "@/features/clients/use-json-writer";
import {
  renderDebtSms,
  useSmsTemplates,
} from "@/features/settings/sms-templates";
import { useThemeColors } from "@/theme/colors";
import { useGuardedBookingNav } from "@/features/clients/card-booking";
import { useDefaultCountry } from "@/features/clients/default-country";
import { clientDebt, todayYMD } from "@/features/clients/filter";
import { lastVisitTarget } from "@/features/clients/repeat-visit";
import { useServices } from "@/features/services/queries";
import { NavRow, RowCaption, RowGroup } from "@/features/clients/card-rows";
import { haptics } from "@/lib/haptics";

const EMPTY_NOTES: ClientNote[] = [];

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
  update,
}: {
  client: Client;
  stats: ClientStats | undefined;
  /** Черновик: строка видна, но записывать ещё некого. */
  draft?: boolean;
  /** Тот же persist-путь карточки — сюда уходит отметка «напомнили». */
  update: (patch: Partial<Client>) => Promise<boolean> | void;
}) {
  const t = useThemeColors();
  const toast = useToast();
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

  // «Как в прошлый раз» считается по записям ЭТОГО клиента; в черновике их
  // нет по определению, поэтому запрос там не поднимаем.
  const { data: appts = [] } = useClientAppointments(draft ? "" : client.id);
  const { data: services = [] } = useServices();
  // Справочник — источник и ОТБОРА (что ещё можно повторить), и ИМЁН (запись
  // хранит id услуги с ценой, но без названия). Одна карта на оба дела.
  const serviceNames = useMemo(
    () => new Map(services.map((s) => [s.id, s.name])),
    [services],
  );
  const repeat = useMemo(
    () => (draft ? null : lastVisitTarget(appts, todayYMD(), new Set(serviceNames.keys()))),
    [appts, draft, serviceNames],
  );
  const repeatWhat = repeat
    ? repeat.serviceIds.map((id) => serviceNames.get(id)).join(" · ")
    : null;

  // ── долг: сумма, текст напоминания и каналы, которые умеют его нести ──
  const [debtOpen, setDebtOpen] = useState(false);
  const { data: smsTemplates = [] } = useSmsTemplates();
  const debt = draft ? 0 : clientDebt(client, stats);
  const debtAmount = formatEUR(debt);
  const debtChannels = useMemo(() => {
    if (debt <= 0) return [];
    return debtReminderChannels({
      phone: client.phone,
      phoneE164: client.phone_e164,
      whatsappPhone:
        client.whatsapp_phone ||
        (client.phones ?? []).find((p) => p.label === "WhatsApp")?.number ||
        null,
      country,
      enabled,
      text: renderDebtSms(smsTemplates, {
        amount: debtAmount,
        name: firstName(client),
        visitDate: stats?.lastVisitDate
          ? stats.lastVisitDate.split("-").reverse().slice(0, 2).join(".")
          : null,
      }),
    });
  }, [debt, debtAmount, client, country, enabled, smsTemplates, stats]);

  const notes = useJsonArrayWriter<ClientNote>(
    client.notes ?? EMPTY_NOTES,
    (next) => Promise.resolve(update({ notes: next })).then((ok) => ok !== false),
  );
  const addNote = (text: string) =>
    notes.apply((all) => [
      { id: randomUuid(), text, created_at: new Date().toISOString() },
      ...all,
    ]);

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
        {/* КАК В ПРОШЛЫЙ РАЗ — самая частая работа сервиса: тот же адрес,
            та же услуга, та же команда. Строка появляется только когда
            прошлый раз ЕСТЬ, и справа говорит, что именно подставит.

            Не «Повторить» (владелец 2026-08-08: «что такое повторить — есть
            слово записать и есть слово повторить»). Одинокий глагол не
            говорил, ЧТО повторяют, и — хуже — в продукте он уже занят: в
            семи местах «Повторить» значит «повторить неудавшуюся попытку»
            (загрузка фото, импорт, обновление роли). Соседство с «Записать»
            превращало пару в загадку вместо двух понятных дверей: первая
            открывает пустую запись, вторая — заполненную прошлым визитом. */}
        {repeat ? (
          <NavRow
            label="Как в прошлый раз"
            value={repeatWhat ?? undefined}
            separated
            onPress={() =>
              guardedBook(client, {
                locationId: repeat.locationId ?? primaryLocationId,
                teamId: repeat.teamId ?? stats?.lastTeamId ?? null,
                serviceIds: repeat.serviceIds,
              })
            }
          />
        ) : null}
        {/* ДОЛГ — ГЛАГОЛ, А НЕ ЦИФРА. Сумма и раньше печаталась в сводке
            выше, но сделать с ней с карточки было нечего: текст напоминания
            и шаблоны жили на экране должников в другом табе. */}
        {debtChannels.length > 0 ? (
          <NavRow
            label="Напомнить об оплате"
            value={debtAmount}
            valueColor={t.warning}
            separated
            onPress={() => {
              haptics.tap();
              setDebtOpen(true);
            }}
          />
        ) : null}
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

      {/* Чем напомнить — тот же канонический лист, что «Как связаться»:
          набор и порядок каналов берутся из настроек тенанта. */}
      <PickerSheet
        visible={debtOpen}
        title={`Напомнить об оплате · ${debtAmount}`}
        items={debtChannels.map((c) => ({
          id: c.id,
          label: c.label,
          icon: c.icon,
          color: c.color,
          onPress: () => {
            // ЗАПИСЬ В ИСТОРИЮ — ТОЛЬКО ЕСЛИ МЕССЕНДЖЕР ОТКРЫЛСЯ. Раньше
            // заметка ставилась в тот же миг, что и `openURL`: человек
            // возвращался из WhatsApp ничего не отправив (или приложение
            // вообще не установлено), а в истории уже стояло «Напомнили».
            // Диспетчер верил записи и не звонил.
            //
            // Формулировка тоже честная: мы знаем ровно то, что открыли
            // переписку, — отправку подтвердить нечем.
            void Linking.openURL(c.url)
              .then(() => addNote(debtReminderNote(debtAmount, c.label)))
              .catch(() => {
                haptics.warning();
                toast(`Не удалось открыть ${c.label}`, "error");
              });
          },
        }))}
        onClose={() => setDebtOpen(false)}
      />
      {/* Не скрываем строку в черновике: владелец требует видеть страницу
          целиком. Но и мёртвого тапа не оставляем — говорим, когда включится. */}
      {draft ? <RowCaption text="Записать можно после сохранения." /> : null}
    </>
  );
}
