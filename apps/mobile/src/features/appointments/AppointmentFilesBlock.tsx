import { useMemo, useState } from "react";
import { Linking, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Camera, FileText, Images, ScanLine } from "lucide-react-native";
import type { AppointmentPhotoRecord } from "@babun/shared/db/repositories/appointment-photos";
import { AddRow } from "@/components/ui/AddRow";
import { PickerSheet, type PickerSheetItem } from "@/components/ui/PickerSheet";
import { SectionCard } from "@/components/ui/SectionCard";
import { useToast } from "@/components/ui/Toast";
import { chooseOption } from "@/lib/choose";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import {
  getSignedUrl,
  useClientAttachments,
  useDeleteAttachment,
  useUploadAttachments,
  type ClientAttachment,
} from "@/features/clients/card-attachments";
import { AppointmentPhotoViewer } from "./AppointmentPhotoViewer";
import { isVideoPath } from "./appointment-files";
import { DocTile, PhotoTile, UploadingTile } from "./AppointmentFileTiles";
import { pagesToPdf, scanDocumentPages, scannerAvailable } from "./document-scanner";
import {
  MAX_APPOINTMENT_PHOTOS,
  RetryableAppointmentPhotoUploadError,
  useAppointmentPhotos,
  useDeleteAppointmentPhoto,
  useUploadAppointmentPhotos,
  type UploadAppointmentPhotosInput,
} from "./appointment-photos";
import { TILE_GAP, useTileWidth } from "./PaymentTiles";

// БЛОК «ФАЙЛЫ» ЗАПИСИ (STORY-070). Плитки 3 в ряд — фото записи и документы
// (они лежат во вложениях КЛИЕНТА с меткой этой записи — владелец 2026-08-03:
// «все чеки, все инвойсы — всё в одном месте»), под ними строка «Добавить»,
// как «Добавить объект» (владелец 2026-09-06: «плюсик справа не нравится —
// полноценную кнопку, как у объектов внизу»). Подпись — просто «Добавить»:
// «файлы — это файл, а фотография называется по-другому». Строка открывает
// лист: сделать фото, выбрать из галереи, выбрать файл; сканер встанет
// четвёртым с нативным модулем. Строки состояния и счётчиков нет: плитки
// говорят сами. Удаление — корзинка в углу плитки (владелец: «сейчас я не
// знаю, как удалить фотографию из файлов»); удержание — тот же лист.
//
// Камера снимает и грузит СРАЗУ, без разметки «до/после» (владелец
// 2026-09-06: «„до“ — не надо, это будет немного неправильно; просто чтобы
// была возможность загрузить, и всё, без лишнего»). Удержание плитки — только
// «Удалить». Сканер документов и видео — этап 2 истории.

const EMPTY_PHOTOS: AppointmentPhotoRecord[] = [];

export interface AppointmentFilesBlockProps {
  appointmentId: string;
  /** Владелец документов. Без него кнопки документа нет. */
  clientId: string | null;
  locationId: string | null;
  canUpload: boolean;
}

export function AppointmentFilesBlock({
  appointmentId,
  clientId,
  locationId,
  canUpload,
}: AppointmentFilesBlockProps) {
  const t = useThemeColors();
  const toast = useToast();
  const tileWidth = useTileWidth(3);
  const photosQuery = useAppointmentPhotos(appointmentId);
  const upload = useUploadAppointmentPhotos(appointmentId);
  const remove = useDeleteAppointmentPhoto(appointmentId);
  const attachments = useClientAttachments(clientId ?? "");
  const uploadDoc = useUploadAttachments(clientId ?? "", appointmentId);
  const removeDoc = useDeleteAttachment(clientId ?? "");
  const [viewer, setViewer] = useState<AppointmentPhotoRecord | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const photos = photosQuery.data ?? EMPTY_PHOTOS;
  const docs = useMemo(
    () => (attachments.data?.items ?? []).filter((a) => a.appointment_id === appointmentId),
    [attachments.data, appointmentId],
  );
  const remaining = Math.max(0, MAX_APPOINTMENT_PHOTOS - photos.length);
  const busy = upload.isPending || uploadDoc.isPending;

  const submit = (input: UploadAppointmentPhotosInput) => {
    upload.reset();
    upload.mutate(input, {
      onSuccess: (items) => {
        haptics.success();
        const videos = items.filter((item) => isVideoPath(item.storage_path)).length;
        toast(
          items.length === 1
            ? videos ? "Видео добавлено" : "Фото добавлено"
            : `Добавлено файлов: ${items.length}`,
          "success",
        );
      },
      onError: (error) => {
        haptics.error();
        const retry = error instanceof RetryableAppointmentPhotoUploadError ? error.retryInput : null;
        toast(
          error instanceof Error ? error.message : "Не удалось загрузить фото",
          "error",
          retry ? { label: "Повторить", onPress: () => submit(retry) } : undefined,
        );
      },
    });
  };

  const uploadAssets = (assets: ImagePicker.ImagePickerAsset[]) => {
    if (assets.length === 0) return;
    submit({
      assets: assets.slice(0, remaining).map((asset) => ({
        uri: asset.uri,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
        mediaType: asset.type === "video" ? "video" : "image",
      })),
      kind: "other",
      locationId,
    });
  };

  /** Общие ворота съёмки и галереи: лимит и занятость. */
  const gate = (): boolean => {
    if (busy) return false;
    if (remaining <= 0) {
      toast(`На записи уже ${MAX_APPOINTMENT_PHOTOS} фото`, "error");
      return false;
    }
    return true;
  };

  const shoot = async () => {
    if (!gate()) return;
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        notify("Нет доступа к камере", "Разрешите камеру: Настройки → Babun → Камера.");
        return;
      }
      // Камера снимает и фото, и видео (владелец: «фото-видео фиксация»).
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images", "videos"],
        quality: 0.75,
        videoMaxDuration: 60,
      });
      if (!result.canceled) uploadAssets(result.assets);
    } catch (error) {
      notify("Не удалось открыть камеру", error instanceof Error ? error.message : "Попробуйте ещё раз.");
    }
  };

  const pick = async () => {
    if (!gate()) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        notify("Нет доступа к фото", "Разрешите доступ: Настройки → Babun → Фото.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 0.75,
        // HEIC с живого iPhone бакет не примет — просим переносимый формат.
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (!result.canceled) uploadAssets(result.assets);
    } catch (error) {
      notify("Не удалось открыть галерею", error instanceof Error ? error.message : "Попробуйте ещё раз.");
    }
  };

  const pickDocument = async () => {
    if (!clientId || busy) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "text/plain", "image/jpeg", "image/png"],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (res.canceled || res.assets.length === 0) return;
      uploadDoc.mutate(
        res.assets.slice(0, 5).map((asset) => ({
          uri: asset.uri,
          fileName: asset.name,
          mimeType: asset.mimeType ?? undefined,
          fileSize: asset.size,
        })),
        {
          onSuccess: (count) => {
            haptics.success();
            toast(count === 1 ? "Файл добавлен" : `Добавлено файлов: ${count}`, "success");
          },
        },
      );
    } catch (error) {
      notify("Не удалось выбрать файл", error instanceof Error ? error.message : "Попробуйте ещё раз.");
    }
  };

  /** Удержание фото — только удаление, лист и есть подтверждение. */
  const holdPhoto = async (photo: AppointmentPhotoRecord) => {
    haptics.tap();
    const index = await chooseOption(isVideoPath(photo.storage_path) ? "Видео" : "Фото", [{ label: "Удалить", destructive: true }]);
    if (index !== 0) return;
    remove.mutate(photo, {
      onSuccess: () => toast("Фото удалено", "info"),
      onError: (error) => toast(error instanceof Error ? error.message : "Не удалось удалить фото", "error"),
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

  /** Скан: VisionKit → страницы → один PDF → документ записи. */
  const scanDocument = async () => {
    if (!clientId || busy) return;
    try {
      const pages = await scanDocumentPages();
      if (!pages) return;
      const pdf = await pagesToPdf(pages);
      uploadDoc.mutate([{ uri: pdf.uri, fileName: pdf.fileName, mimeType: "application/pdf" }], {
        onSuccess: () => {
          haptics.success();
          toast(pages.length === 1 ? "Скан добавлен" : `Скан добавлен: ${pages.length} стр.`, "success");
        },
      });
    } catch (error) {
      notify("Не удалось отсканировать", error instanceof Error ? error.message : "Попробуйте ещё раз.");
    }
  };

  const holdDoc = async (doc: ClientAttachment) => {
    haptics.tap();
    const index = await chooseOption(doc.filename, [{ label: "Удалить", destructive: true }]);
    if (index !== 0) return;
    removeDoc.mutate(doc, { onSuccess: () => toast("Документ удалён", "info") });
  };

  const menu: PickerSheetItem[] = [
    { id: "camera", label: "Снять фото или видео", icon: Camera, color: t.accent, onPress: () => void shoot() },
    { id: "library", label: "Выбрать из галереи", icon: Images, color: t.accent, onPress: () => void pick() },
    ...(clientId
      ? [{ id: "file", label: "Выбрать файл", icon: FileText, color: t.accent, onPress: () => void pickDocument() }]
      : []),
    // Только там, где нативный сканер собран (см. document-scanner.ts).
    ...(clientId && scannerAvailable()
      ? [{ id: "scan", label: "Отсканировать документ", icon: ScanLine, color: t.accent, onPress: () => void scanDocument() }]
      : []),
  ];

  return (
    <>
      <SectionCard title="Файлы">
        {photos.length > 0 || docs.length > 0 || busy ? (
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
                // Видео — системным проигрывателем по подписанной ссылке:
                // кадра-превью и встроенного плеера пока нет (STORY-070).
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
            {busy ? <UploadingTile size={tileWidth} /> : null}
          </View>
        ) : null}
        {canUpload ? (
          <AddRow
            label="Добавить"
            separated={photos.length > 0 || docs.length > 0 || busy}
            onPress={() => {
              haptics.tap();
              setMenuOpen(true);
            }}
          />
        ) : photos.length === 0 && docs.length === 0 ? (
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
            // Системный пикер поверх уходящего листа не открывается —
            // даём листу уехать.
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
