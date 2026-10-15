-- Sprint clients-99: phone_e164 normalization, soft-delete, avatar, favorite master.
--
-- All additive — no destructive changes. Idempotent via IF NOT EXISTS.
-- Already applied to remote project rdtokosbqvgemicqeqwz in session
-- 2026-05-17 (clients_99_polish via MCP). File mirrors the change set
-- for the migrations directory.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS favorite_master_id TEXT;

-- Unique phone per tenant (only for live clients with normalized phone).
-- WHERE clause makes the constraint optional during the rollout window
-- (rows without phone_e164 are simply not enforced yet).
CREATE UNIQUE INDEX IF NOT EXISTS clients_tenant_phone_e164_idx
  ON public.clients(tenant_id, phone_e164)
  WHERE phone_e164 IS NOT NULL AND deleted_at IS NULL;

-- Helper index for soft-delete-aware list queries.
CREATE INDEX IF NOT EXISTS clients_tenant_alive_idx
  ON public.clients(tenant_id)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.clients.phone_e164 IS 'Normalized phone in E.164 form (e.g. +35799555111). Tenant-wide unique among non-deleted rows.';
COMMENT ON COLUMN public.clients.deleted_at IS 'Soft-delete marker. NULL = live; rows are purged by a background job after 30 days.';
COMMENT ON COLUMN public.clients.avatar_url IS 'Optional avatar image. Falls back to deterministic initials.';
COMMENT ON COLUMN public.clients.favorite_master_id IS 'Preferred master (text id from tenant_state — no FK since masters live there).';
