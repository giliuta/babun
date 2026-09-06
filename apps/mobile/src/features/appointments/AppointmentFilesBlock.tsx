import { useMemo, useState } from "react";
import { Image, Linking, Pressable, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Camera, FileText, Images } from "lucide-react-native";
import type {
  AppointmentPhotoRecord,
  PhotoKind,
} from "@babun/shared/db/repositories/appointment-photos";
import { SectionCard } from "@/components/ui/SectionCard";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { chooseOption } from "@/lib/choose";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import {
  formatBytes,
  getSignedUrl,
  useClientAttachments,
  useDeleteAttachment,
  useUploadAttachments,
  type ClientAttachment,
} from "@/features/clients/card-attachments";
import { AppointmentPhotoViewer } from "./AppointmentPhotoViewer";
import { docTitle, filesCaption, photoTag } from "./appointment-files";
import {
  MAX_APPOINTMENT_PHOTOS,
  RetryableAppointmentPhotoUploadError,
  useAppointmentPhotos,
  useDeleteAppointmentPhoto,
  useUpdateAppointmentPhotoKind,
  useUploadAppointmentPhotos,
  type UploadAppointmentPhotosInput,
} from "./appointment-photos";
import { ModeIconButton, TILE_GAP, useTileWidth } from "./PaymentTiles";

// БЛОК «ФАЙЛЫ» ЗАПИСИ (STORY-070). Владелец 2026-09-06: «чтобы я мог добавлять
// фотографию, команда могла присылать фотографии или документы… фото-видео
// фиксация плюс загрузка документов». Строка состояния с иконками справа —
// тот же язык, что у «Оплаты»; ниже плитки 3 в ряд: фото записи и документы
// (они лежат во вложениях КЛИЕНТА с меткой этой записи — владелец 2026-08-03:
// «все чеки, все инвойсы — всё в одном месте»).
//
// Камера снимает и грузит СРАЗУ: выбор «до/после» заранее — лишний шаг.
// Размечают потом удержанием плитки; там же «Удалить». Сканер документов и
// видео — этап 2 истории (нативный модуль и миграция бакета).

const EMPTY_PHOTOS: AppointmentPhotoRecord[] = [];
const KIND_LABEL: Record<PhotoKind, string> = {
  before: "До работы",
  after: "После работы",
  other: "Просто фото",
};

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
  const relabel = useUpdateAppointmentPhotoKind(appointmentId);
  const attachments = useClientAttachments(clientId ?? "");
  const uploadDoc = useUploadAttachments(clientId ?? "", appointmentId);
  const removeDoc = useDeleteAttachment(clientId ?? "");
  const [viewer, setViewer] = useState<AppointmentPhotoRecord | null>(null);

  const photos = photosQuery.data ?? EMPTY_PHOTOS;
  const docs = useMemo(
    () => (attachments.data?.items ?? []).filter((a) => a.appointment_id === appointmentId),
    [attachments.data, appointmentId],
  );
  const remaining = Math.max(0, MAX_APPOINTMENT_PHOTOS - photos.length);
  const busy = upload.isPending || uploadDoc.isPending;
  const caption = filesCaption(photos.length, docs.length);

  const submit = (input: UploadAppointmentPhotosInput) => {
    upload.reset();
    upload.mutate(input, {
      onSuccess: (items) => {
        haptics.success();
        toast(items.length === 1 ? "Фото добавлено" : `Добавлено фото: ${items.length}`, "success");
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
      })),
      kind: "other",
      locationId,
    });
  };

  /** Общие ворота съёмки и галереи: право, лимит, занятость. */
  const gate = (): boolean => {
    if (!canUpload) {
      toast("Файлы к отменённой записи не добавляют", "info");
      return false;
    }
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
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.75 });
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
        mediaTypes: ["images"],
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
    if (!canUpload) {
      toast("Файлы к отменённой записи не добавляют", "info");
      return;
    }
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
            toast(count === 1 ? "Документ приложен" : `Приложено документов: ${count}`, "success");
          },
        },
      );
    } catch (error) {
      notify("Не удалось выбрать файл", error instanceof Error ? error.message : "Попробуйте ещё раз.");
    }
  };

  /** Удержание фото: разметка «до/после» и удаление — одним листом. */
  const holdPhoto = async (photo: AppointmentPhotoRecord) => {
    haptics.tap();
    const kinds: PhotoKind[] = (["before", "after", "other"] as PhotoKind[]).filter((k) => k !== photo.kind);
    const index = await chooseOption(KIND_LABEL[photo.kind], [
      ...kinds.map((k) => ({ label: KIND_LABEL[k] })),
      { label: "Удалить", destructive: true },
    ]);
    if (index == null) return;
    const kind = kinds[index];
    if (kind) {
      relabel.mutate({ id: photo.id, kind });
      return;
    }
    remove.mutate(photo, {
      onSuccess: () => toast("Фото удалено", "info"),
      onError: (error) => toast(error instanceof Error ? error.message : "Не удалось удалить фото", "error"),
    });
  };

  const openDoc = async (doc: ClientAttachment) => {
    try {
      await Linking.openURL(await getSignedUrl(doc));
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

  const tile = {
    width: tileWidth,
    height: tileWidth,
    borderRadius: t.radius.card,
    borderCurve: "continuous" as const,
    overflow: "hidden" as const,
    backgroundColor: t.fill,
  };

  return (
    <>
      <SectionCard title="Файлы">
        <View className="flex-row items-center" style={{ paddingHorizontal: 16, minHeight: 40, gap: 10 }}>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            style={{ flex: 1, fontSize: 15, fontWeight: "500", color: caption.empty ? t.faint : t.sub }}
          >
            {caption.text}
          </Text>
          <View className="flex-row items-center" style={{ gap: 2 }}>
            <ModeIconButton icon={Camera} label="Снять фото" onPress={() => void shoot()} />
            <ModeIconButton icon={Images} label="Из галереи" onPress={() => void pick()} />
            {clientId ? (
              <ModeIconButton icon={FileText} label="Документ" onPress={() => void pickDocument()} />
            ) : null}
          </View>
        </View>

        {photos.length > 0 || docs.length > 0 || busy ? (
          <View
            className="flex-row flex-wrap"
            style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12, gap: TILE_GAP }}
          >
            {photos.map((photo) => {
              const tag = photoTag(photo.kind);
              const deleting = remove.isPending && remove.variables?.id === photo.id;
              return (
                <Pressable
                  key={photo.id}
                  onPress={() => setViewer(photo)}
                  onLongPress={() => void holdPhoto(photo)}
                  disabled={deleting}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`Фото: ${KIND_LABEL[photo.kind]}`}
                  accessibilityHint="Удерживайте, чтобы разметить или удалить"
                  style={({ pressed }) => [tile, { opacity: pressed || deleting ? 0.6 : 1 }]}
                >
                  <Image source={{ uri: photo.url }} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
                  {tag ? (
                    <View
                      pointerEvents="none"
                      style={{
                        position: "absolute",
                        left: 6,
                        bottom: 6,
                        paddingHorizontal: 7,
                        paddingVertical: 2,
                        borderRadius: t.radius.pill,
                        backgroundColor: `${t.ink}99`,
                      }}
                    >
                      <Text style={{ fontSize: 11, fontWeight: "700", color: "#ffffff" }}>{tag}</Text>
                    </View>
                  ) : null}
                  {deleting ? (
                    <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
                      <Spinner size={20} label="Удаляем фото" />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
            {docs.map((doc) => (
              <Pressable
                key={doc.id}
                onPress={() => void openDoc(doc)}
                onLongPress={() => void holdDoc(doc)}
                accessibilityRole="button"
                accessibilityLabel={`Документ ${doc.filename}`}
                accessibilityHint="Удерживайте, чтобы удалить"
                style={({ pressed }) => [tile, { opacity: pressed ? 0.6 : 1, padding: 10, justifyContent: "space-between" }]}
              >
                <FileText color={t.accent} size={22} strokeWidth={2} />
                <View>
                  <Text numberOfLines={2} maxFontSizeMultiplier={1.2} style={{ fontSize: 12, fontWeight: "600", color: t.ink }}>
                    {docTitle(doc.filename)}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: 11, color: t.sub, marginTop: 2 }}>
                    {formatBytes(doc.size_bytes)}
                  </Text>
                </View>
              </Pressable>
            ))}
            {busy ? (
              <View style={[tile, { alignItems: "center", justifyContent: "center" }]}>
                <Spinner size={22} label="Загрузка" />
              </View>
            ) : null}
          </View>
        ) : (
          <View style={{ height: 8 }} />
        )}
      </SectionCard>

      <AppointmentPhotoViewer
        photo={viewer}
        onClose={() => setViewer(null)}
        onRetry={async () => (await photosQuery.refetch()).isSuccess}
      />
    </>
  );
}
