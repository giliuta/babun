-- ─────────────────────────────────────────────────────────────────────
-- STORY-040 — onboarding columns + backfill.
--
-- After this migration:
--   * tenants.city text — optional, free-form, no constraint.
--   * tenants.onboarded_at timestamptz — NULL for users who haven't
--     completed the wizard yet; set to now() on commit.
--   * Existing tenants (created before this migration) are
--     backfilled with onboarded_at = created_at so they don't get
--     bounced into the wizard on next visit (variant A from A3).
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. Schema ────────────────────────────────────────────────────────
-- Both columns nullable + no default. New tenants land with NULL
-- onboarded_at — that's what triggers the wizard via the dashboard
-- server gate.

alter table public.tenants
  add column if not exists city text,
  add column if not exists onboarded_at timestamptz;

-- ── 2. Backfill existing users ───────────────────────────────────────
-- Stamps every pre-migration tenant as already-onboarded so they
-- don't get redirected to /onboarding on next visit. Uses
-- created_at so analytics can still tell signup-from-onboarding
-- apart from this catch-up sweep.

update public.tenants
   set onboarded_at = created_at
 where onboarded_at is null;

-- ── 3. Verification (run manually, expect 0) ─────────────────────────
-- select count(*) from public.tenants where onboarded_at is null;

-- ── 4. RLS unchanged ─────────────────────────────────────────────────
-- The existing tenants_update_own policy from STORY-038 already
-- covers UPDATE on the new columns (it's column-agnostic). The
-- tenants_prevent_owner_change trigger continues to guard
-- owner_user_id as before. No new policies, no new triggers.

-- ── 5. Index posture ─────────────────────────────────────────────────
-- onboarded_at is read once per dashboard request via
-- "select id, onboarded_at from tenants where owner_user_id = ?".
-- The lookup is already by owner_user_id (unique partial index from
-- STORY-037 G1), so adding an index on onboarded_at would not help.
-- Skip.
