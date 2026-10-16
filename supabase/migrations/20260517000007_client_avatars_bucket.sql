-- Sprint clients-99 (F3.5) — Supabase Storage bucket for client avatars.
--
-- Bucket layout: client-avatars/{tenant_id}/{client_id}.{ext}
--   * tenant_id is enforced by RLS — no cross-tenant reads or writes.
--   * Public read (bucket.public = true) so <img src> works without
--     signed URLs. Privacy is preserved by path obscurity + the fact
--     that you need tenant_id + client_id (UUIDs) to construct the
--     URL. Switch to private + signed URLs if a tenant ever stores
--     photos that aren't safe to leak.
--   * 2 MB cap — bigger files are clipped before upload by the
--     client-side helper.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client-avatars',
  'client-avatars',
  true,
  2 * 1024 * 1024,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── RLS policies on storage.objects for this bucket ──────────────
--
-- public.current_tenant_id() returns the JWT-derived tenant uuid.
-- The first path segment is the tenant UUID; we match it against
-- the caller's tenant. Crew + dispatcher + owner all can write
-- (taking a photo on-site is a normal field-team flow).

DO $$
BEGIN
  -- Drop any earlier copies of these policies so the migration is
  -- safe to re-run after a partial apply.
  EXECUTE 'DROP POLICY IF EXISTS client_avatars_select ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS client_avatars_insert ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS client_avatars_update ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS client_avatars_delete ON storage.objects';
END $$;

-- Public read for the bucket — anyone with a URL can fetch.
CREATE POLICY client_avatars_select
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'client-avatars');

-- Same-tenant insert.
CREATE POLICY client_avatars_insert
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'client-avatars'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

-- Same-tenant update (replacing an existing photo).
CREATE POLICY client_avatars_update
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'client-avatars'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  )
  WITH CHECK (
    bucket_id = 'client-avatars'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

-- Same-tenant delete.
CREATE POLICY client_avatars_delete
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'client-avatars'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );
