import { useFeatureOn } from "@/features/settings/company-features";
import { useMemo, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { FileText, Paperclip, Video, X } from "lucide-react-native";
import type { AppointmentPhotoRecord } from "@babun/shared/db/repositories/appointment-photos";
import { randomUuid } from "@babun/shared/sync";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SelectRow } from "@/components/ui/select-rows";
import { Spinner } from "@/components/ui/Spinner";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { useThemeColors } from "@/theme/colors";
import { confirmThen } from "@/lib/confirm";
import { clientFileTimeline } from "@/features/clients/client-files";
import { ClientFileRow } from "@/features/clients/ClientFileRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { useToast } from "@/components/ui/Toast";
import { chooseOption } from "@/lib/choose";
import { haptics } from "@/lib/haptics";
import {
  getSignedUrl,
  useClientAttachments,
  useDeleteAttachment,
  useUploadAttachments,
  type ClientAttachment,
  type PickedFile,
} from "@/features/clients/card-attachments";
import { useReceipts } from "@/features/documents/receipts-queries";
import { useCreditNoteLinks, useInvoices } from "@/features/invoices/queries";
import { appointmentInvoiceFiles } from "@/features/invoices/appointment-invoices";
import { AppointmentPhotoViewer } from "./AppointmentPhotoViewer";
import { docTitle, isVideoPath, pendingDocs, pendingMedia, type PendingFile } from "./appointment-files";
import {
  MAX_APPOINTMENT_PHOTOS,
  RetryableAppointmentPhotoUploadError,
  useAppointmentPhotos,
  useDeleteAppointmentPhoto,
  useUploadAppointmentPhotos,
  type PickedAppointmentPhoto,
  type UploadAppointmentPhotosInput,
} from "./appointment-photos";
import { FileAddSheet } from "./FileAddSheet";
import { useFilePickers } from "./use-file-pickers";

// БЛОК «ФАЙЛЫ» ЗАПИСИ (STORY-070). С 03.10 — ПЕРЕЧЕНЬ ПЛАШКАМИ сверху вниз,
// как страница файлов клиента (владелец: «вниз перечень файлов по этой
// записи»; ниже — прежнее описание квадратов и пилюль 20.09, по составу оно
// верно и сейчас: что попадает в блок и откуда).
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
  const toast = useToast();
  const router = useRouter();
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
  const [viewer, setViewer] = useState<AppointmentPhotoRecord | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const photos = saved ? (photosQuery.data ?? EMPTY_PHOTOS) : EMPTY_PHOTOS;
  const docs = useMemo(
    () => (saved ? (attachments.data?.items ?? []).filter((a) => a.appointment_id === appointmentId) : []),
    [attachments.data, appointmentId, saved],
  );
  // Инвойсы и чеки — функция компании (STORY-088): выключены — их плашек в
  // «Файлах» нет; бумаги остаются в базе и вернутся при включении.
  const documentsOn = useFeatureOn("documents");
  const invoices = useMemo(
    () =>
      saved && documentsOn
        ? appointmentInvoiceFiles(
            invoicesQuery.data ?? [],
            appointmentId,
            creditLinks.data?.originalByNoteId ?? new Map(),
          )
        : [],
    [invoicesQuery.data, creditLinks.data, appointmentId, saved, documentsOn],
  );
  const receipts = useMemo(
    () =>
      saved && documentsOn ? (receiptsQuery.data ?? []).filter((r) => r.status !== "void") : [],
    [receiptsQuery.data, saved, documentsOn],
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

  // ПЕРЕЧЕНЬ ФАЙЛОВ ЗАПИСИ — СВЕРХУ ВНИЗ, ПЛАШКАМИ (владелец 03.10: «в
  // записи клиента — добавление файлов: вниз перечень файлов по этой
  // записи»). Те же плашки и то же правило, что на странице файлов клиента
  // (`clientFileTimeline` + `ClientFileRow`): фото — снимком в плитке, видео —
  // значком, документ — именем и размером, инвойс и чек — суммой цветом;
  // свежие сверху. Квадраты и пилюли записи (20.09) уступили перечню.
  const t = useThemeColors();
  const timeline = useMemo(
    () =>
      clientFileTimeline({
        attachments: docs,
        visitPhotos: photos,
        invoices,
        receipts,
      }),
    [docs, photos, invoices, receipts],
  );
  const thumbs = attachments.data?.thumbs ?? {};

  const confirmRemovePhoto = (photo: AppointmentPhotoRecord) =>
    confirmThen(
      isVideoPath(photo.storage_path) ? "Удалить видео?" : "Удалить фото?",
      { confirmLabel: "Удалить", destructive: true },
      () =>
        remove.mutate(photo, {
          onSuccess: () => toast("Удалено", "info"),
          onError: (error) => toast(error instanceof Error ? error.message : "Не удалось удалить", "error"),
        }),
    );
  const confirmRemoveDoc = (doc: ClientAttachment) =>
    confirmThen(
      "Удалить файл?",
      { message: doc.filename, confirmLabel: "Удалить", destructive: true },
      () => removeDoc.mutate(doc, { onSuccess: () => toast("Документ удалён", "info") }),
    );

  // Добавлять нельзя и файлов нет — блока нет: пустая шапка «Файлы» ничего
  // не говорит (партнёр «Только видит», запись клиента без тарифа, 02.10).
  if (!canUpload && !hasTiles) return null;

  return (
    <>
      <SectionCard title="Файлы">
        {hasTiles ? (
          <View style={{ paddingHorizontal: 2, paddingTop: 2, paddingBottom: 6, gap: 2 }}>
            {/* Ещё не сохранённая запись: выбранное ждёт «Создать запись» —
                плашкой с крестиком «убрать». */}
            {pending.map((file) => (
              <SelectRow
                key={file.id}
                icon={file.kind === "document" ? FileText : file.video ? Video : undefined}
                image={file.kind === "media" && !file.video ? (file.previewUri ?? undefined) : undefined}
                color={t.accent}
                plain
                title={file.kind === "document" ? docTitle(file.name) : file.video ? "Видео" : "Фото"}
                subtitle="Сохранится вместе с записью"
                accessibilityLabel={`${file.name}, добавится при создании`}
                onPress={() => undefined}
                trailing={
                  <Pressable
                    onPress={() => onPendingChange(pending.filter((f) => f.id !== file.id))}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Убрать ${file.name}`}
                    style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}
                  >
                    <X color={t.faint} size={18} strokeWidth={2.2} />
                  </Pressable>
                }
              />
            ))}
            {busy ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, minHeight: 44 }}>
                <Spinner size={16} label="Загрузка" />
                <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: t.sub }}>
                  Загружаем файлы…
                </Text>
              </View>
            ) : null}
            {timeline.map((entry) => {
              const key = `${entry.type}-${entry.item.id}`;
              const own = entry.type === "visit" || entry.type === "photo" || entry.type === "file";
              const onRemove = !canDelete || !own
                ? undefined
                : entry.type === "visit"
                  ? () => confirmRemovePhoto(entry.item as AppointmentPhotoRecord)
                  : () => confirmRemoveDoc(entry.item as ClientAttachment);
              const row = (
                <ClientFileRow
                  entry={entry}
                  inRecord
                  thumb={entry.type === "photo" ? thumbs[entry.item.id] : undefined}
                  onPress={() => {
                    haptics.tap();
                    switch (entry.type) {
                      case "visit": {
                        const photo = entry.item as AppointmentPhotoRecord;
                        if (isVideoPath(photo.storage_path)) void openUrl(photo.url);
                        else setViewer(photo);
                        return;
                      }
                      case "photo":
                      case "file":
                        void openDoc(entry.item);
                        return;
                      case "invoice":
                        router.push(`/invoices/${entry.item.id}` as Href);
                        return;
                      case "receipt":
                        // Чек — своей страницей, как инвойс (владелец 04.10).
                        router.push(`/documents/receipt/${entry.item.id}` as Href);
                        return;
                    }
                  }}
                  onLongPress={
                    onRemove
                      ? entry.type === "visit"
                        ? () => void holdPhoto(entry.item as AppointmentPhotoRecord)
                        : () => void holdDoc(entry.item as ClientAttachment)
                      : undefined
                  }
                />
              );
              return onRemove ? (
                <SwipeRow
                  key={key}
                  radius={t.radius.input}
                  label="Удалить"
                  color={t.danger}
                  onAction={onRemove}
                  accessibilityLabel="Удалить файл"
                >
                  {row}
                </SwipeRow>
              ) : (
                <View key={key}>{row}</View>
              );
            })}
          </View>
        ) : null}
        {/* Дверь со значком, как «Добавить файл» у клиента и «Добавить
            объект» в записи. */}
        {canUpload ? (
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

      {/* Лист «Добавить» — общий с блоком файлов клиента. Документы и скан
          требуют клиента: до его выбора этих пунктов нет. */}
      <FileAddSheet
        visible={menuOpen}
        pickers={pickers}
        withDocuments={!!clientId}
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
