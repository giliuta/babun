import { useMemo, useState } from "react";
import { Linking, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { Camera, FileText, Images, Receipt, ScanLine } from "lucide-react-native";
import type { AppointmentPhotoRecord } from "@babun/shared/db/repositories/appointment-photos";
import { formatEURExact } from "@babun/shared/common/utils/money";
import { randomUuid } from "@babun/shared/sync";
import { AddRow } from "@/components/ui/AddRow";
import { PickerSheet, type PickerSheetItem } from "@/components/ui/PickerSheet";
import { SectionCard } from "@/components/ui/SectionCard";
import { useToast } from "@/components/ui/Toast";
import { chooseOption } from "@/lib/choose";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import {
  getSignedUrl,
  useClientAttachments,
  useDeleteAttachment,
  useUploadAttachments,
  type ClientAttachment,
  type PickedFile,
} from "@/features/clients/card-attachments";
import { formatShortDateRu } from "@/features/clients/format";
import { useReceipts } from "@/features/documents/receipts-queries";
import { useInvoices } from "@/features/invoices/queries";
import { AppointmentPhotoViewer } from "./AppointmentPhotoViewer";
import { isVideoPath, pendingDocs, pendingMedia, type PendingFile } from "./appointment-files";
import { DocTile, GeneratedDocTile, PendingTile, PhotoTile, UploadingTile } from "./AppointmentFileTiles";
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
import { TILE_GAP, useTileWidth } from "./PaymentTiles";
import { useFilePickers } from "./use-file-pickers";

// БЛОК «ФАЙЛЫ» ЗАПИСИ (STORY-070). Плитки 3 в ряд — фото и видео записи,
// документы (они лежат во вложениях КЛИЕНТА с меткой записи — владелец
// 2026-08-03: «все чеки, все инвойсы — всё в одном месте»), инвойс и чеки,
// которые выписал сам продукт (владелец: «оно автоматически закидывается в
// файлы, и там чётко написано, что это и за что»). Под плитками строка
// «Добавить», как «Добавить объект»; она открывает лист: снять фото или видео,
// выбрать из галереи, выбрать файл, отсканировать документ (последнее — где
// собран нативный сканер). Строки состояния и счётчиков нет: плитки говорят
// сами. Удаление — корзинка в углу плитки и удержание.
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
  pending: PendingFile[];
  onPendingChange: (next: PendingFile[]) => void;
}

export function AppointmentFilesBlock({
  appointmentId,
  clientId,
  locationId,
  canUpload,
  pending,
  onPendingChange,
}: AppointmentFilesBlockProps) {
  const t = useThemeColors();
  const toast = useToast();
  const router = useRouter();
  const tileWidth = useTileWidth(3);
  const saved = appointmentId != null;
  const photosQuery = useAppointmentPhotos(appointmentId ?? "");
  const upload = useUploadAppointmentPhotos(appointmentId ?? "");
  const remove = useDeleteAppointmentPhoto(appointmentId ?? "");
  const attachments = useClientAttachments(clientId ?? "");
  const uploadDoc = useUploadAttachments(clientId ?? "", appointmentId);
  const removeDoc = useDeleteAttachment(clientId ?? "");
  const invoicesQuery = useInvoices();
  const receiptsQuery = useReceipts({ appointmentId, enabled: saved });
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
        ? (invoicesQuery.data ?? []).filter(
            (inv) => inv.appointment_id === appointmentId && inv.status !== "void" && inv.status !== "cancelled",
          )
        : [],
    [invoicesQuery.data, appointmentId, saved],
  );
  const receipts = useMemo(
    () => (saved ? (receiptsQuery.data ?? []).filter((r) => r.status !== "void") : []),
    [receiptsQuery.data, saved],
  );
  const remaining = Math.max(0, MAX_APPOINTMENT_PHOTOS - photos.length - pending.filter((f) => f.kind === "media").length);
  const busy = upload.isPending || uploadDoc.isPending;
  const hasTiles = photos.length + docs.length + invoices.length + receipts.length + pending.length > 0 || busy;

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
          <View
            className="flex-row flex-wrap"
            style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12, gap: TILE_GAP }}
          >
            {photos.map((photo) => (
              <PhotoTile
                key={photo.id}
                photo={photo}
                size={tileWidth}
                deleting={remove.isPending && remove.variables?.id === photo.id}
                onOpen={() => (isVideoPath(photo.storage_path) ? void openUrl(photo.url) : setViewer(photo))}
                onDelete={() => void holdPhoto(photo)}
              />
            ))}
            {docs.map((doc) => (
              <DocTile
                key={doc.id}
                doc={doc}
                size={tileWidth}
                deleting={removeDoc.isPending}
                onOpen={() => void openDoc(doc)}
                onDelete={() => void holdDoc(doc)}
              />
            ))}
            {invoices.map((inv) => (
              <GeneratedDocTile
                key={inv.id}
                icon={FileText}
                title={`Инвойс ${inv.number}`}
                subtitle={`${formatEURExact(inv.total)} · ${inv.status === "paid" ? "оплачен" : "ждёт оплаты"}`}
                size={tileWidth}
                onOpen={() => router.push(`/invoices/${inv.id}` as Href)}
              />
            ))}
            {receipts.map((r) => (
              <GeneratedDocTile
                key={r.id}
                icon={Receipt}
                title={`Чек ${r.number}`}
                subtitle={`${formatEURExact(r.amount)} · ${formatShortDateRu(r.issued_on)}`}
                size={tileWidth}
                onOpen={() =>
                  router.push(
                    (clientId ? { pathname: "/documents/receipts", params: { clientId } } : "/documents/receipts") as Href,
                  )
                }
              />
            ))}
            {pending.map((file) => (
              <PendingTile
                key={file.id}
                file={file}
                size={tileWidth}
                onDelete={() => onPendingChange(pending.filter((f) => f.id !== file.id))}
              />
            ))}
            {busy ? <UploadingTile size={tileWidth} /> : null}
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
    </>
  );
}
