import { useMemo, useState } from "react";
import { Image, Linking, Pressable, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Camera, FileText, Images, Trash2 } from "lucide-react-native";
import type { AppointmentPhotoRecord } from "@babun/shared/db/repositories/appointment-photos";
import { PickerSheet, type PickerSheetItem } from "@/components/ui/PickerSheet";
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
import { docTitle } from "./appointment-files";
import {
  MAX_APPOINTMENT_PHOTOS,
  RetryableAppointmentPhotoUploadError,
  useAppointmentPhotos,
  useDeleteAppointmentPhoto,
  useUploadAppointmentPhotos,
  type UploadAppointmentPhotosInput,
} from "./appointment-photos";
import { TILE_GAP, useTileWidth } from "./PaymentTiles";

// БЛОК «ФАЙЛЫ» ЗАПИСИ (STORY-070). Владелец 2026-09-06: «маленькая шапка
// „Файлы“, справа плюсик; нажимаю — вылазит лист: сделать фотографию, выбрать
// из галереи, добавить файл, отсканировать документ; выбрал — оно добавляется
// вниз, и всё». Ниже плитки 3 в ряд: фото записи и документы (они лежат во
// вложениях КЛИЕНТА с меткой этой записи — владелец 2026-08-03: «все чеки, все
// инвойсы — всё в одном месте»). Строки состояния и счётчиков нет: плитки
// говорят сами. Удаление — корзинка в углу плитки (владелец: «сейчас я не
// знаю, как удалить фотографию из файлов»); удержание плитки — тот же лист,
// быстрый путь для тех, кто знает.
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

  /** Удержание фото — только удаление, лист и есть подтверждение. */
  const holdPhoto = async (photo: AppointmentPhotoRecord) => {
    haptics.tap();
    const index = await chooseOption("Фото", [{ label: "Удалить", destructive: true }]);
    if (index !== 0) return;
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

  // Сканер документов встанет сюда четвёртым пунктом вместе с нативным
  // модулем (этап 2): мёртвых пунктов в листе не держим.
  const menu: PickerSheetItem[] = [
    { id: "camera", label: "Сделать фото", icon: Camera, color: t.accent, onPress: () => void shoot() },
    { id: "library", label: "Выбрать из галереи", icon: Images, color: t.accent, onPress: () => void pick() },
    ...(clientId
      ? [{ id: "file", label: "Добавить файл", icon: FileText, color: t.accent, onPress: () => void pickDocument() }]
      : []),
  ];

  /** Корзинка в углу плитки: та же, что у старого блока, только меньше. */
  const trash = (label: string, onPress: () => void, disabled: boolean) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        position: "absolute",
        top: 4,
        right: 4,
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `${t.ink}8c`,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Trash2 color="#ffffff" size={12} strokeWidth={2.4} />
    </Pressable>
  );

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
      <SectionCard
        title="Файлы"
        action={
          canUpload
            ? { label: "Добавить файл", icon: "add", onPress: () => { haptics.tap(); setMenuOpen(true); } }
            : undefined
        }
      >
        {photos.length > 0 || docs.length > 0 || busy ? (
          <View
            className="flex-row flex-wrap"
            style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12, gap: TILE_GAP }}
          >
            {photos.map((photo) => {
              const deleting = remove.isPending && remove.variables?.id === photo.id;
              return (
                <Pressable
                  key={photo.id}
                  onPress={() => setViewer(photo)}
                  onLongPress={() => void holdPhoto(photo)}
                  disabled={deleting}
                  accessibilityRole="imagebutton"
                  accessibilityLabel="Фото записи"
                  style={({ pressed }) => [tile, { opacity: pressed || deleting ? 0.6 : 1 }]}
                >
                  <Image source={{ uri: photo.url }} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
                  {trash("Удалить фото", () => void holdPhoto(photo), deleting)}
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
                style={({ pressed }) => [tile, { opacity: pressed ? 0.6 : 1, padding: 10, justifyContent: "space-between" }]}
              >
                <FileText color={t.accent} size={22} strokeWidth={2} />
                {trash(`Удалить документ ${doc.filename}`, () => void holdDoc(doc), removeDoc.isPending)}
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
          <View style={{ height: 10 }} />
        )}
      </SectionCard>

      <PickerSheet
        visible={menuOpen}
        title="Добавить файл"
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
