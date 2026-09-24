import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Linking, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { FileText, Paperclip, Receipt } from "lucide-react-native";
import { listAccounts } from "@babun/shared/db/repositories/accounts";
import type { PhotoKind } from "@babun/shared/db/repositories/appointment-photos";
import type { Receipt as ReceiptDoc } from "@babun/shared/local/finance/receipt";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { NavRow } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { useToast } from "@/components/ui/Toast";
import { clientSubParams } from "@/features/clients/clients-company";
import { useClientsScopeOrNull } from "@/features/clients/company-scope";
import { chooseOption } from "@/lib/choose";
import { haptics } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { docTitle, isVideoPath } from "@/features/appointments/appointment-files";
import { AppointmentPhotoViewer } from "@/features/appointments/AppointmentPhotoViewer";
import {
  DocumentPill,
  PhotoTile,
  UploadingDocumentPill,
  UploadingTile,
} from "@/features/appointments/AppointmentFileTiles";
import type { PickedAppointmentPhoto } from "@/features/appointments/appointment-photos";
import { FileAddSheet } from "@/features/appointments/FileAddSheet";
import { TILE_GAP } from "@/features/appointments/PaymentTiles";
import { useFilePickers } from "@/features/appointments/use-file-pickers";
import { useClientAppointments } from "@/features/clients/appointments";
import {
  getSignedUrl,
  useClientAttachments,
  useDeleteAttachment,
  useUploadAttachments,
  type ClientAttachment,
  type PickedFile,
} from "@/features/clients/card-attachments";
import { layoutClientFiles } from "@/features/clients/client-files";
import { useClientVisitPhotos } from "@/features/clients/visit-photos";
import { ReceiptSheet } from "@/features/documents/ReceiptSheet";
import { useReceipts } from "@/features/documents/receipts-queries";
import { useInvoices } from "@/features/invoices/queries";

// БЛОК «ФАЙЛЫ» НА СТРАНИЦЕ КЛИЕНТА (владелец 22.09: «мне не нравится блок
// „Документация“… уберём полностью и просто туда вставим, как у нас файлы, как
// везде хранятся файлы»). Прежняя карточка «Документация» считала бумаги по
// датам визитов («14 авг · чек») — человек видел подсчёт, а не сами файлы.
//
// Теперь это тот же блок, что у записи: фото и видео — квадраты
// (`PhotoTile`), документы, инвойсы и чеки — плашки со значком (`DocumentPill`),
// под ними «Добавить» с тем же листом (`FileAddSheet`). Плитки, плашки и лист —
// общие с записью, а не копии. Разница только в источнике: здесь ВСЕ файлы
// клиента — его вложения (туда же ложатся документы записей), фото со всех
// выездов, инвойсы и чеки. Свежие сверху; не поместилось — строка «Все файлы»
// на полную страницу вложений.
//
// «Добавить» кладёт во вложения КЛИЕНТА, а не в запись. Фото с выездов и
// бумаги отсюда не удаляются: фото принадлежит записи, инвойс и чек
// аннулируют там, где выписали. Удалить можно только вложение клиента.
//
// Видео к клиенту не прикладывается: бакет вложений принимает картинки, PDF и
// текст. Видео снимают в записи — там оно и хранится.

const EMPTY_IDS: string[] = [];
/** Выбор из галереи за один раз — как на странице вложений. */
const PICK_LIMIT = 5;

export default function ClientFilesBlock({
  clientId,
  canChange,
  openOnArrive,
  onArrived,
}: {
  clientId: string;
  /** Добавлять и удалять вложения. Без права — только смотреть. */
  canChange: boolean;
  /** Карточку создали из черновика ради файла — сразу открыть лист. */
  openOnArrive?: boolean;
  onArrived?: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const scope = useClientsScopeOrNull();
  const tenantId = useTenantId();
  const { data: appointments = [] } = useClientAppointments(clientId);
  const appointmentIds = useMemo(
    () => (appointments.length > 0 ? appointments.map((a) => a.id) : EMPTY_IDS),
    [appointments],
  );
  const attachments = useClientAttachments(clientId);
  const visitPhotos = useClientVisitPhotos(clientId, appointmentIds);
  const invoices = useInvoices({ clientId });
  const receipts = useReceipts({ clientId });
  // Два экземпляра одной загрузки: так спиннер встаёт квадратом у снимков и
  // плашкой у документов, без отдельного состояния «что грузим».
  const uploadMedia = useUploadAttachments(clientId);
  const uploadDocs = useUploadAttachments(clientId);
  const removeDoc = useDeleteAttachment(clientId);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!openOnArrive || !canChange) return;
    setMenuOpen(true);
    onArrived?.();
  }, [openOnArrive, canChange, onArrived]);
  const [viewer, setViewer] = useState<{ url: string; kind: PhotoKind; source: "attachment" | "visit" } | null>(null);
  // Чек открывается здесь же листом с «Выслать чек» — как в блоке записи.
  const [openReceipt, setOpenReceipt] = useState<ReceiptDoc | null>(null);
  const accountRows = useQuery({
    queryKey: ["accounts", tenantId, "rows", "all"],
    enabled: !!tenantId && openReceipt != null,
    queryFn: () => listAccounts(supabase, tenantId as string, { includeInactive: true }),
  });

  const thumbs = attachments.data?.thumbs;
  const layout = useMemo(
    () =>
      layoutClientFiles({
        attachments: attachments.data?.items ?? [],
        visitPhotos: visitPhotos.data ?? [],
        invoices: invoices.data ?? [],
        receipts: receipts.data ?? [],
      }),
    [attachments.data, visitPhotos.data, invoices.data, receipts.data],
  );
  const mediaBusy = uploadMedia.isPending;
  const docBusy = uploadDocs.isPending;
  const hasMediaTiles = layout.media.length > 0 || mediaBusy;
  const hasDocTiles = layout.papers.length > 0 || docBusy;
  const hasTiles = hasMediaTiles || hasDocTiles;
  // Счета и чеки всего — показанные плашками и не поместившиеся.
  const docsTotal =
    layout.hiddenPapers + layout.papers.filter((e) => e.type !== "file").length;

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

  const pickers = useFilePickers({
    remaining: PICK_LIMIT,
    busy: mediaBusy || docBusy,
    onMedia,
    onDocs,
  });

  const openUrl = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Не удалось открыть файл", "error");
    }
  };

  const openDoc = async (doc: ClientAttachment) => {
    try {
      await openUrl(await getSignedUrl(doc));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Не удалось открыть документ", "error");
    }
  };

  const holdAttachment = async (doc: ClientAttachment) => {
    haptics.tap();
    const index = await chooseOption(doc.filename, [{ label: "Удалить", destructive: true }]);
    if (index !== 0) return;
    removeDoc.mutate(doc, { onSuccess: () => toast("Удалено", "info") });
  };

  const deleting = (doc: ClientAttachment) => removeDoc.isPending && removeDoc.variables?.id === doc.id;

  const openAll = () => {
    haptics.tap();
    router.push({ pathname: "/clients/attachments", params: clientSubParams(clientId, scope) });
  };

  // Смотреть нечего и добавить нельзя — блока нет (закон «недоступный блок
  // просто отсутствует»): пустая шапка «Файлы» с полосой ни о чём не говорит.
  if (!canChange && !hasTiles && layout.hidden === 0 && layout.hiddenPapers === 0) {
    return null;
  }

  return (
    <>
      <SectionCard title="Файлы">
        {hasTiles ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12 }}>
            {hasMediaTiles ? (
              <View className="flex-row flex-wrap" style={{ gap: TILE_GAP }}>
                {layout.media.map((entry) =>
                  entry.type === "attachment" ? (
                    <PhotoTile
                      key={entry.item.id}
                      photo={{ storage_path: entry.item.storage_path, url: thumbs?.[entry.item.id] ?? "" }}
                      deleting={deleting(entry.item)}
                      onOpen={() => {
                        const url = thumbs?.[entry.item.id];
                        if (url) setViewer({ url, kind: "other", source: "attachment" });
                        else void openDoc(entry.item);
                      }}
                      onDelete={canChange ? () => void holdAttachment(entry.item) : undefined}
                    />
                  ) : (
                    <PhotoTile
                      key={entry.item.id}
                      photo={entry.item}
                      deleting={false}
                      onOpen={() =>
                        isVideoPath(entry.item.storage_path)
                          ? void openUrl(entry.item.url)
                          : setViewer({ url: entry.item.url, kind: entry.item.kind, source: "visit" })
                      }
                    />
                  ),
                )}
                {mediaBusy ? <UploadingTile /> : null}
              </View>
            ) : null}
            {hasDocTiles ? (
              <View className="flex-row flex-wrap" style={{ gap: TILE_GAP, marginTop: hasMediaTiles ? TILE_GAP : 0 }}>
                {layout.papers.map((entry) =>
                  entry.type === "file" ? (
                    <DocumentPill
                      key={entry.item.id}
                      icon={FileText}
                      title={docTitle(entry.item.filename)}
                      deleting={deleting(entry.item)}
                      onOpen={() => void openDoc(entry.item)}
                      onDelete={canChange ? () => void holdAttachment(entry.item) : undefined}
                    />
                  ) : entry.type === "invoice" ? (
                    <DocumentPill
                      key={entry.item.id}
                      icon={Receipt}
                      title={`Инвойс ${entry.item.number}`}
                      onOpen={() => router.push(`/invoices/${entry.item.id}` as Href)}
                    />
                  ) : (
                    <DocumentPill
                      key={entry.item.id}
                      icon={Receipt}
                      title={`Чек ${entry.item.number}`}
                      onOpen={() => setOpenReceipt(entry.item)}
                    />
                  ),
                )}
                {docBusy ? <UploadingDocumentPill /> : null}
              </View>
            ) : null}
          </View>
        ) : null}
        {/* Не поместилось — дверь на полную страницу; поместилось всё — строки
            нет, плитки говорят сами. */}
        {/* ОДНА ДВЕРЬ ВМЕСТО ДВУХ (владелец 22.09: «этот „Счета и чеки“ —
            для чего он нужен?»). Строка «Счета и чеки» вела на другую
            страницу, чем «Все файлы», и блок отвечал на один вопрос двумя
            дверями. Теперь дверь одна — страница всех файлов клиента, а
            счета и чеки живут строкой ВНУТРИ неё. */}
        {/* Дверь стоит, если за ней есть что-то, чего не видно здесь: файлы
            или счета и чеки сверх плашек (у Артёма их шесть, а плашек три —
            без двери остальные были недостижимы с карточки, 23.09). Число —
            всё, что лежит за дверью. */}
        {layout.total > 0 || layout.hiddenPapers > 0 ? (
          <NavRow
            label="Все файлы"
            value={String(layout.total + docsTotal)}
            separated={hasTiles}
            onPress={openAll}
          />
        ) : null}
        {canChange ? (
          // Дверь со значком, как «Добавить объект» (одна дверь на странице).
          <ChooseRow
            compact
            icon={Paperclip}
            label="Добавить файл"
            onPress={() => {
              haptics.tap();
              setMenuOpen(true);
            }}
          />
        ) : !hasTiles ? (
          <View style={{ height: 10 }} />
        ) : null}
      </SectionCard>

      <FileAddSheet
        visible={menuOpen}
        pickers={pickers}
        withDocuments
        onClose={() => setMenuOpen(false)}
      />

      <AppointmentPhotoViewer
        photo={viewer ? { url: viewer.url, kind: viewer.kind, caption: "" } : null}
        onClose={() => setViewer(null)}
        onRetry={async () =>
          (await (viewer?.source === "visit" ? visitPhotos.refetch() : attachments.refetch())).isSuccess
        }
      />

      <ReceiptSheet
        receipt={openReceipt}
        appointment={null}
        accountName={(accountRows.data ?? []).find((a) => a.id === openReceipt?.account_id)?.name ?? null}
        onClose={() => setOpenReceipt(null)}
        onOpen={(href) => router.push(href as Href)}
      />
    </>
  );
}
