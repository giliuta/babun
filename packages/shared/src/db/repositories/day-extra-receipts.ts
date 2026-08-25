// Receipt photo uploader for the day-finance modal.
//
// Receipts live in the private `receipts` storage bucket at
// `<tenant_id>/<extra_id>/<file>`. We persist the storage path on
// `day_extras.receipt_url` and resolve a short-lived signed URL on
// demand for display — the bucket is private so a public URL won't work.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

const BUCKET = "receipts";
const SIGNED_TTL_SECONDS = 60 * 60; // 1 hour

type DbSupabase = SupabaseClient<Database>;

export interface UploadReceiptArgs {
  tenantId: string;
  extraId: string;
  file: Blob;
  contentType?: string;
  fileName?: string;
}

function pickExt(contentType?: string, fileName?: string): string {
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("webp")) return "webp";
  if (contentType?.includes("heic")) return "heic";
  if (fileName) {
    const m = /\.([a-z0-9]+)$/i.exec(fileName);
    if (m) return m[1].toLowerCase();
  }
  return "jpg";
}

/** Upload a receipt blob. Returns the storage path that should be
 *  written to `day_extras.receipt_url`. */
export async function uploadReceipt(
  supabase: DbSupabase,
  args: UploadReceiptArgs,
): Promise<string> {
  const ext = pickExt(
    args.contentType ?? (args.file as File).type ?? undefined,
    args.fileName ?? (args.file as File).name,
  );
  const path = `${args.tenantId}/${args.extraId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, args.file, {
    contentType: args.contentType ?? (args.file as File).type ?? undefined,
    cacheControl: "31536000, immutable",
    upsert: false,
  });
  if (error) throw new Error(`uploadReceipt: ${error.message}`);
  return path;
}

/** Resolve a short-lived signed URL for a stored receipt path. */
export async function getReceiptSignedUrl(
  supabase: DbSupabase,
  path: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_TTL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Best-effort delete; ignores not-found (the row may have been written
 *  without a receipt or already cleaned by another path). */
export async function deleteReceipt(
  supabase: DbSupabase,
  path: string,
): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path]);
}
