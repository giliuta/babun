import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUuid } from "@babun/shared/sync";

import type { ClientAttachment, PickedFile } from "@/features/clients/card-attachments";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

// ФАЙЛЫ ПАРТНЁРА (владелец 04.10, мозговой штурм страницы партнёра): договор,
// копия документа, сертификаты. Тот же уклад, что у файлов клиента
// (`card-attachments.ts`): строка `partner_files` + объект в закрытом бакете
// `partner-files` по пути `{tenant}/{master}/{id}.{ext}`; сначала строка,
// потом байты, сбой загрузки откатывает строку. Держит право «Партнёры»
// (сервер, 20261004193517).

const BUCKET = "partner-files";
const MAX_BYTES = 10 * 1024 * 1024;
const SIGNED_URL_TTL = 5 * 60;
const COLUMNS = "id, master_id, storage_path, filename, mime_type, size_bytes, created_at";

export interface PartnerFile {
  id: string;
  master_id: string;
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export class PartnerFileError extends Error {}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
};
const ALLOWED = new Set(Object.values(MIME_BY_EXT));

const extOf = (name: string) => name.match(/\.([a-z0-9]{1,6})$/i)?.[1]?.toLowerCase() ?? "";

/** Тип файла — из того, что сказал выбор файла, иначе по расширению. */
export function partnerFileMime(reported: string | undefined, name: string): string {
  const mime = reported?.toLowerCase();
  if (mime && ALLOWED.has(mime)) return mime;
  const byExt = MIME_BY_EXT[extOf(name)];
  if (byExt) return byExt;
  throw new PartnerFileError("Поддерживаются фото (JPEG, PNG, WebP), PDF и текст.");
}

const extFor = (mime: string) =>
  Object.entries(MIME_BY_EXT).find(([ext, m]) => m === mime && ext !== "jpeg")?.[0] ?? "bin";

/** Плашка файла — та же, что у файлов клиента (`ClientFileRow`). */
export function asAttachment(file: PartnerFile): ClientAttachment {
  return { ...file, client_id: file.master_id, appointment_id: null };
}

const filesKey = (tenantId: string | null, masterId: string) => ["partner-files", tenantId, masterId] as const;

async function signedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) throw new PartnerFileError(error?.message ?? "Не удалось открыть файл");
  return data.signedUrl;
}

export function partnerFileUrl(file: PartnerFile): Promise<string> {
  return signedUrl(file.storage_path);
}

export function usePartnerFiles(masterId: string | null | undefined) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: filesKey(tenantId, masterId ?? ""),
    enabled: !!tenantId && !!masterId,
    // Подписанные ссылки снимков живут 5 минут.
    staleTime: 4 * 60 * 1000,
    queryFn: async (): Promise<{ items: PartnerFile[]; thumbs: Record<string, string> }> => {
      const { data, error } = await supabase
        .from("partner_files")
        .select(COLUMNS)
        .eq("tenant_id", tenantId as string)
        .eq("master_id", masterId as string)
        .order("created_at", { ascending: false });
      if (error) throw new PartnerFileError(error.message);
      const items = (data ?? []) as PartnerFile[];
      const thumbs: Record<string, string> = {};
      await Promise.all(
        items
          .filter((file) => file.mime_type.startsWith("image/"))
          .map(async (file) => {
            try {
              thumbs[file.id] = await signedUrl(file.storage_path);
            } catch {
              // Без снимка плашка остаётся значком — файл всё равно открывается.
            }
          }),
      );
      return { items, thumbs };
    },
  });
}

async function uploadOne(tenantId: string, masterId: string, file: PickedFile): Promise<void> {
  const resp = await fetch(file.uri);
  const bytes = await resp.arrayBuffer();
  const size = bytes.byteLength;
  if (size === 0) throw new PartnerFileError("Выбранный файл пуст или недоступен");
  if ((file.fileSize ?? 0) > MAX_BYTES || size > MAX_BYTES) {
    throw new PartnerFileError("Файл слишком большой (макс. 10 МБ)");
  }
  const mime = partnerFileMime(file.mimeType, file.fileName || "");
  const id = randomUuid();
  const name = file.fileName || `photo.${extFor(mime)}`;
  const path = `${tenantId}/${masterId}/${id}.${extFor(mime)}`;
  const { error: insertError } = await supabase.from("partner_files").insert({
    id,
    tenant_id: tenantId,
    master_id: masterId,
    storage_path: path,
    filename: name,
    mime_type: mime,
    size_bytes: size,
  });
  if (insertError) throw new PartnerFileError(insertError.message);
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { upsert: false, contentType: mime, cacheControl: "3600" });
  if (uploadError) {
    // Строка без байтов — плашка, которая никогда не откроется: убираем.
    await supabase.from("partner_files").delete().eq("id", id).eq("tenant_id", tenantId);
    throw new PartnerFileError(uploadError.message);
  }
}

export function useUploadPartnerFiles(masterId: string | null | undefined) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    meta: { errorHandled: true },
    mutationFn: async (files: PickedFile[]): Promise<number> => {
      if (!tenantId || !masterId) throw new PartnerFileError("Партнёр не найден");
      for (const file of files) await uploadOne(tenantId, masterId, file);
      return files.length;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: filesKey(tenantId, masterId ?? "") }),
  });
}

export function useDeletePartnerFile(masterId: string | null | undefined) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    meta: { errorHandled: true },
    mutationFn: async (file: PartnerFile): Promise<void> => {
      // Стирается путь из удалённой строки, а не присланный телефоном.
      const { data, error } = await supabase
        .from("partner_files")
        .delete()
        .eq("id", file.id)
        .eq("tenant_id", tenantId as string)
        .select("storage_path")
        .maybeSingle();
      if (error || !data) throw new PartnerFileError(error?.message ?? "Файл не найден");
      await supabase.storage.from(BUCKET).remove([data.storage_path]);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: filesKey(tenantId, masterId ?? "") }),
  });
}
