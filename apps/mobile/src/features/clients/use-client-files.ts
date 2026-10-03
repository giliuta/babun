import { useMemo } from "react";
import { useFeatureOn } from "@/features/settings/company-features";
import { useClientAppointments } from "@/features/clients/appointments";
import {
  useClientAttachments,
  useUploadAttachments,
  type PickedFile,
} from "@/features/clients/card-attachments";
import { clientFileTimeline } from "@/features/clients/client-files";
import { useClientVisitPhotos } from "@/features/clients/visit-photos";
import { useReceipts } from "@/features/documents/receipts-queries";
import { useInvoices } from "@/features/invoices/queries";
import type { PickedAppointmentPhoto } from "@/features/appointments/appointment-photos";
import { useFilePickers } from "@/features/appointments/use-file-pickers";
import { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";

// ФАЙЛЫ КЛИЕНТА — ОДИН ИСТОЧНИК НА КАРТОЧКУ И НА СТРАНИЦУ. Блок «Файлы»
// показывает последнюю запись ленты, страница — всю ленту по дням; два
// набора запросов разошлись бы на первом же новом источнике.

const EMPTY_IDS: string[] = [];
/** Выбор из галереи за один раз. */
const PICK_LIMIT = 5;

export function useClientFiles(clientId: string, showMoney: boolean) {
  const { data: appointments = [] } = useClientAppointments(clientId);
  const appointmentIds = useMemo(
    () => (appointments.length > 0 ? appointments.map((a) => a.id) : EMPTY_IDS),
    [appointments],
  );
  const attachments = useClientAttachments(clientId);
  const visitPhotos = useClientVisitPhotos(clientId, appointmentIds);
  // Инвойсы и чеки — функция компании (STORY-088) и деньги: без права
  // «Долг и деньги» их в ленте нет.
  const documentsOn = useFeatureOn("documents");
  const invoices = useInvoices({ clientId });
  const receipts = useReceipts({ clientId });
  const withDocs = documentsOn && showMoney;
  const timeline = useMemo(
    () =>
      clientFileTimeline({
        attachments: attachments.data?.items ?? [],
        visitPhotos: visitPhotos.data ?? [],
        invoices: withDocs ? (invoices.data ?? []) : [],
        receipts: withDocs ? (receipts.data ?? []) : [],
      }),
    [attachments.data, visitPhotos.data, invoices.data, receipts.data, withDocs],
  );
  return {
    timeline,
    thumbs: attachments.data?.thumbs ?? {},
    appointments,
    isLoading: attachments.isLoading,
    isError: attachments.isError,
    refetch: attachments.refetch,
    refetchVisitPhotos: visitPhotos.refetch,
  };
}

export type ClientFileItem = ReturnType<typeof useClientFiles>["timeline"][number];

/** «Добавить файл» кладёт во вложения КЛИЕНТА, а не в запись. Видео к клиенту
 *  не прикладывается: бакет вложений принимает картинки, PDF и текст. */
export function useClientFileUpload(clientId: string) {
  const toast = useToast();
  // Два экземпляра одной загрузки: строка «Загружаем» знает, что грузится.
  const uploadMedia = useUploadAttachments(clientId);
  const uploadDocs = useUploadAttachments(clientId);
  const busy = uploadMedia.isPending || uploadDocs.isPending;

  const uploaded = (count: number) => {
    haptics.success();
    toast(count === 1 ? "Файл добавлен" : `Добавлено файлов: ${count}`, "success");
  };

  const onMedia = (assets: PickedAppointmentPhoto[]) => {
    const images = assets.filter((a) => a.mediaType !== "video");
    if (images.length < assets.length) {
      toast("Видео прикладывают в записи — клиенту только фото и документы", "error");
    }
    if (images.length === 0) return;
    uploadMedia.mutate(
      images.map((a) => ({ uri: a.uri, fileName: a.fileName, mimeType: a.mimeType, fileSize: a.fileSize })),
      { onSuccess: uploaded },
    );
  };

  const onDocs = (files: PickedFile[]) => uploadDocs.mutate(files, { onSuccess: uploaded });

  const pickers = useFilePickers({ remaining: PICK_LIMIT, busy, onMedia, onDocs });
  return { pickers, busy };
}
