import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deletePhoto,
  listPhotosForAppointment,
  uploadPhoto,
  type AppointmentPhotoRecord,
  type PhotoKind,
} from "@babun/shared/db/repositories/appointment-photos";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

// 20 файлов на запись (было 5). Владелец 2026-09-06: «фото-видео фиксация» —
// пять снимков «до/после» на объект с тремя кондиционерами не хватало; число
// уточнить с владельцем.
export const MAX_APPOINTMENT_PHOTOS = 20;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
// Видео — до 50 МБ (лимит бакета, миграция 20260906210000): короткий ролик с
// телефона; длинные пусть жмут камерой.
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const PHOTO_URL_STALE_TIME = 50 * 60 * 1000;

export interface PickedAppointmentPhoto {
  uri: string;
  fileName?: string | null;
  mimeType?: string;
  fileSize?: number;
  /** Что сказал пикер: у видео с iPhone mimeType бывает пустым. */
  mediaType?: "image" | "video";
}

export interface UploadAppointmentPhotosInput {
  assets: PickedAppointmentPhoto[];
  kind: PhotoKind;
  locationId?: string | null;
}

/** Carries only the failed asset and the not-yet-attempted tail. Retrying the
 * original batch after a partial success would duplicate already-uploaded
 * images. */
export class RetryableAppointmentPhotoUploadError extends Error {
  constructor(
    message: string,
    readonly retryInput: UploadAppointmentPhotosInput,
  ) {
    super(message);
    this.name = "RetryableAppointmentPhotoUploadError";
  }
}

function key(tenantId: string | null, appointmentId: string) {
  return ["appointment-photos", tenantId, appointmentId] as const;
}

function inferMime(asset: PickedAppointmentPhoto): string {
  const reported = asset.mimeType?.toLowerCase();
  const source = `${asset.fileName ?? ""} ${asset.uri}`.toLowerCase();
  // Видео: mp4 и quicktime (.mov с iPhone) — ровно то, что принимает бакет.
  if (reported === "video/mp4" || /\.(mp4|m4v)(\?|$)/.test(source)) return "video/mp4";
  if (reported === "video/quicktime" || /\.mov(\?|$)/.test(source)) return "video/quicktime";
  if (reported?.startsWith("video/") || (asset.mediaType === "video" && !reported)) {
    throw new Error("Формат видео не поддерживается. Нужен MP4 или MOV.");
  }
  if (reported === "image/jpeg" || reported === "image/jpg") return "image/jpeg";
  if (reported === "image/png" || reported === "image/webp") return reported;
  if (source.includes(".png")) return "image/png";
  if (source.includes(".webp")) return "image/webp";
  if (reported?.startsWith("image/")) {
    throw new Error("Формат фото не поддерживается. Выберите JPEG, PNG или WebP.");
  }
  return "image/jpeg";
}

function isVideoMime(mime: string): boolean {
  return mime.startsWith("video/");
}

function defaultName(asset: PickedAppointmentPhoto, mime: string): string {
  if (asset.fileName) return asset.fileName;
  const ext =
    mime === "video/mp4" ? "mp4"
    : mime === "video/quicktime" ? "mov"
    : mime === "image/png" ? "png"
    : mime === "image/webp" ? "webp"
    : "jpg";
  return `${isVideoMime(mime) ? "video" : "photo"}.${ext}`;
}

async function assetBytes(asset: PickedAppointmentPhoto, mime: string): Promise<ArrayBuffer> {
  const video = isVideoMime(mime);
  const limit = video ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
  const tooBig = video
    ? "Видео больше 50 МБ. Снимите короче или сожмите."
    : "Фото больше 5 МБ. Выберите изображение меньшего размера.";
  if ((asset.fileSize ?? 0) > limit) throw new Error(tooBig);
  const response = await fetch(asset.uri);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error(video ? "Не удалось прочитать видео." : "Не удалось прочитать выбранное фото.");
  if (bytes.byteLength > limit) throw new Error(tooBig);
  return bytes;
}

export function useAppointmentPhotos(appointmentId: string) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: key(tenantId, appointmentId),
    enabled: !!tenantId && !!appointmentId,
    staleTime: PHOTO_URL_STALE_TIME,
    // Refresh before the one-hour signed URLs expire while a sheet stays open.
    refetchInterval: PHOTO_URL_STALE_TIME,
    queryFn: () => listPhotosForAppointment(supabase, appointmentId),
  });
}

/** Загрузка партии — и из мутации блока, и после создания записи (файлы
 *  новой записи ждали её id, как ждала оплата). */
export async function uploadAppointmentAssets(args: {
  tenantId: string;
  appointmentId: string;
  input: UploadAppointmentPhotosInput;
}): Promise<AppointmentPhotoRecord[]> {
  const { tenantId, appointmentId } = args;
  const { assets, kind, locationId } = args.input;
  let current: AppointmentPhotoRecord[];
  try {
    current = await listPhotosForAppointment(supabase, appointmentId);
  } catch (error) {
    throw new RetryableAppointmentPhotoUploadError(
      error instanceof Error ? error.message : "Не удалось проверить фотографии.",
      { assets, kind, locationId },
    );
  }
  const remaining = MAX_APPOINTMENT_PHOTOS - current.length;
  if (remaining <= 0) throw new Error(`На записи уже ${MAX_APPOINTMENT_PHOTOS} файлов.`);
  const selected = assets.slice(0, remaining);
  const uploaded: AppointmentPhotoRecord[] = [];
  for (let index = 0; index < selected.length; index += 1) {
    const asset = selected[index];
    const mime = inferMime(asset);
    const bytes = await assetBytes(asset, mime);
    try {
      uploaded.push(await uploadPhoto(supabase, {
        tenantId,
        appointmentId,
        file: bytes,
        fileName: defaultName(asset, mime),
        contentType: mime,
        kind,
        locationId: locationId ?? null,
        takenAt: new Date().toISOString(),
      }));
    } catch (error) {
      throw new RetryableAppointmentPhotoUploadError(
        error instanceof Error ? error.message : "Не удалось загрузить фото.",
        { assets: selected.slice(index), kind, locationId },
      );
    }
  }
  return uploaded;
}

export function photosQueryKey(tenantId: string | null, appointmentId: string) {
  return key(tenantId, appointmentId);
}

export function useUploadAppointmentPhotos(appointmentId: string) {
  const tenantId = useTenantId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UploadAppointmentPhotosInput): Promise<AppointmentPhotoRecord[]> => {
      if (!tenantId) throw new Error("Нет активной организации");
      return uploadAppointmentAssets({ tenantId, appointmentId, input });
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: key(tenantId, appointmentId) }),
    meta: { errorHandled: true },
  });
}

export function useDeleteAppointmentPhoto(appointmentId: string) {
  const tenantId = useTenantId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photo: AppointmentPhotoRecord) => {
      if (!tenantId) throw new Error("Нет активной организации");
      return deletePhoto(supabase, photo);
    },
    onSuccess: (_, removed) => {
      queryClient.setQueryData<AppointmentPhotoRecord[]>(
        key(tenantId, appointmentId),
        (current) => current?.filter((photo) => photo.id !== removed.id) ?? [],
      );
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: key(tenantId, appointmentId) }),
    meta: { errorHandled: true },
  });
}
