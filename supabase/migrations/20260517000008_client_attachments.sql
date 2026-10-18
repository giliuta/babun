-- Sprint clients-99 (F3.10) — client attachments.
--
-- Already applied to remote rdtokosbqvgemicqeqwz on 2026-05-17.
-- This file mirrors that migration for the directory.
--
-- Bucket: client-attachments (private — sensitive content like
-- before/after photos, contracts). Path: {tenant_id}/{client_id}/{attachment_id}.{ext}
-- All reads via short-lived signed URLs from the client.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client-attachments',
  'client-attachments',
  false,
  10 * 1024 * 1024,
  NULL
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS client_attachments_select ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS client_attachments_insert ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS client_attachments_update ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS client_attachments_delete ON storage.objects';
END $$;

CREATE POLICY client_attachments_select
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'client-attachments'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

CREATE POLICY client_attachments_insert
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'client-attachments'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

CREATE POLICY client_attachments_update
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'client-attachments'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  )
  WITH CHECK (
    bucket_id = 'client-attachments'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

CREATE POLICY client_attachments_delete
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'client-attachments'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

CREATE TABLE IF NOT EXISTS public.client_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);

CREATE INDEX IF NOT EXISTS client_attachments_client_idx
  ON public.client_attachments(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS client_attachments_tenant_idx
  ON public.client_attachments(tenant_id);

ALTER TABLE public.client_attachments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS client_attachments_tenant_all ON public.client_attachments';
END $$;

CREATE POLICY client_attachments_tenant_all
  ON public.client_attachments FOR ALL
  TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

COMMENT ON TABLE public.client_attachments IS 'Metadata for files in storage bucket client-attachments. Tenant-scoped via RLS.';
COMMENT ON COLUMN public.client_attachments.storage_path IS 'Bucket-relative path: {tenant_id}/{client_id}/{attachment_id}.{ext}';
