import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Linking, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { Camera, FileText, Images, Receipt, ScanLine } from "lucide-react-native";
import type { AppointmentPhotoRecord } from "@babun/shared/db/repositories/appointment-photos";
import { listAccounts } from "@babun/shared/db/repositories/accounts";
import type { Receipt as ReceiptDoc } from "@babun/shared/local/finance/receipt";
import { randomUuid } from "@babun/shared/sync";
import { AddRow } from "@/components/ui/AddRow";
import { PickerSheet, type PickerSheetItem } from "@/components/ui/PickerSheet";
import { SectionCard } from "@/components/ui/SectionCard";
import { useToast } from "@/components/ui/Toast";
import { chooseOption } from "@/lib/choose";
import { haptics } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useThemeColors } from "@/theme/colors";
import {
  getSignedUrl,
  useClientAttachments,
  useDeleteAttachment,
  useUploadAttachments,
  type ClientAttachment,
  type PickedFile,
} from "@/features/clients/card-attachments";
import { ReceiptSheet } from "@/features/documents/ReceiptSheet";
import { useReceipts } from "@/features/documents/receipts-queries";
import { useCreditNoteLinks, useInvoices } from "@/features/invoices/queries";
import { liveAppointmentInvoices } from "@/features/invoices/appointment-invoices";
import { AppointmentPhotoViewer } from "./AppointmentPhotoViewer";
import { docTitle, isVideoPath, pendingDocs, pendingMedia, type PendingFile } from "./appointment-files";
import {
  DocumentPill,
  PendingTile,
  PhotoTile,
  UploadingDocumentPill,
  UploadingTile,
} from "./AppointmentFileTiles";
import {
  MAX_APPOINTMENT_PHOTOS,
  RetryableAppointmentPhotoUploadError,
  useAppointmentPhotos,
  useDeleteAppointmentPhoto,
  useUploadAppointmentPhotos,
  type PickedAppointmentPhoto,
  type UploadAppointmentPhotosInput,
} from "./appointment-photos";
import { scannerAvailable } from "./document-scanner";
import { TILE_GAP } from "./PaymentTiles";
import { useFilePickers } from "./use-file-pickers";

// БЛОК «ФАЙЛЫ» ЗАПИСИ (STORY-070; редизайн 20.09 — владелец: «фотографии
// открываются квадратиком, обычный файл — плашкой с надписью, компактно»).
// Фото и видео — квадраты помельче с переносом строк (вид — в
// AppointmentFileTiles), документы (они лежат во вложениях КЛИЕНТА с меткой
// записи — владелец 2026-08-03: «все чеки, все инвойсы — всё в одном месте»),
// инвойс и чеки, которые выписал сам продукт (владелец: «оно автоматически
// закидывается в файлы, и там чётко написано, что это и за что») — компактные
// плашки со значком и названием. Под плитками строка «Добавить», как
// «Добавить объект»; она открывает лист: снять фото или видео, выбрать из
// галереи, выбрать файл, отсканировать документ (последнее — где собран
// нативный сканер). Строки состояния и счётчиков нет: плитки говорят сами.
// Удаление — крестик/корзинка на плитке и удержание.
//
// У НОВОЙ ЗАПИСИ БЛОК ТОЖЕ ЕСТЬ (владелец 2026-09-06: «тут нет блока файлы»):
// выбранное ждёт «Создать запись» в очереди страницы и уезжает после неё, как
// ждёт оплата. Документы и скан требуют клиента — до его выбора этих пунктов нет.

const EMPTY_PHOTOS: AppointmentPhotoRecord[] = [];

export interface AppointmentFilesBlockProps {
  /** null — запись ещё не создана: файлы копятся в `pending`. */
  appointmentId: string | null;
  clientId: string | null;
  locationId: string | null;
  canUpload: boolean;
  /** Удалять фото и документы записи. Сервер пускает только владельца и
   *  диспетчера (`storage_appointment_photos_delete`), поэтому мастеру
   *  корзинку не рисуем вовсе (15.09): иначе нажатие кончалось ошибкой. */
  canDelete?: boolean;
  pending: PendingFile[];
  onPendingChange: (next: PendingFile[]) => void;
}

export function AppointmentFilesBlock({
  appointmentId,
  clientId,
  locationId,
  canUpload,
  canDelete = true,
  pending,
  onPendingChange,
}: AppointmentFilesBlockProps) {
  const t = useThemeColors();
  const toast = useToast();
  const router = useRouter();
  const tenantId = useTenantId();
  const saved = appointmentId != null;
  const photosQuery = useAppointmentPhotos(appointmentId ?? "");
  const upload = useUploadAppointmentPhotos(appointmentId ?? "");
  const remove = useDeleteAppointmentPhoto(appointmentId ?? "");
  const attachments = useClientAttachments(clientId ?? "");
  const uploadDoc = useUploadAttachments(clientId ?? "", appointmentId);
  const removeDoc = useDeleteAttachment(clientId ?? "");
  const invoicesQuery = useInvoices();
  const creditLinks = useCreditNoteLinks();
  const receiptsQuery = useReceipts({ appointmentId, enabled: saved });
  // ЧЕК ОТКРЫВАЕТСЯ ЗДЕСЬ ЖЕ, ЛИСТОМ С «ВЫСЛАТЬ ЧЕК» (STORY-068): раньше плитка
  // уводила на экран всех чеков клиента, и до отправки было три экрана. Имя
  // счёта листу — из того же справочника, что у оплаты; грузится по открытию.
  const [openReceipt, setOpenReceipt] = useState<ReceiptDoc | null>(null);
  const accountRows = useQuery({
    queryKey: ["accounts", tenantId, "rows", "all"],
    enabled: !!tenantId && openReceipt != null,
    queryFn: () =>
      listAccounts(supabase, tenantId as string, { includeInactive: true }),
  });
  const [viewer, setViewer] = useState<AppointmentPhotoRecord | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const photos = saved ? (photosQuery.data ?? EMPTY_PHOTOS) : EMPTY_PHOTOS;
  const docs = useMemo(
    () => (saved ? (attachments.data?.items ?? []).filter((a) => a.appointment_id === appointmentId) : []),
    [attachments.data, appointmentId, saved],
  );
  const invoices = useMemo(
    () =>
      saved
        ? liveAppointmentInvoices(
            invoicesQuery.data ?? [],
            appointmentId,
            creditLinks.data?.originalByNoteId ?? new Map(),
          )
        : [],
    [invoicesQuery.data, creditLinks.data, appointmentId, saved],
  );
  const receipts = useMemo(
    () => (saved ? (receiptsQuery.data ?? []).filter((r) => r.status !== "void") : []),
    [receiptsQuery.data, saved],
  );
  // Очередь новой записи делится на медиа (квадраты) и документы (плашки) —
  // владелец 20.09: у них разный вид, поэтому и группы в раскладке разные.
  const pendingMediaFiles = pending.filter((f) => f.kind === "media");
  const pendingDocFiles = pending.filter((f) => f.kind === "document");
  const remaining = Math.max(0, MAX_APPOINTMENT_PHOTOS - photos.length - pendingMediaFiles.length);
  const photoBusy = upload.isPending;
  const docBusy = uploadDoc.isPending;
  const busy = photoBusy || docBusy;
  const hasMediaTiles = photos.length > 0 || pendingMediaFiles.length > 0 || photoBusy;
  const hasDocTiles =
    docs.length > 0 || invoices.length > 0 || receipts.length > 0 || pendingDocFiles.length > 0 || docBusy;
  const hasTiles = hasMediaTiles || hasDocTiles;

  const submit = (input: UploadAppointmentPhotosInput) => {
    upload.reset();
    upload.mutate(input, {
      onSuccess: (items) => {
        haptics.success();
        const videos = items.filter((item) => isVideoPath(item.storage_path)).length;
        toast(
          items.length === 1 ? (videos ? "Видео добавлено" : "Фото добавлено") : `Добавлено файлов: ${items.length}`,
          "success",
        );
      },
      onError: (error) => {
        haptics.error();
        const retry = error instanceof RetryableAppointmentPhotoUploadError ? error.retryInput : null;
        toast(
          error instanceof Error ? error.message : "Не удалось загрузить",
          "error",
          retry ? { label: "Повторить", onPress: () => submit(retry) } : undefined,
        );
      },
    });
  };

  const onMedia = (assets: PickedAppointmentPhoto[]) => {
    if (!saved) {
      onPendingChange([...pending, ...pendingMedia(assets, randomUuid)]);
      return;
    }
    submit({ assets, kind: "other", locationId });
  };

  const onDocs = (files: PickedFile[]) => {
    if (!clientId) return;
    if (!saved) {
      onPendingChange([...pending, ...pendingDocs(files, randomUuid)]);
      return;
    }
    uploadDoc.mutate(files, {
      onSuccess: (count) => {
        haptics.success();
        toast(count === 1 ? "Файл добавлен" : `Добавлено файлов: ${count}`, "success");
      },
    });
  };

  const pickers = useFilePickers({ remaining, busy, onMedia, onDocs });

  const holdPhoto = async (photo: AppointmentPhotoRecord) => {
    haptics.tap();
    const index = await chooseOption(isVideoPath(photo.storage_path) ? "Видео" : "Фото", [{ label: "Удалить", destructive: true }]);
    if (index !== 0) return;
    remove.mutate(photo, {
      onSuccess: () => toast("Удалено", "info"),
      onError: (error) => toast(error instanceof Error ? error.message : "Не удалось удалить", "error"),
    });
  };

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

  const holdDoc = async (doc: ClientAttachment) => {
    haptics.tap();
    const index = await chooseOption(doc.filename, [{ label: "Удалить", destructive: true }]);
    if (index !== 0) return;
    removeDoc.mutate(doc, { onSuccess: () => toast("Документ удалён", "info") });
  };

  const menu: PickerSheetItem[] = [
    { id: "camera", label: "Снять фото или видео", icon: Camera, color: t.accent, onPress: () => void pickers.shoot() },
    { id: "library", label: "Выбрать из галереи", icon: Images, color: t.accent, onPress: () => void pickers.pick() },
    ...(clientId
      ? [{ id: "file", label: "Выбрать файл", icon: FileText, color: t.accent, onPress: () => void pickers.pickDocument() }]
      : []),
    ...(clientId && scannerAvailable()
      ? [{ id: "scan", label: "Отсканировать документ", icon: ScanLine, color: t.accent, onPress: () => void pickers.scanDocument() }]
      : []),
  ];

  return (
    <>
      <SectionCard title="Файлы">
        {hasTiles ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12 }}>
            {/* Фото и видео — квадраты помельче, с переносом строк (владелец
                20.09: «фотографии открываются квадратиком»). */}
            {hasMediaTiles ? (
              <View className="flex-row flex-wrap" style={{ gap: TILE_GAP }}>
                {photos.map((photo) => (
                  <PhotoTile
                    key={photo.id}
                    photo={photo}
                    deleting={remove.isPending && remove.variables?.id === photo.id}
                    onOpen={() => (isVideoPath(photo.storage_path) ? void openUrl(photo.url) : setViewer(photo))}
                    onDelete={canDelete ? () => void holdPhoto(photo) : undefined}
                  />
                ))}
                {pendingMediaFiles.map((file) => (
                  <PendingTile
                    key={file.id}
                    file={file}
                    onDelete={() => onPendingChange(pending.filter((f) => f.id !== file.id))}
                  />
                ))}
                {photoBusy ? <UploadingTile /> : null}
              </View>
            ) : null}
            {/* Всё остальное — компактная плашка со значком и названием, не
                квадрат (владелец 20.09: «обычный файл открывается плашкой»). */}
            {hasDocTiles ? (
              <View className="flex-row flex-wrap" style={{ gap: TILE_GAP, marginTop: hasMediaTiles ? TILE_GAP : 0 }}>
                {docs.map((doc) => (
                  <DocumentPill
                    key={doc.id}
                    icon={FileText}
                    title={docTitle(doc.filename)}
                    deleting={removeDoc.isPending}
                    onOpen={() => void openDoc(doc)}
                    onDelete={canDelete ? () => void holdDoc(doc) : undefined}
                  />
                ))}
                {invoices.map((inv) => (
                  <DocumentPill
                    key={inv.id}
                    icon={Receipt}
                    title={`Инвойс ${inv.number}`}
                    onOpen={() => router.push(`/invoices/${inv.id}` as Href)}
                  />
                ))}
                {receipts.map((r) => (
                  <DocumentPill
                    key={r.id}
                    icon={Receipt}
                    title={`Чек ${r.number}`}
                    onOpen={() => setOpenReceipt(r)}
                  />
                ))}
                {pendingDocFiles.map((file) => (
                  <PendingTile
                    key={file.id}
                    file={file}
                    onDelete={() => onPendingChange(pending.filter((f) => f.id !== file.id))}
                  />
                ))}
                {docBusy ? <UploadingDocumentPill /> : null}
              </View>
            ) : null}
          </View>
        ) : null}
        {canUpload ? (
          <AddRow
            label="Добавить"
            separated={hasTiles}
            onPress={() => {
              haptics.tap();
              setMenuOpen(true);
            }}
          />
        ) : !hasTiles ? (
          <View style={{ height: 10 }} />
        ) : null}
      </SectionCard>

      <PickerSheet
        visible={menuOpen}
        title="Добавить"
        items={menu.map((item) => ({
          ...item,
          onPress: () => {
            setMenuOpen(false);
            // Системный пикер поверх уходящего листа не открывается — даём
            // листу уехать.
            setTimeout(item.onPress, 350);
          },
        }))}
        onClose={() => setMenuOpen(false)}
      />

      <AppointmentPhotoViewer
        photo={viewer}
        onClose={() => setViewer(null)}
        onRetry={async () => (await photosQuery.refetch()).isSuccess}
      />

      {/* Запись листу не передаём: мы и так на ней — строка «запись» в чеке
          молчит, а «Выслать чек» работает как на экране чеков. */}
      <ReceiptSheet
        receipt={openReceipt}
        appointment={null}
        accountName={
          (accountRows.data ?? []).find((a) => a.id === openReceipt?.account_id)
            ?.name ?? null
        }
        onClose={() => setOpenReceipt(null)}
        onOpen={(href) => router.push(href as Href)}
      />
    </>
  );
}
