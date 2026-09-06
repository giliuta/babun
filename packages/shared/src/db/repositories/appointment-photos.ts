// Appointment photos repository — STORY-049.
//
// Bridge between the relational `public.appointment_photos` rows
// (metadata + storage_path) and the `AppointmentPhotoRecord` shape
// the UI consumes (with a signed URL pre-resolved). The bucket is private;
// URL-signing failure must remain visible instead of returning a public URL
// that looks valid but cannot load.
//
// Upload orchestration:
//   1. supabase.storage.from('appointment-photos').upload(path, blob)
//   2. supabase.from('appointment_photos').insert({...path...})
// On step 2 failure, best-effort storage.remove() to avoid orphan
// blob. On step 1 failure, nothing to clean up. Atomicity-across-the-
// two-steps is sacrificed for simplicity; the worst case (orphan
// blob) is reaped by the janitor (STORY-049a backlog).
//
// Delete orchestration (REVERSED per A3):
//   1. from('appointment_photos').delete().eq('id', ...)
//   2. supabase.storage.remove([path])
// Row goes first; if the storage call fails after, the blob orphans
// but the UI is consistent (no broken-image flash).
//
// MAX_PHOTOS=5 enforcement is server-side: the
// `appointment_photos_max_5` trigger raises 23514 on the 6th insert
// for a given appointment, with a FOR UPDATE on the parent
// appointment row to serialise concurrent inserts (decision A7).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { randomUuid } from "../../sync/uuid";

type DbSupabase = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["appointment_photos"]["Row"];

const BUCKET = "appointment-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type PhotoKind = "before" | "after" | "other";

export interface AppointmentPhotoRecord {
  id: string;
  appointment_id: string;
  tenant_id: string;
  storage_path: string;
  url: string;
  kind: PhotoKind;
  caption: string;
  location_id: string | null;
  taken_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface UploadPhotoArgs {
  tenantId: string;
  appointmentId: string;
  /** Browser sends Blob/File; React Native sends an ArrayBuffer. */
  file: Blob | ArrayBuffer;
  fileName?: string;
  contentType?: string;
  kind?: PhotoKind;
  caption?: string;
  locationId?: string | null;
  takenAt?: string | null;
}

async function rowWithUrl(
  supabase: DbSupabase,
  r: Row,
): Promise<AppointmentPhotoRecord> {
  const bucket = supabase.storage.from(BUCKET);
  const { data: signed, error } = await bucket.createSignedUrl(
    r.storage_path,
    SIGNED_URL_TTL_SECONDS,
  );
  if (error || !signed?.signedUrl) {
    throw new Error(
      `appointment photo signed URL: ${error?.message ?? "empty response"}`,
    );
  }
  return {
    id: r.id,
    appointment_id: r.appointment_id,
    tenant_id: r.tenant_id,
    storage_path: r.storage_path,
    url: signed.signedUrl,
    kind: (r.kind as PhotoKind) ?? "other",
    caption: r.caption,
    location_id: r.location_id,
    taken_at: r.taken_at,
    sort_order: r.sort_order,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** All photos for one appointment, sorted by sort_order then created_at. */
export async function listPhotosForAppointment(
  supabase: DbSupabase,
  appointmentId: string,
): Promise<AppointmentPhotoRecord[]> {
  const { data, error } = await supabase
    .from("appointment_photos")
    .select("*")
    .eq("appointment_id", appointmentId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listPhotosForAppointment: ${error.message}`);
  return Promise.all((data ?? []).map((r) => rowWithUrl(supabase, r as Row)));
}

function pickExt(contentType: string | undefined, fileName?: string): string {
  if (contentType) {
    if (contentType === "image/jpeg") return "jpg";
    if (contentType === "image/png") return "png";
    if (contentType === "image/webp") return "webp";
    // Видео (STORY-070, этап 2б): тот же бакет и та же таблица, тип виден по
    // расширению пути.
    if (contentType === "video/mp4") return "mp4";
    if (contentType === "video/quicktime") return "mov";
  }
  if (fileName) {
    const m = /\.([a-z0-9]+)$/i.exec(fileName);
    if (m) return m[1].toLowerCase();
  }
  return "jpg";
}

/** Upload bytes + insert the row. Throws on storage failure (nothing
 *  inserted) or on row failure (best-effort blob cleanup). On success
 *  the returned record has a signed URL ready for an image component. */
export async function uploadPhoto(
  supabase: DbSupabase,
  args: UploadPhotoArgs,
): Promise<AppointmentPhotoRecord> {
  const photoId = randomUuid();
  const ext = pickExt(args.contentType, args.fileName);
  const path = `${args.tenantId}/${args.appointmentId}/${photoId}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, args.file, {
      contentType: args.contentType,
      cacheControl: "31536000, immutable",
      upsert: false,
    });
  if (upErr) throw new Error(`uploadPhoto (storage): ${upErr.message}`);

  // Resolve the next sort_order in a single round-trip via a
  // count-then-insert. Race-prone but the trigger enforces the cap;
  // duplicates would just shift order, not break invariants.
  const { count, error: countError } = await supabase
    .from("appointment_photos")
    .select("*", { count: "exact", head: true })
    .eq("appointment_id", args.appointmentId);

  if (countError) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(`uploadPhoto (count): ${countError.message}`);
  }

  try {
    const { data, error } = await supabase
      .from("appointment_photos")
      .insert({
        id: photoId,
        appointment_id: args.appointmentId,
        tenant_id: args.tenantId,
        storage_path: path,
        kind: args.kind ?? "other",
        caption: args.caption ?? "",
        location_id: args.locationId ?? null,
        taken_at: args.takenAt ?? null,
        sort_order: count ?? 0,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return await rowWithUrl(supabase, data);
  } catch (err) {
    // Insert or signed-URL resolution failed. Remove a possibly-created row
    // before the blob so the UI can never retain metadata pointing at a
    // cleaned-up object. Both cleanups are best effort; the original failure
    // remains the actionable error.
    try {
      await supabase
        .from("appointment_photos")
        .delete()
        .eq("id", photoId)
        .eq("tenant_id", args.tenantId)
        .eq("appointment_id", args.appointmentId);
      await supabase.storage.from(BUCKET).remove([path]);
    } catch {
      // ignore — janitor sweeps later
    }
    throw err instanceof Error
      ? new Error(`uploadPhoto (row): ${err.message}`)
      : new Error("uploadPhoto (row): unknown");
  }
}

/** Delete the row first, then the storage object (REVERSED order
 *  per A3 — orphan blob ok, broken UI bad). Storage failure leaves
 *  an orphan blob; the row is gone, the UI no longer shows it. */
export async function deletePhoto(
  supabase: DbSupabase,
  photo: { id: string; storage_path: string },
): Promise<void> {
  const { data: deleted, error: rowErr } = await supabase
    .from("appointment_photos")
    .delete()
    .eq("id", photo.id)
    .select("id, storage_path")
    .maybeSingle();
  if (rowErr || !deleted) {
    throw new Error(
      `deletePhoto (row): ${rowErr?.message ?? "фотография не найдена или недоступна"}`,
    );
  }
  // Best-effort storage cleanup; ignore failure (janitor).
  try {
    // Never trust a stale/caller-supplied path for destructive storage work.
    // The row returned by the authorized DELETE is the canonical target.
    await supabase.storage.from(BUCKET).remove([deleted.storage_path]);
  } catch {
    // ignore — janitor sweeps later
  }
}
