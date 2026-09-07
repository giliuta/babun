import { useMemo } from "react";
import { useRouter, type Href } from "expo-router";
import { NavRow, RowGroup } from "@/components/ui/card-rows";
import { useClientAppointments } from "@/features/clients/appointments";
import { useClientAttachments } from "@/features/clients/card-attachments";
import {
  documentGroupSummary,
  documentsCountLabel,
  groupClientDocuments,
} from "@/features/clients/client-documents";
import { formatShortDateRu } from "@/features/clients/format";
import { useClientVisitPhotos } from "@/features/clients/visit-photos";
import { useReceipts } from "@/features/documents/receipts-queries";
import { useInvoices } from "@/features/invoices/queries";
import { haptics } from "@/lib/haptics";

// ДОКУМЕНТАЦИЯ КЛИЕНТА — СВОЯ КАРТОЧКА, РАЗБИТАЯ ПО ЗАПИСЯМ (владелец
// 2026-09-07: «заметка клиента — отдельный блок; документация, счета и чеки —
// это всё документация; документ присваивается записи, и будет разбивка по
// датам»). Раньше строки «Документация» и «Счета и чеки» стояли хвостом в
// карточке заметки и сливались с ней.
//
// Строка = запись с документами: дата слева, справа — что лежит («чек · счёт
// · 3 фото»); тап открывает саму запись, где эти документы живут и где их
// добавляют. Последними — две двери в полные списки: файлы и бумаги.

const MAX_ROWS = 3;
const EMPTY_IDS: string[] = [];

export default function DocumentationBlock({ clientId }: { clientId: string }) {
  const router = useRouter();
  const { data: appointments = [] } = useClientAppointments(clientId);
  const appointmentIds = useMemo(
    () => (appointments.length > 0 ? appointments.map((a) => a.id) : EMPTY_IDS),
    [appointments],
  );
  const attachments = useClientAttachments(clientId);
  const { data: visitPhotos = [] } = useClientVisitPhotos(clientId, appointmentIds);
  const invoices = useInvoices({ clientId });
  const receipts = useReceipts({ clientId });

  const groups = useMemo(
    () =>
      groupClientDocuments({
        appointments: appointments.map((a) => ({
          id: a.id,
          date: a.date,
          time_start: a.time_start,
          team_id: a.team_id,
          serviceName: a.services?.[0]?.serviceName ?? null,
        })),
        attachments: attachments.data?.items ?? [],
        visitPhotos,
        invoices: invoices.data ?? [],
        receipts: receipts.data ?? [],
      }),
    [appointments, attachments.data, visitPhotos, invoices.data, receipts.data],
  );
  const shown = groups.slice(0, MAX_ROWS);
  const filesCount = (attachments.data?.items.length ?? 0) + visitPhotos.length;
  const paperCount = (invoices.data?.length ?? 0) + (receipts.data?.length ?? 0);
  const paperLoading = invoices.data === undefined || receipts.data === undefined;

  const openFiles = () => {
    haptics.tap();
    router.push({ pathname: "/clients/attachments", params: { clientId } });
  };

  return (
    <RowGroup title="Документация">
      {shown.map((group, i) => (
        <NavRow
          key={group.key}
          label={group.appointment ? formatShortDateRu(group.date) : "Без записи"}
          value={documentGroupSummary(group)}
          separated={i > 0}
          onPress={() => {
            if (!group.appointment) {
              openFiles();
              return;
            }
            haptics.tap();
            router.push(`/book?appointmentId=${group.appointment.id}` as Href);
          }}
        />
      ))}
      <NavRow
        label="Все файлы"
        separated={shown.length > 0}
        value={
          attachments.isLoading
            ? "Загрузка…"
            : filesCount > 0
              ? documentsCountLabel(filesCount)
              : null
        }
        // Пусто — строка остаётся: это дверь к первому файлу.
        placeholder="пока нет"
        onPress={openFiles}
      />
      <NavRow
        label="Счета и чеки"
        separated
        value={
          paperLoading ? "Загрузка…" : paperCount > 0 ? documentsCountLabel(paperCount) : null
        }
        placeholder="пока нет"
        onPress={() => {
          haptics.tap();
          router.push({ pathname: "/documents", params: { clientId } });
        }}
      />
    </RowGroup>
  );
}
