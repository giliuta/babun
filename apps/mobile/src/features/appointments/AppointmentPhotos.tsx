import { useEffect, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  Text,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import {
  Camera,
  FileText,
  ImageOff,
  Images,
  Trash2,
} from "lucide-react-native";
import type {
  AppointmentPhotoRecord,
  PhotoKind,
} from "@babun/shared/db/repositories/appointment-photos";
import { Chip } from "@/components/ui/Chip";
import { SectionCard } from "@/components/ui/SectionCard";
import { ICON } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { AppointmentPhotoAction } from "@/features/appointments/AppointmentPhotoAction";
import { AppointmentPhotoViewer } from "@/features/appointments/AppointmentPhotoViewer";
import {
  MAX_APPOINTMENT_PHOTOS,
  RetryableAppointmentPhotoUploadError,
  useAppointmentPhotos,
  useDeleteAppointmentPhoto,
  useUploadAppointmentPhotos,
  type UploadAppointmentPhotosInput,
} from "@/features/appointments/appointment-photos";
import { useUploadAttachments } from "@/features/clients/card-attachments";
import { useThemeColors } from "@/theme/colors";
import { Spinner } from "@/components/ui/Spinner";

const KIND_OPTIONS: readonly { value: PhotoKind; label: string }[] = [
  { value: "before", label: "До работы" },
  { value: "after", label: "После работы" },
  { value: "other", label: "Другое" },
];

const KIND_SHORT: Record<PhotoKind, string> = {
  before: "До",
  after: "После",
  other: "Фото",
};

const EMPTY_PHOTOS: AppointmentPhotoRecord[] = [];

interface AppointmentPhotosProps {
  appointmentId: string;
  /** Владелец документов (чек, акт). Без него кнопка «Документ» не рисуется:
   *  файл кладётся в вложения КЛИЕНТА и помнит эту запись. */
  clientId?: string | null;
  locationId?: string | null;
  consentGiven?: boolean;
  canUpload?: boolean;
  canDelete?: boolean;
}

export function AppointmentPhotos({
  appointmentId,
  clientId,
  locationId,
  consentGiven = true,
  canUpload = true,
  canDelete = true,
}: AppointmentPhotosProps) {
  const t = useThemeColors();
  const toast = useToast();
  const photosQuery = useAppointmentPhotos(appointmentId);
  const upload = useUploadAppointmentPhotos(appointmentId);
  const remove = useDeleteAppointmentPhoto(appointmentId);
  const [kind, setKind] = useState<PhotoKind>("before");
  const [viewer, setViewer] = useState<AppointmentPhotoRecord | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());

  const photos = photosQuery.data ?? EMPTY_PHOTOS;
  const remaining = Math.max(0, MAX_APPOINTMENT_PHOTOS - photos.length);
  const uploadEnabled = canUpload && consentGiven && remaining > 0 && !upload.isPending;

  useEffect(() => {
    if (!viewer) return;
    const current = photos.find((photo) => photo.id === viewer.id);
    if (!current) {
      setViewer(null);
    } else if (current.url !== viewer.url) {
      setViewer(current);
    }
  }, [photos, viewer]);

  useEffect(() => {
    setBroken(new Set());
  }, [photosQuery.dataUpdatedAt]);

  const submitUpload = (input: UploadAppointmentPhotosInput) => {
    upload.reset();
    upload.mutate(input, {
      onSuccess: (items) =>
        toast(
          items.length === 1 ? "Фото добавлено" : `Добавлено фото: ${items.length}`,
          "success",
        ),
    });
  };

  const uploadAssets = (assets: ImagePicker.ImagePickerAsset[]) => {
    if (!uploadEnabled || assets.length === 0) return;
    submitUpload({
      assets: assets.slice(0, remaining).map((asset) => ({
        uri: asset.uri,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
      })),
      kind,
      locationId,
    });
  };

  const pick = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Нет доступа к фото",
          "Разрешите доступ: Настройки → Babun → Фото.",
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 0.75,
        // Ask Photos for a portable representation. Leaving the SDK default
        // can return HEIC from a real iPhone, while the private bucket and the
        // cross-platform viewer intentionally accept JPEG/PNG/WebP only.
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (!result.canceled) uploadAssets(result.assets);
    } catch (error) {
      Alert.alert(
        "Не удалось открыть галерею",
        error instanceof Error ? error.message : "Попробуйте ещё раз.",
      );
    }
  };

  const shoot = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Нет доступа к камере",
          "Разрешите камеру: Настройки → Babun → Камера.",
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.75,
      });
      if (!result.canceled) uploadAssets(result.assets);
    } catch (error) {
      Alert.alert(
        "Не удалось открыть камеру",
        error instanceof Error ? error.message : "Попробуйте ещё раз.",
      );
    }
  };

  const confirmDelete = (photo: AppointmentPhotoRecord) => {
    Alert.alert("Удалить фото?", "Оно исчезнет из заявки без возможности восстановления.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: () =>
          remove.mutate(photo, {
            onSuccess: () => toast("Фото удалено", "success"),
          }),
      },
    ]);
  };

  const mutationError = upload.error ?? remove.error;
  // Документ визита: тот же upload, что на карточке клиента, но с
  // appointment_id — на странице вложений он подпишется «из записи 30 мая».
  const uploadDoc = useUploadAttachments(clientId ?? "", appointmentId);
  const pickDocument = async () => {
    if (!clientId) return;
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
        { onSuccess: () => toast("Файл приложен к записи", "success") },
      );
    } catch (error) {
      Alert.alert(
        "Не удалось выбрать файл",
        error instanceof Error ? error.message : "Попробуйте ещё раз.",
      );
    }
  };

  const retryInput =
    upload.error instanceof RetryableAppointmentPhotoUploadError
      ? upload.error.retryInput
      : null;

  return (
    <>
      <SectionCard title={`Файлы заявки · ${photos.length}/${MAX_APPOINTMENT_PHOTOS}`}>
        {canUpload ? (
          <View className="px-4 py-3">
            {!consentGiven ? (
              <Text className="text-sm" style={{ color: t.danger }}>
                Клиент не дал согласие на фотосъёмку.
              </Text>
            ) : remaining === 0 ? (
              <Text className="text-sm" style={{ color: t.sub }}>
                Добавлено максимальное количество фото.
              </Text>
            ) : (
              <>
                <Text className="mb-2 text-xs" style={{ color: t.sub }}>
                  Тип новых фото
                </Text>
                <View className="mb-3 flex-row flex-wrap gap-2">
                  {KIND_OPTIONS.map((option) => (
                    <Chip
                      key={option.value}
                      label={option.label}
                      radio
                      selected={kind === option.value}
                      onPress={() => setKind(option.value)}
                    />
                  ))}
                </View>
                <View className="flex-row gap-2">
                  <AppointmentPhotoAction
                    label="Снять фото"
                    icon={<Camera color={uploadEnabled ? t.accent : t.faint} size={ICON.sm} />}
                    onPress={() => void shoot()}
                    disabled={!uploadEnabled}
                  />
                  <AppointmentPhotoAction
                    label="Из галереи"
                    icon={<Images color={uploadEnabled ? t.accent : t.faint} size={ICON.sm} />}
                    onPress={() => void pick()}
                    disabled={!uploadEnabled}
                  />
                </View>
                {/* ЧЕК / АКТ / СЧЁТ — не фото и не в лимите 5: документ едет
                    в вложения КЛИЕНТА с пометкой этой записи (миграция
                    20260804090000). Владелец 2026-08-03: «все чеки, все
                    инвойсы — всё в одном месте». */}
                {clientId ? (
                  <View className="mt-2 flex-row gap-2">
                    <AppointmentPhotoAction
                      label={
                        uploadDoc.isPending ? "Загрузка…" : "Чек, акт, счёт"
                      }
                      icon={
                        <FileText
                          color={uploadDoc.isPending ? t.faint : t.accent}
                          size={ICON.sm}
                        />
                      }
                      onPress={() => void pickDocument()}
                      disabled={uploadDoc.isPending}
                    />
                  </View>
                ) : null}
              </>
            )}
          </View>
        ) : null}

        {upload.isPending ? (
          <View
            className="flex-row items-center gap-2 px-4 py-3"
            style={{ borderTopWidth: 1, borderTopColor: t.separator }}
          >
            <Spinner size={18} label="Загрузка фото" />
            <Text className="text-sm" style={{ color: t.sub }}>
              Загружаем фото…
            </Text>
          </View>
        ) : null}

        {mutationError ? (
          <View
            className="px-4 py-3"
            style={{ borderTopWidth: 1, borderTopColor: t.separator }}
            accessibilityRole="alert"
          >
            <Text className="text-sm" style={{ color: t.danger }}>
              {(mutationError as Error).message || "Не удалось изменить фото."}
            </Text>
            {retryInput ? (
              <Pressable
                onPress={() => submitUpload(retryInput)}
                accessibilityRole="button"
                accessibilityLabel="Повторить загрузку фото"
                className="mt-2 min-h-11 self-start justify-center pr-4 active:opacity-60"
              >
                <Text className="text-sm font-semibold" style={{ color: t.accent }}>
                  Повторить загрузку
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View
          className="px-4 py-3"
          style={{ borderTopWidth: canUpload ? 1 : 0, borderTopColor: t.separator }}
        >
          {photosQuery.isLoading ? (
            <View className="items-center py-4">
              <Spinner size={24} label="Загрузка фотографий заявки" />
            </View>
          ) : photosQuery.isError ? (
            <View className="items-center py-2">
              <Text className="text-center text-sm" style={{ color: t.danger }}>
                Не удалось загрузить фотографии.
              </Text>
              <Pressable
                onPress={() => void photosQuery.refetch()}
                accessibilityRole="button"
                accessibilityLabel="Повторить загрузку фотографий"
                className="mt-2 min-h-11 justify-center px-4 active:opacity-60"
              >
                <Text className="text-sm font-semibold" style={{ color: t.accent }}>
                  Повторить
                </Text>
              </Pressable>
            </View>
          ) : photos.length === 0 ? (
            <Text className="py-2 text-sm" style={{ color: t.faint }}>
              Фото пока нет
            </Text>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {photos.map((photo) => {
                const deleting = remove.isPending && remove.variables?.id === photo.id;
                return (
                  <View
                    key={photo.id}
                    className="relative aspect-square w-[31%] overflow-hidden rounded-[10px]"
                    style={{ backgroundColor: t.fill }}
                  >
                    <Pressable
                      onPress={() => {
                        if (broken.has(photo.id)) {
                          setBroken((current) => {
                            const next = new Set(current);
                            next.delete(photo.id);
                            return next;
                          });
                          void photosQuery.refetch();
                          return;
                        }
                        setViewer(photo);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={
                        broken.has(photo.id)
                          ? "Повторить загрузку фото"
                          : `Открыть фото: ${KIND_SHORT[photo.kind]}`
                      }
                      className="h-full w-full active:opacity-80"
                    >
                      {broken.has(photo.id) ? (
                        <View className="h-full items-center justify-center">
                          <ImageOff color={t.faint} size={24} />
                        </View>
                      ) : (
                        <Image
                          source={{ uri: photo.url }}
                          resizeMode="cover"
                          onError={() =>
                            setBroken((current) => new Set(current).add(photo.id))
                          }
                          style={{ width: "100%", height: "100%" }}
                        />
                      )}
                      <View
                        pointerEvents="none"
                        className="absolute inset-x-0 bottom-0 px-2 py-1"
                        style={{ backgroundColor: `${t.ink}7A` }}
                      >
                        <Text
                          className="text-[11px] font-semibold"
                          style={{ color: t.onAccent }}
                        >
                          {KIND_SHORT[photo.kind]}
                        </Text>
                      </View>
                    </Pressable>
                    {canDelete ? (
                      <Pressable
                        onPress={() => confirmDelete(photo)}
                        disabled={remove.isPending}
                        accessibilityRole="button"
                        accessibilityLabel={`Удалить фото: ${KIND_SHORT[photo.kind]}`}
                        accessibilityState={{ disabled: remove.isPending, busy: deleting }}
                        className="absolute right-1 top-1 h-11 w-11 items-center justify-center rounded-full active:opacity-70"
                        style={{ backgroundColor: `${t.ink}94` }}
                      >
                        {deleting ? (
                          <Spinner size={20} color={t.onAccent} label="Удаляем фото" />
                        ) : (
                          <Trash2 color={t.onAccent} size={14} strokeWidth={2.2} />
                        )}
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </SectionCard>

      <AppointmentPhotoViewer
        photo={viewer}
        onClose={() => setViewer(null)}
        onRetry={async () => (await photosQuery.refetch()).isSuccess}
      />
    </>
  );
}
