import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useToast } from "@/components/ui/Toast";
import { notify } from "@/lib/notify";
import type { PickedFile } from "@/features/clients/card-attachments";
import { MAX_APPOINTMENT_PHOTOS, type PickedAppointmentPhoto } from "./appointment-photos";
import { pagesToPdf, scanDocumentPages } from "./document-scanner";

// ПИКЕРЫ БЛОКА «ФАЙЛЫ» — разрешения, лимиты, разбор ответа. Блок решает,
// что делать с выбранным: грузить сразу (сохранённая запись) или держать в
// очереди до создания (новая). Камера отдаёт и фото, и видео.

export function useFilePickers(opts: {
  remaining: number;
  busy: boolean;
  onMedia: (assets: PickedAppointmentPhoto[]) => void;
  onDocs: (files: PickedFile[]) => void;
}) {
  const toast = useToast();

  const gate = (): boolean => {
    if (opts.busy) return false;
    if (opts.remaining <= 0) {
      toast(`На записи уже ${MAX_APPOINTMENT_PHOTOS} файлов`, "error");
      return false;
    }
    return true;
  };

  const toMedia = (assets: ImagePicker.ImagePickerAsset[]): PickedAppointmentPhoto[] =>
    assets.slice(0, opts.remaining).map((asset) => ({
      uri: asset.uri,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
      mediaType: asset.type === "video" ? "video" : "image",
    }));

  const shoot = async () => {
    if (!gate()) return;
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        notify("Нет доступа к камере", "Разрешите камеру: Настройки → Babun → Камера.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images", "videos"],
        quality: 0.75,
        videoMaxDuration: 60,
      });
      if (!result.canceled && result.assets.length > 0) opts.onMedia(toMedia(result.assets));
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
        selectionLimit: opts.remaining,
        quality: 0.75,
        // HEIC с живого iPhone бакет не примет — просим переносимый формат.
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (!result.canceled && result.assets.length > 0) opts.onMedia(toMedia(result.assets));
    } catch (error) {
      notify("Не удалось открыть галерею", error instanceof Error ? error.message : "Попробуйте ещё раз.");
    }
  };

  const pickDocument = async () => {
    if (opts.busy) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "text/plain", "image/jpeg", "image/png"],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (res.canceled || res.assets.length === 0) return;
      opts.onDocs(
        res.assets.slice(0, 5).map((asset) => ({
          uri: asset.uri,
          fileName: asset.name,
          mimeType: asset.mimeType ?? undefined,
          fileSize: asset.size,
        })),
      );
    } catch (error) {
      notify("Не удалось выбрать файл", error instanceof Error ? error.message : "Попробуйте ещё раз.");
    }
  };

  /** Скан: VisionKit → страницы → один PDF → документ. */
  const scanDocument = async () => {
    if (opts.busy) return;
    try {
      const pages = await scanDocumentPages();
      if (!pages) return;
      const pdf = await pagesToPdf(pages);
      opts.onDocs([{ uri: pdf.uri, fileName: pdf.fileName, mimeType: "application/pdf" }]);
    } catch (error) {
      notify("Не удалось отсканировать", error instanceof Error ? error.message : "Попробуйте ещё раз.");
    }
  };

  return { shoot, pick, pickDocument, scanDocument };
}
