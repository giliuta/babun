import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useToast } from "@/components/ui/Toast";
import { notify } from "@/lib/notify";
import type { PickedFile } from "@/features/clients/card-attachments";
import { MAX_APPOINTMENT_PHOTOS, type PickedAppointmentPhoto } from "./appointment-photos";
import { pagesToPdf, scanDocumentPages } from "./document-scanner";

// ПИКЕРЫ БЛОКА «ФАЙЛЫ» — разрешения, лимиты, разбор ответа. Блок решает,
// что делать с выбранным: грузить сразу (сохранённая запись) или держать в
// очереди до создания (новая).
//
// КАМЕРА СНИМАЕТ ТОЛЬКО ФОТО (выпуск в App Store, 06.10). Видео с камеры
// пишет звук, а микрофон в сборке выключен (`microphonePermission: false` в
// app.json): на живом iPhone expo-image-picker на такой вызов бросает
// MissingMicrophonePermissionException, и камера не открывалась вовсе. Видео
// по-прежнему можно приложить из галереи.
//
// ГАЛЕРЕЯ БЕЗ РАЗРЕШЕНИЯ: системный выбор фото (PHPicker на iOS, Photo
// Picker на Android) отдаёт только выбранное и доступа к медиатеке не
// требует — запрос доступа перед ним лишь пугал лишним окном.
//
// Текст системной ошибки человеку не показываем — только короткое «Попробуйте
// ещё раз.»: сырое сообщение модуля английское и ничего ему не объясняет.

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
        mediaTypes: ["images"],
        quality: 0.75,
      });
      if (!result.canceled && result.assets.length > 0) opts.onMedia(toMedia(result.assets));
    } catch {
      notify("Не удалось открыть камеру", "Попробуйте ещё раз.");
    }
  };

  const pick = async () => {
    if (!gate()) return;
    try {
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
    } catch {
      notify("Не удалось открыть галерею", "Попробуйте ещё раз.");
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
    } catch {
      notify("Не удалось выбрать файл", "Попробуйте ещё раз.");
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
    } catch {
      notify("Не удалось отсканировать", "Попробуйте ещё раз.");
    }
  };

  return { shoot, pick, pickDocument, scanDocument };
}
