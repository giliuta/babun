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

export const MAX_APPOINTMENT_PHOTOS = 5;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_URL_STALE_TIME = 50 * 60 * 1000;

export interface PickedAppointmentPhoto {
  uri: string;
  fileName?: string | null;
  mimeType?: string;
  fileSize?: number;
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
  if (reported === "image/jpeg" || reported === "image/jpg") return "image/jpeg";
  if (reported === "image/png" || reported === "image/webp") return reported;
  const source = `${asset.fileName ?? ""} ${asset.uri}`.toLowerCase();
  if (source.includes(".png")) return "image/png";
  if (source.includes(".webp")) return "image/webp";
  if (reported?.startsWith("image/")) {
    throw new Error("Формат фото не поддерживается. Выберите JPEG, PNG или WebP.");
  }
  return "image/jpeg";
}

function defaultName(asset: PickedAppointmentPhoto, mime: string): string {
  if (asset.fileName) return asset.fileName;
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return `photo.${ext}`;
}

async function assetBytes(asset: PickedAppointmentPhoto): Promise<ArrayBuffer> {
  if ((asset.fileSize ?? 0) > MAX_PHOTO_BYTES) {
    throw new Error("Фото больше 5 МБ. Выберите изображение меньшего размера.");
  }
  const response = await fetch(asset.uri);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error("Не удалось прочитать выбранное фото.");
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new Error("Фото больше 5 МБ. Выберите изображение меньшего размера.");
  }
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

export function useUploadAppointmentPhotos(appointmentId: string) {
  const tenantId = useTenantId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      assets,
      kind,
      locationId,
    }: UploadAppointmentPhotosInput): Promise<AppointmentPhotoRecord[]> => {
      if (!tenantId) throw new Error("Нет активной организации");
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
      if (remaining <= 0) throw new Error("На заявку уже добавлено 5 фото.");
      const selected = assets.slice(0, remaining);
      const uploaded: AppointmentPhotoRecord[] = [];
      for (let index = 0; index < selected.length; index += 1) {
        const asset = selected[index];
        const mime = inferMime(asset);
        const bytes = await assetBytes(asset);
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
