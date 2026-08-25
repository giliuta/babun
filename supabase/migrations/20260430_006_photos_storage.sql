-- ─────────────────────────────────────────────────────────────────────
-- STORY-049 — Photos → Supabase Storage.
--
-- Move appointment photos from base64-in-jsonb to a Storage bucket.
-- The relational layer keeps only metadata + storage_path; blobs go
-- through Supabase Storage with RLS gating writes by tenant prefix.
--
-- Layout:
--   1. Defensive guard — abort if any appointment still has non-empty
--      photos jsonb (production count was 0 at planning time).
--   2. CREATE TABLE public.appointment_photos.
--   3. set_updated_at trigger.
--   4. RLS policy on appointment_photos.
--   5. check_max_photos BEFORE INSERT trigger (server-side cap).
--   6. Storage bucket appointment-photos (public read, MIME + 5MB cap).
--   7. Storage RLS policies on storage.objects for INSERT + DELETE.
--   8. ALTER TABLE appointments DROP COLUMN photos.
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. Defensive guard ──────────────────────────────────────────────
-- Aborts the whole migration if any appointment has a photo blob in
-- the legacy jsonb column. Re-verify production count is 0 before
-- applying. Matches STORY-049 A4.
do $guard$
declare
  bad_count integer;
begin
  select count(*) into bad_count
    from public.appointments
    where coalesce(jsonb_array_length(photos), 0) > 0;
  if bad_count > 0 then
    raise exception 'STORY-049 abort: % appointments still have base64 photos in the jsonb column. Migrate or clear them first.', bad_count;
  end if;
end
$guard$;

-- ── 2. appointment_photos table ─────────────────────────────────────
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
create index appointment_photos_tenant      on public.appointment_photos(tenant_id);

-- ── 3. set_updated_at trigger ───────────────────────────────────────
create trigger appointment_photos_set_updated_at
  before update on public.appointment_photos
  for each row execute function public.set_updated_at();

-- ── 4. RLS — table-level ────────────────────────────────────────────
alter table public.appointment_photos enable row level security;

create policy appointment_photos_all_own on public.appointment_photos for all
  to anon, authenticated
  using      (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ── 5. check_max_photos trigger (server-side cap, race-safe) ────────
-- BEFORE INSERT lock on the parent appointment row serialises
-- concurrent inserts targeting the same appointment, so a 6-way
-- Promise.all upload sees exactly 5 successes and 1 failure (23514).
-- Inserts to DIFFERENT appointments still parallelise — the lock is
-- per-row.
create or replace function public.check_max_photos()
returns trigger
language plpgsql
as $check_max$
begin
  perform 1 from public.appointments
    where id = new.appointment_id
    for update;
  if (
    select count(*) from public.appointment_photos
    where appointment_id = new.appointment_id
  ) >= 5 then
    raise exception 'max 5 photos per appointment'
      using errcode = '23514';
  end if;
  return new;
end
$check_max$;

create trigger appointment_photos_max_5
  before insert on public.appointment_photos
  for each row execute function public.check_max_photos();

-- ── 6. Storage bucket ───────────────────────────────────────────────
-- Public-read, MIME-restricted, 5 MB per object. Cache-Control set on
-- a per-object basis at upload time (the bucket-level setting in
-- Supabase doesn't expose Cache-Control as a field; the repo's
-- uploadPhoto specifies it via the upload options).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'appointment-photos',
  'appointment-photos',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── 7. Storage RLS — INSERT + DELETE on storage.objects ─────────────
-- Read is wide-open by virtue of bucket.public = true; no SELECT
-- policy needed. Path scheme: <tenant_id>/<appointment_id>/<photo_id>.<ext>.
-- (storage.foldername(name))[1] returns the first path segment.
create policy storage_appointment_photos_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'appointment-photos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

create policy storage_appointment_photos_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'appointment-photos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

-- ── 8. Drop the legacy photos jsonb column ──────────────────────────
-- Guard at step 1 ensured no data lives here. The repo + UI swap to
-- the new appointment_photos table; getAppointment no longer fetches
-- photos at all (separate listPhotosForAppointment call).
alter table public.appointments drop column photos;
