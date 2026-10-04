import { View } from "react-native";
import { useRouter, type Href } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import type { InvoiceLedger } from "@babun/shared/local/finance/invoice-ledger";
import { SectionCard } from "@/components/ui/SectionCard";
import { ClientBlock } from "@/features/appointments/ClientBlock";
import { PaymentTile, useTileWidth } from "@/features/appointments/PaymentTiles";
import { ObjectRow } from "@/features/clients/blocks/ObjectsBlock";
import { ClientFileRow } from "@/features/clients/ClientFileRow";
import type { ClientFileItem } from "@/features/clients/use-client-files";
import { todayYMD } from "@/features/clients/filter";
import { VisitDayHeader, VisitRow } from "@/features/clients/VisitRow";
import { accountIcon } from "@/features/finances/account-ui";
import type { AccountWithBalance } from "@/features/finances/accounts";
import { useTeams } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";

// ТО, ЧЕГО НА БУМАГЕ НЕТ, — БЛОКАМИ ПРОДУКТА, ОДИНАКОВО НА СТРАНИЦЕ ИНВОЙСА И
// ЧЕКА (владелец 2026-10-04: блок «Связи» — «сделать в нашей архитектуре»;
// «кредит-нота и чек закрепляются за инвойсом — сразу в одном файле»).
// Клиент — блоком клиента, объект — строкой объекта, запись — плашкой визита
// из истории клиента, документы (инвойс, чек, кредит-нота) — плашками из
// «Файлов», счёт — плиткой. Пустые блоки не рисуются.

type DocEntry =
  | { type: "invoice"; item: InvoiceLedger }
  | { type: "receipt"; item: Receipt };

export function DocumentLinkBlocks({
  client,
  locationId,
  appointment,
  onOpenAppointment,
  documents,
  documentsTitle = "Документы",
  account,
}: {
  client: Client | null;
  locationId?: string | null;
  appointment?: Appointment | null;
  onOpenAppointment?: () => void;
  /** Связанные документы — плашками «Файлов», тап открывает документ. */
  documents?: readonly DocEntry[];
  documentsTitle?: string;
  account?: AccountWithBalance | null;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const tileWidth = useTileWidth();
  const teams = useTeams();
  const team = appointment?.team_id
    ? (teams.data ?? []).find((item) => item.id === appointment.team_id)
    : undefined;
  const location = client?.locations.find((loc) => loc.id === locationId) ?? null;
  const docs = documents ?? [];

  const openClient = (id: string) => router.push({ pathname: "/client", params: { id } });
  const openDoc = (doc: DocEntry) =>
    router.push(
      (doc.type === "invoice" ? `/invoices/${doc.item.id}` : `/documents/receipt/${doc.item.id}`) as Href,
    );

  return (
    <View style={{ gap: 6, marginTop: 6 }}>
      {client ? (
        // Карточка — маршрутом корневого стека, поверх документа: `/clients/…`
        // живёт во вкладке «Клиенты», и «назад» оттуда уводил в календарь
        // (владелец 04.10). Тот же путь, что у записи (`app/(shared)/client`).
        // Выбирать здесь некого — карточку открывает и тап, и удержание.
        <ClientBlock
          client={client}
          onPick={() => openClient(client.id)}
          onOpenCard={() => openClient(client.id)}
        />
      ) : null}

      {location ? (
        <SectionCard title="Объект">
          <ObjectRow
            loc={location}
            showNote={false}
            onPress={() => client && openClient(client.id)}
          />
        </SectionCard>
      ) : null}

      {appointment ? (
        <SectionCard title="Запись">
          <VisitDayHeader date={appointment.date} />
          <View style={{ paddingHorizontal: 2, paddingBottom: 6 }}>
            <VisitRow
              appointment={appointment}
              team={team}
              today={todayYMD()}
              showMoney
              onPress={onOpenAppointment}
            />
          </View>
        </SectionCard>
      ) : null}

      {docs.length > 0 ? (
        <SectionCard title={documentsTitle}>
          {docs.map((doc) => {
            const at = doc.item.issued_on;
            return (
              <ClientFileRow
                key={`${doc.type}-${doc.item.id}`}
                entry={{ type: doc.type, item: doc.item, day: at, at } as ClientFileItem}
                onPress={() => openDoc(doc)}
              />
            );
          })}
        </SectionCard>
      ) : null}

      {account ? (
        <SectionCard title="Счёт">
          <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 }}>
            <PaymentTile
              icon={accountIcon(account)}
              label={account.name}
              color={account.color ?? t.ink}
              tint={account.color}
              width={tileWidth}
              compact
              state="idle"
              selected
              onPress={() => {}}
              accessibilityLabel={`Счёт: ${account.name}`}
            />
          </View>
        </SectionCard>
      ) : null}
    </View>
  );
}
