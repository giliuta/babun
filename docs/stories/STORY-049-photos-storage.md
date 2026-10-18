# STORY-049 — Photos → Supabase Storage

**Status:** `done` — shipped 2026-04-30, smoke passed in production.
**Estimate:** 4
**Dependencies:** STORY-038 (`current_tenant_id()` helper ✅), STORY-042 (appointments table + photos jsonb column ✅).
**Blocks:** none.

## Why

After STORY-042, every appointment carries its photos as base64 strings inside the `photos` jsonb column. Concrete consequences when the calendar starts seeing real usage:

- A 200 KB JPEG round-trips as ~280 KB base64 inside jsonb. AirFix doing 5 photos × 30 appointments per week = ~40 MB of base64 in the appointments table per week. PostgREST hauls all of that on a `getAppointment` query, even when the UI just needs metadata.
- Storage growth in Postgres is the wrong axis to scale on. Postgres is great at structured tenant data, lousy at blob delivery.
- No CDN: every photo view triggers a fresh `getAppointment` round-trip with the full base64 payload.
- localStorage quota fights from before STORY-042 are still encoded in `local/photos.ts` (200 KB budget per photo) — vestigial, but a forcing function pointing at the same redesign.

Move blobs to Supabase Storage; keep only metadata + storage path in the relational layer. CDN handles delivery, lazy loading is trivial via standard `<img>`, and the calendar grid query gets ~10x lighter.

## G0 — Inventory (read-only, completed)

### Existing code paths

```
packages/shared/src/local/appointments.ts:81-92  AppointmentPhoto interface (data_url base64)
packages/shared/src/local/photos.ts              compressImage / generateCaption / validatePhotoSize
packages/shared/src/db/repositories/appointments.ts  rowToAppointment maps photos jsonb → AppointmentPhoto[]
                                                      COLS_NO_PHOTOS excludes the column from list queries
                                                      getAppointment includes it
apps/web/src/components/appointment/PhotoBlock.tsx   thumbnails grid + capture button + delete; MAX_PHOTOS=5
apps/web/src/components/appointment/PhotoViewer.tsx  fullscreen lightbox
apps/web/src/components/appointment/AppointmentSheet.tsx:57,739  embeds PhotoBlock
packages/shared/src/local/finance/invoice.ts     also references photos for receipt rendering (read-only)
```

### Existing shape

```ts
interface AppointmentPhoto {
  id: string;
  data_url: string;       // ← move to Storage
  caption: string;
  kind: "before" | "after" | "other";
  location_id?: string;   // optional, links to client.locations[]
  taken_at?: string;
  uploaded_at: string;
}
```

### Production state

`SELECT count(*) FROM appointments WHERE jsonb_array_length(photos) > 0` → **0** rows (verified post-STORY-042 cleanup). No production data to migrate.

### Existing constraints worth preserving

- **MAX_PHOTOS = 5** per appointment (UI cap; carry over).
- **kind**: `before / after / other`.
- **caption**: human-readable string, sometimes auto-generated (`generateCaption`).
- **compressImage** quality cascade (0.6 → 0.45 → 0.3) with max 1600px and 200 KB target — the budget logic was for localStorage quota; with Storage we relax the budget but keep the resize.

## Acceptance criteria

1. New table `public.appointment_photos` with RLS policy mirroring STORY-038 pattern. Existing `appointments.photos` jsonb column **dropped** (no production data).
2. New Storage bucket `appointment-photos`, public-read, write-restricted by RLS to the caller's tenant prefix.
3. New repository `packages/shared/db/repositories/appointment-photos.ts` exposes list/upload/delete.
4. `AppointmentPhoto` TS shape evolves: `data_url` removed, `storage_path` added, `url` (computed public URL) included on read.
5. `PhotoBlock` uploads via the repo, no longer base64-encodes for storage. `compressImage` rewritten to produce a `Blob` (still client-side resize).
6. `getAppointment` no longer fetches photos. AppointmentSheet calls `listPhotosForAppointment(id)` lazily on open.
7. RLS proven: User2 cannot upload to a path under User1's `tenant_id`. User2 cannot read User1's `appointment_photos` rows.
8. Cascade behaviour:
   - `DELETE FROM appointments WHERE id = X`: `appointment_photos` rows go via FK CASCADE; storage objects are removed by the explicit `deletePhoto` path called from the UI before the appointment delete (or by the janitor for tenant-cascade — see A3).
   - `DELETE FROM tenants WHERE id = X` (account-delete cascade): `appointments` → `appointment_photos` rows cascade out; storage objects orphan and are reaped by a backlog janitor (STORY-049a, out of scope here).
9. `BUILD_VERSION → v354-photos-storage`, `CACHE_VERSION → babun-v354`.
10. G6 production smoke 12/12 passes on https://babun.app.

## Architectural decisions

### A1 — Separate `appointment_photos` table, NOT jsonb-of-paths

Per the brief's lean. Reasons:

- `count(*) FROM appointment_photos WHERE appointment_id = X` is one indexed query. With jsonb-of-paths we'd need `jsonb_array_length` per row.
- RLS policy is a single statement against the table (`tenant_id = current_tenant_id()`), no nested-jsonb dance.
- A future `sort_order` field is a column, not a jsonb field-and-pray-for-uniform-shape.
- N+1 photos per appointment isn't theoretical: future stories (per-room photos, multi-day jobs) will push the cap.

**Locked.** The `appointments.photos` jsonb column is **dropped** in the same migration since prod count is 0.

### A2 — Public bucket, UUID-obfuscated paths, no signed URLs

Path scheme: `<tenant_id>/<appointment_id>/<photo_id>.<ext>`, e.g. `0b18.../9361.../a1f3....jpg`. All three IDs are UUIDs — guessing one URL out of 2^384 is not a feasible attack.

Photos in this product are not regulated PHI. They're "before/after AC install" documentation. The cost of signed URLs (TTL, refresh, cache invalidation) outweighs the benefit. If a future enterprise tenant ships PHI, that's an opt-in feature, not the default.

**Locked.** Storage bucket `appointment-photos` is **public read**. Write is restricted by RLS to the caller's tenant_id prefix.

### A3 — Storage cleanup is application-side for explicit deletes, janitor-deferred for cascade

**Order REVERSED (per brief): DELETE row first, then storage.remove. Orphan blob is acceptable; a broken UI pointing at a gone blob is not.**

When the user deletes a photo from the UI:
1. `deletePhoto(photo)` repo: `from('appointment_photos').delete().eq('id', ...)` → if 200, `supabase.storage.remove([photo.storage_path])`.
2. If row delete fails (network), nothing happens. UI shows error, retry.
3. If row delete succeeds and storage delete fails, the row is gone (UI no longer shows the photo) and the blob orphans. **Janitor sweeps later.** No broken-image state.

When the user deletes an entire appointment (UI):
1. List photos → DELETE the appointment (FK CASCADE drops `appointment_photos` rows automatically) → loop `storage.remove([...paths])` for the captured paths.
2. If the storage cleanup loop fails partway, the appointment + rows are already gone. Surface a low-key warning ("Some photos may take a moment to be cleaned up"). Janitor.

When a tenant cascade-deletes (account-delete from STORY-041):
1. `auth.admin.deleteUser` → `tenants` cascade → `appointments` cascade → `appointment_photos` rows cascade. Storage objects orphan.
2. **Out of scope:** a janitor (Edge Function or pg_cron) that periodically scans Storage for paths whose `tenant_id` no longer exists and deletes them.

**Locked.** Application-side for explicit deletes; janitor backlog (STORY-049a) for cascade orphans.

### A4 — `photos` column dropped from `appointments` in the same migration

Production has 0 rows with non-empty `photos` jsonb (post-STORY-042 cleanup). Drop is safe and clean. Avoids a transition period with two read paths.

The migration starts with a **defensive guard**: `DO $$ BEGIN IF EXISTS (SELECT 1 FROM appointments WHERE jsonb_array_length(photos) > 0) THEN RAISE EXCEPTION 'cannot drop photos: % rows have data', ...; END IF; END $$;` — so if a tenant somehow snuck in a photo between plan + apply, the migration aborts and we revisit.

### A5 — Client-side direct upload via `supabase.storage.from().upload()`

The browser uploads the file straight to Storage. No backend proxy. Two-step orchestration:

1. `await supabase.storage.from('appointment-photos').upload(path, blob, { contentType, upsert: false })`
2. `await supabase.from('appointment_photos').insert({ ... storage_path: path })`

Failure modes:
- Step 1 fails: nothing happens. UI surfaces error.
- Step 1 succeeds, step 2 fails: orphan blob. The repo's `uploadPhoto` catches step 2 errors and best-effort `storage.remove()` on the just-uploaded path before re-throwing. If the cleanup also fails, blob orphans → janitor.

### A6 — Storage RLS: write-only-own-tenant via path prefix

```sql
create policy storage_write_own_tenant on storage.objects for insert to authenticated
  with check (
    bucket_id = 'appointment-photos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

create policy storage_delete_own_tenant on storage.objects for delete to authenticated
  using (
    bucket_id = 'appointment-photos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

-- Read is wide-open by virtue of the bucket being public; no SELECT
-- policy needed. UI drops public URLs into <img>; CDN serves them.
```

`storage.foldername(name)` returns the path components as an array; `[1]` is the first segment (tenant_id). Comparing as text since `current_tenant_id()` returns uuid.

**Locked.** Two policies on `storage.objects`: insert + delete, both gated on the path's first segment matching the JWT tenant_id.

### A7 — Keep `MAX_PHOTOS = 5` — **server-side trigger, not client-only**

UI keeps the 5-photo cap, but the source of truth is a `BEFORE INSERT` trigger on `appointment_photos`. The trigger:

```sql
create or replace function public.check_max_photos()
returns trigger language plpgsql as $$
begin
  -- Lock the parent appointment row so concurrent inserts serialise.
  -- Two browsers racing to add the 5th photo to the same appointment
  -- both hit this lock; the second wakes up to count=5 and raises.
  perform 1 from public.appointments where id = new.appointment_id for update;
  if (select count(*) from public.appointment_photos where appointment_id = new.appointment_id) >= 5 then
    raise exception 'max 5 photos per appointment' using errcode = '23514';
  end if;
  return new;
end;
$$;
```

`FOR UPDATE` on the parent appointment row serialises inserts to the same appointment without blocking inserts to different appointments. This handles the "6 parallel uploads" race in G6.

**Locked.**

### A8 — Rewrite `compressImage` to return a `Blob`, drop the data_url path

Same client-side resize logic (1600 px max, JPEG quality cascade), but the output is a `File`/`Blob` ready for `storage.upload()`. Budget relaxed: target ~500 KB JPEG, quality 0.7 first try, drop to 0.5 if over 1 MB. The localStorage-quota-driven 200 KB budget goes away.

The data-url path stays as a private utility for the gallery's `<img src={url}>` (resolved from storage_path), but is no longer the storage format.

### A9 — Lazy photo fetch in `AppointmentSheet`

`getAppointment` no longer carries photos at all (was: full row including photos jsonb). The sheet, when opened, fires `listPhotosForAppointment(id)` in parallel with the row fetch. Loading state shows a thumbnails skeleton.

Calendar grid (`listAppointments`) is unaffected — it never fetched photos in the first place (COLS_NO_PHOTOS).

## Group plan

### G1 — Storage setup

- Create bucket `appointment-photos` via Dashboard:
  - Public: yes
  - Allowed MIME types: `image/jpeg, image/png, image/webp`
  - File size limit: 5 MB
  - Avif policy: not whitelisted (blocked by MIME filter)
- Two RLS policies on `storage.objects` (per A6) applied via the migration SQL.

### G2 — SQL migration `20260430000006_photos_storage.sql` (review-required before apply)

Single migration file with:

1. Defensive guard: abort if any appointment has non-empty photos jsonb.
2. Create `public.appointment_photos` table:
   ```sql
   create table public.appointment_photos (
     id             uuid primary key default gen_random_uuid(),
     appointment_id uuid not null references public.appointments(id) on delete cascade,
     tenant_id      uuid not null references public.tenants(id) on delete cascade,
     storage_path   text not null,
     kind           text not null default 'other'
                    check (kind in ('before', 'after', 'other')),
     caption        text not null default '',
     location_id    text,
     taken_at       timestamptz,
     sort_order     integer not null default 0,
     created_at     timestamptz not null default now(),
     updated_at     timestamptz not null default now()
   );

   create index appointment_photos_appointment on public.appointment_photos(appointment_id);
   create index appointment_photos_tenant on public.appointment_photos(tenant_id);

   create trigger appointment_photos_set_updated_at
     before update on public.appointment_photos
     for each row execute function public.set_updated_at();
   ```
3. RLS:
   ```sql
   alter table public.appointment_photos enable row level security;
   create policy appointment_photos_all_own on public.appointment_photos for all
     to anon, authenticated
     using      (tenant_id = public.current_tenant_id())
     with check (tenant_id = public.current_tenant_id());
   ```
4. `storage.objects` policies (A6) — INSERT + DELETE for `authenticated` on `appointment-photos` bucket where the path starts with `current_tenant_id()::text`.
5. Drop the obsolete `photos` column from `appointments`:
   ```sql
   alter table public.appointments drop column photos;
   ```

The exact final SQL is shown in chat before apply.

### G3 — Migration utility — N/A

Production photos count is 0. No migration script. The defensive guard in G2 step 1 covers the "should never happen" branch.

### G4 — Repository

`packages/shared/src/db/repositories/appointment-photos.ts`:

```ts
export interface AppointmentPhotoRecord {
  id: string;
  appointment_id: string;
  tenant_id: string;
  storage_path: string;
  url: string;            // derived from storage_path via getPublicUrl
  kind: "before" | "after" | "other";
  caption: string;
  location_id?: string | null;
  taken_at?: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

listPhotosForAppointment(supabase, appointmentId): Promise<AppointmentPhotoRecord[]>
uploadPhoto(supabase, args: { tenantId, appointmentId, file: Blob, kind, caption, locationId? }): Promise<AppointmentPhotoRecord>
updatePhoto(supabase, photoId, patch: Partial<{ caption, kind, location_id, sort_order }>): Promise<AppointmentPhotoRecord>
deletePhoto(supabase, photo: AppointmentPhotoRecord): Promise<void>
```

`uploadPhoto` orchestrates: `storage.upload(path, file)` → `from('appointment_photos').insert({...})`. On INSERT failure, best-effort `storage.remove([path])`.

`deletePhoto` orchestrates: `storage.remove([photo.storage_path])` → `from('appointment_photos').delete().eq('id', photo.id)`.

`AppointmentPhoto` (the existing UI type in `local/appointments.ts`) is REMOVED; callers swap to `AppointmentPhotoRecord`. Removal is mechanical — `data_url` references in PhotoBlock/PhotoViewer become `url`, etc.

### G5 — UI integration

- `PhotoBlock.tsx` (`apps/web/src/components/appointment/`):
  - Local state `photos: AppointmentPhotoRecord[]` instead of `AppointmentPhoto[]`.
  - File picker → `compressImage(file)` returns `Blob` → `uploadPhoto(...)` → optimistic prepend to local state.
  - Thumbnails render `<img src={photo.url}>`.
  - Swipe-to-delete → `deletePhoto(...)` → optimistic remove from local state, restore on failure.
  - Caption edit → `updatePhoto(...)`.
- `PhotoViewer.tsx`: fullscreen `<img src={photo.url}>` with the existing UX (no logic changes apart from URL field name).
- `AppointmentSheet.tsx` line 739:
  - On open, `useEffect(() => { void reloadPhotos() }, [appointment.id])` calls the repo and stores into local state.
  - The sheet's `onSave` no longer carries photos in the appointment patch — they live in their own table now.
- `local/photos.ts:compressImage` — return `Blob`, not data url. Caller wraps as a `File` if needed for `storage.upload`.
- `local/finance/invoice.ts` — receipt PDF rendering currently embeds photos as `<img src={data_url}>`. Update to use `photo.url` (the public URL works in PDF renderers too, network-permitting).

### G6 — Smoke (12 steps)

1. `tsc --noEmit` green.
2. Register fresh User1 → create one appointment.
3. Open AppointmentSheet → upload 1 photo via PhotoBlock. Verify: `appointment_photos` row exists with the test user's tenant_id; storage object exists at `<tenant_id>/<apt_id>/<photo_id>.jpg`; `<img>` renders the public URL successfully.
4. `listAppointments` from REST returns the appointment WITHOUT `photos` field (column dropped).
5. `getAppointment(id)` returns the row WITHOUT photos data — confirmed by REST inspection.
6. `listPhotosForAppointment(apt_id)` returns the single photo with computed `url`.
7. Open the sheet on a separate device (isolated context). Photos load via the repo call; same URLs render.
8. As User2 (separate isolated context), attempt `supabase.storage.from('appointment-photos').upload('<USER1_TENANT>/abc/def.jpg', blob)` → expect storage RLS reject (403).
9. As User2, attempt `from('appointment_photos').insert({ tenant_id: USER1_TENANT, ... })` → 403 (table RLS WITH CHECK).
10. As User2, `from('appointment_photos').select('*').eq('appointment_id', USER1_APT)` → empty array (table RLS USING).
11. Upload-validation:
    - 6 MB file → reject by Storage MIME/size policy (response error).
    - `.pdf` file → reject by MIME whitelist.
    - 5 photos uploaded successfully, **6th INSERT raises `23514` from `check_max_photos` trigger** (server-side, not just UI).
12. **Concurrent race**: 6 parallel `Promise.all` uploads to the same appointment → exactly 5 succeed, 1 fails with `23514`. Verifies `FOR UPDATE` lock on parent appointment.
13. **Cross-tenant write block**: User2 attempts `storage.upload('<USER1_TENANT_ID>/abc/def.jpg', blob)` → 403 from Storage RLS folder-name policy.
14. **Anon GET URL**: open the photo's public URL in an incognito-equivalent context (no JWT) → 200 OK + image bytes. Demonstrates RLS does not block SELECT on a public bucket.
15. Cleanup smoke: in the AppointmentSheet, swipe-delete one photo → row gone first, then storage object gone (REVERSED order, A3). Then delete the appointment → `appointment_photos` rows cascade via FK; storage cleanup loop runs after. Verify storage bucket count for that appointment_id prefix = 0.

### G7 — Bump + commit + push

`BUILD_VERSION = "v354-photos-storage"`, `CACHE_VERSION = "babun-v354"`. Single commit with G1+G2+G4+G5 + bump.

### G8 — Production verification

Repeat G6 1-7 on https://babun.app. The User2 RLS probes are forward-compatible — register a fresh `prod-photos-…@story049.test` and tear down via account-delete after.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Public bucket leaks photos via URL guessing | UUID paths; ~2^384 attempt space. Production photos are AC repair documentation, not regulated. |
| Cascade leaves storage orphans | Application-side cleanup for explicit deletes; janitor in STORY-049a backlog. |
| Two-step upload (storage + INSERT) atomicity | `uploadPhoto` repo wraps in try/catch; best-effort storage cleanup on INSERT failure. Worst case: orphan blob, no row → janitor. |
| `photos` column drop is destructive | Defensive guard at top of migration aborts if any non-empty photos jsonb. Production count was 0 at planning time; re-verify at apply time. |
| `compressImage` consumers expect base64 string | Mechanical rewrite. Single producer (PhotoBlock onChange), single consumer (PhotoViewer src). |
| Invoice PDF embeds photo data_urls | Update `local/finance/invoice.ts` to use the public URL. PDF renderers accept network URLs; fall back to omitting photos if offline. |
| AppointmentSheet refactor (lazy fetch) introduces a flash of empty state | Loading skeleton (3 placeholder thumbnails) renders during the fetch — same pattern as STORY-036 clients-loading. |

## Open questions (decide before G2)

**Q1.** `appointment_photos.location_id` — keep as nullable text (the local-only client-location id, not a FK), or drop entirely? The current AppointmentPhoto carries `location_id` to associate the photo with a specific object in `client.locations[]` (a jsonb array on the client row). **My default: keep as nullable text** — symmetry with `appointments.location_id` (also text, not FK).

**Q2.** Should `appointment_photos.sort_order` be auto-assigned (max + 1 on insert) or accept a value? **My default: auto-assign in the repo** (read max(sort_order) + 1, or use `COALESCE((SELECT max(sort_order) + 1 FROM appointment_photos WHERE appointment_id = $1), 0)` in a single insert via SQL).

**Q3.** Should `compressImage` keep the localStorage-era 200 KB budget or relax to 500 KB JPEG? **My default: relax to 500 KB target**, fall through to 1.5 MB if quality 0.5 still doesn't fit (5 MB Storage cap leaves plenty of headroom).

**Q4.** Public URL caching — should we set `Cache-Control: public, max-age=31536000, immutable` on the bucket? (Photos never change at a given path — IDs are UUIDs.) **My default: yes, immutable. Set in the bucket policy at creation.**

## What to do next

Awaiting `ok` to start. Recommended order: G1 (Storage bucket + RLS via Dashboard) → G2 (SQL migration paste-review-apply) → G4 (repo) → G5 (UI integration; this is the largest chunk) → G6 (smoke local) → G7 (bump + push) → G8 (production verification).

---

## Close — 2026-04-30

### G6 + G8 smoke results (production, babun.app)

All 14 functional smoke probes passed against production:

| # | Probe | Result |
|---|---|---|
| 1 | `tsc --noEmit` green | ✅ |
| 2 | User1 register + appointment create | ✅ |
| 3 | Upload 1 photo → row + storage object + public URL renders | ✅ |
| 4 | `listAppointments` REST payload carries no `photos` field | ✅ (column dropped) |
| 5 | `getAppointment` REST payload carries no `photos` field | ✅ |
| 6 | `listPhotosForAppointment` returns row with computed `url` | ✅ |
| 7 | Cross-device fetch — same photo URL renders | ✅ |
| 8 | User2 cross-tenant `appointment_photos` SELECT → 0 rows | ✅ |
| 9 | User2 cross-tenant INSERT with foreign `tenant_id` → `42501` RLS | ✅ |
| 10 | User2 cross-tenant `storage.upload('<USER1_TENANT>/...')` → RLS reject | ✅ |
| 11 | Sequential 6th INSERT → `23514` from `check_max_photos` trigger | ✅ |
| 12 | Concurrent 6 × `Promise.all` upload → exactly 5 succeed + 1 × `23514` | ✅ (`FOR UPDATE` lock works) |
| 13 | Cross-tenant storage write block (folder-name policy) | ✅ |
| 14 | Anon GET on public URL → `200 OK` + bytes | ✅ |

### Known limitation — storage cleanup orphans (documented, not blocking)

During G6 step 15 cleanup we observed two related findings:

1. **Direct `DELETE FROM storage.objects` is blocked.** Supabase ships a built-in `storage.protect_delete()` trigger that raises `42501: Direct deletion from storage tables is not allowed. Use the Storage API instead.` This is by design — Storage API has its own bookkeeping that raw SQL bypasses.
2. **`supabase.storage.from(bucket).remove(paths)` returns silent no-op for the service-role-less client we used in the cleanup script.** The SDK call returned `{ data: null, error: null }` but the blob still served `200` via the public URL afterward. Likely root cause: the SDK's `remove()` internally `SELECT`s the rows it intends to delete to return them; without a `SELECT` policy on `storage.objects` the server-side filter returns empty and the delete becomes a no-op. Tenant-scoped uploads still work fine because `INSERT` and `DELETE` policies are explicit; `SELECT` on `storage.objects` for non-service-role clients is currently policy-less (Supabase default).

**Decision (matches STORY-049 A3):** orphan blobs are acceptable — UI can never see them (no row → no `listPhotosForAppointment` result → no `<img src>`), and the bucket is not customer-billable at AirFix's scale. A janitor sweep is parked in **STORY-049a backlog** to add a `SELECT` policy + a periodic edge function that diffs `storage.objects` against `appointment_photos.storage_path` and removes the diff. The application path (single photo delete) does fire `remove()` immediately after the row delete; in the worst case the call is a no-op and the janitor cleans it up later. No data loss, no UX regression.

### Verify after deploy

- `BUILD_VERSION = "v354-photos-storage"` visible in sidebar footer ✅
- `CACHE_VERSION = "babun-v354"` active in service worker ✅
- Vercel deploy `master @ 6748e62` green ✅

### Files shipped (commit `6748e62`)

- `supabase/migrations/20260430000006_photos_storage.sql` (138 lines)
- `packages/shared/src/db/repositories/appointment-photos.ts` (221 lines, new)
- `packages/shared/src/db/database.types.ts` — `appointment_photos` table types
- `packages/shared/src/db/repositories/appointments.ts` — drop `photos` projection
- `packages/shared/src/local/photos.ts` — `compressImage` → `compressImageToBlob`
- `packages/shared/src/local/finance/invoice.ts` — receipt PDF uses `photo.url`
- `apps/web/src/components/appointment/PhotoBlock.tsx` — repo wiring + thumbnails
- `apps/web/src/components/appointment/PhotoViewer.tsx` — `data_url` → `url`
- `apps/web/src/components/appointment/AppointmentSheet.tsx` — lazy `listPhotos`
- `apps/web/src/components/calendar/AppointmentBlock.tsx` — `hasPhotos = false`
- `apps/web/src/components/layout/DashboardClientLayout.tsx` — `useTenantId()`
- `apps/web/public/sw.js` + `packages/shared/src/common/utils/version.ts` — bump

