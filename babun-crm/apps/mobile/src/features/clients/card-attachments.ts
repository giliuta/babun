// card-attachments — client photo/file attachments for the mobile card
// (RN port of apps/web/src/lib/clients/attachments.ts, clients-99 F3.10).
//
// Bucket: client-attachments (private).
// Path:   {tenant_id}/{client_id}/{attachment_id}.{ext}
// Reads:  short-lived signed URLs (5 min) minted with the list query so
//         image thumbnails render straight from the cache entry.
// Writes: insert metadata row + upload bytes in two steps; if the second
//         fails the orphan row is rolled back (web parity). RN has no
//         `File`, so uploads take an expo-image-picker asset: we fetch the
//         local uri into an ArrayBuffer (supabase-js accepts it natively).
//
// TanStack hooks live here too (the block stays presentational-ish):
// useClientAttachments / useUploadAttachments / useDeleteAttachment with
// query invalidation; mutation errors are alerted locally
// (meta.errorHandled — same pattern as queries.ts).

import { Alert } from "react-native";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

const BUCKET = "client-attachments";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const SIGNED_URL_TTL = 5 * 60; // seconds

export interface ClientAttachment {
  id: string;
  client_id: string;
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

/** Minimal picker-asset shape we need (subset of ImagePicker asset). */
export interface PickedFile {
  uri: string;
  fileName?: string | null;
  mimeType?: string;
  fileSize?: number;
}

export class AttachmentError extends Error {}

function genAttachmentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `att_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function extFromMime(mime: string, fallback: string): string {
  if (mime.startsWith("image/")) return mime.split("/")[1].replace("jpeg", "jpg");
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/")) return "txt";
  return fallback;
}

function safeExtFromName(name: string): string {
  const m = name.match(/\.([a-z0-9]{1,6})$/i);
  return m ? m[1].toLowerCase() : "bin";
}

export function isImage(att: { mime_type: string }): boolean {
  return att.mime_type.startsWith("image/");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

// ─── Repo ──────────────────────────────────────────────────────────────

async function listAttachments(args: {
  tenantId: string;
  clientId: string;
}): Promise<ClientAttachment[]> {
  const { data, error } = await supabase
    .from("client_attachments")
    .select(
      "id, client_id, storage_path, filename, mime_type, size_bytes, created_at",
    )
    .eq("tenant_id", args.tenantId)
    .eq("client_id", args.clientId)
    .order("created_at", { ascending: false });
  if (error) throw new AttachmentError(`list: ${error.message}`);
  return (data ?? []) as ClientAttachment[];
}

async function uploadAttachment(args: {
  tenantId: string;
  clientId: string;
  file: PickedFile;
}): Promise<ClientAttachment> {
  const { tenantId, clientId, file } = args;

  // Read the local asset into bytes first — also gives us the real size
  // when the picker didn't report one.
  const resp = await fetch(file.uri);
  const bytes = await resp.arrayBuffer();
  const size = file.fileSize ?? bytes.byteLength;
  if (size > MAX_BYTES) {
    throw new AttachmentError("Файл слишком большой (макс. 10 МБ)");
  }

  const mime = file.mimeType || "application/octet-stream";
  const name = file.fileName || `photo.${extFromMime(mime, "jpg")}`;
  const id = genAttachmentId();
  const ext = extFromMime(mime, safeExtFromName(name));
  const path = `${tenantId}/${clientId}/${id}.${ext}`;

  const { data: row, error: insertErr } = await supabase
    .from("client_attachments")
    .insert({
      id,
      tenant_id: tenantId,
      client_id: clientId,
      storage_path: path,
      filename: name,
      mime_type: mime,
      size_bytes: size,
    })
    .select(
      "id, client_id, storage_path, filename, mime_type, size_bytes, created_at",
    )
    .single();
  if (insertErr) throw new AttachmentError(`insert: ${insertErr.message}`);

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, {
      upsert: false,
      contentType: mime,
      cacheControl: "3600",
    });
  if (uploadErr) {
    // Roll back the metadata row — orphan rows are worse than a missing
    // file (UI would show a thumbnail that 404s forever).
    await supabase.from("client_attachments").delete().eq("id", id);
    throw new AttachmentError(`upload: ${uploadErr.message}`);
  }

  return row as ClientAttachment;
}

async function deleteAttachment(args: {
  attachment: ClientAttachment;
  tenantId: string;
}): Promise<void> {
  const { attachment, tenantId } = args;
  // Storage first — if metadata delete fails after, we have an orphan row
  // the UI can re-cleanup. The reverse leaves a mystery file the user
  // can't see or remove.
  await supabase.storage.from(BUCKET).remove([attachment.storage_path]);
  const { error } = await supabase
    .from("client_attachments")
    .delete()
    .eq("id", attachment.id)
    .eq("tenant_id", tenantId);
  if (error) throw new AttachmentError(`delete: ${error.message}`);
}

export async function getSignedUrl(
  attachment: ClientAttachment,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(attachment.storage_path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) {
    throw new AttachmentError(`signedUrl: ${error?.message ?? "unknown"}`);
  }
  return data.signedUrl;
}

// ─── Hooks ─────────────────────────────────────────────────────────────

export interface AttachmentsData {
  items: ClientAttachment[];
  /** attachment id → 5-min signed URL, images only. */
  thumbs: Record<string, string>;
}

export function useClientAttachments(clientId: string) {
  const tenantId = useTenantId();
  return useQuery<AttachmentsData>({
    queryKey: ["client-attachments", clientId],
    enabled: !!tenantId && !!clientId,
    // Signed URLs die after 5 min — keep the cache honest.
    staleTime: 4 * 60 * 1000,
    queryFn: async () => {
      const items = await listAttachments({
        tenantId: tenantId as string,
        clientId,
      });
      const entries = await Promise.all(
        items.filter(isImage).map(async (a) => {
          try {
            return [a.id, await getSignedUrl(a)] as const;
          } catch {
            return [a.id, ""] as const;
          }
        }),
      );
      return {
        items,
        thumbs: Object.fromEntries(entries.filter(([, u]) => u)),
      };
    },
  });
}

export function useUploadAttachments(clientId: string) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (files: PickedFile[]) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      for (const file of files) {
        await uploadAttachment({ tenantId, clientId, file });
      }
      return files.length;
    },
    // onSettled (not onSuccess): a mid-batch failure still surfaces the
    // files that WERE uploaded.
    onSettled: () =>
      qc.invalidateQueries({ queryKey: ["client-attachments", clientId] }),
    onError: (e) => {
      Alert.alert(
        "Не удалось загрузить",
        (e as Error).message || "Проверьте соединение и попробуйте ещё раз.",
      );
    },
    meta: { errorHandled: true },
  });
}

export function useDeleteAttachment(clientId: string) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachment: ClientAttachment) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      return deleteAttachment({ attachment, tenantId });
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["client-attachments", clientId] }),
    onError: (e) => {
      Alert.alert(
        "Не удалось удалить",
        (e as Error).message || "Проверьте соединение и попробуйте ещё раз.",
      );
    },
    meta: { errorHandled: true },
  });
}
