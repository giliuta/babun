-- ─────────────────────────────────────────────────────────────────────
-- STORY-059 — demo data flag for sample-data seed/cleanup.
--
-- Adds `is_demo BOOLEAN NOT NULL DEFAULT false` to clients, appointments,
-- and masters so the Settings → Account "Загрузить демо-данные" toggle
-- can mark seeded rows for clean removal later.
--
-- Why a column instead of a name-prefix tag:
--   * cleanup is a single deterministic DELETE per table, scoped by
--     (tenant_id, is_demo = true). No string parsing, no false hits
--     on a real client genuinely named "[Демо] X".
--   * default false means existing rows are unaffected and no
--     backfill is needed.
--   * RLS unchanged — both tables are still tenant-scoped.
--
-- Used by:
--   * src/lib/demo-data/seed.ts — seedDemoData() / removeDemoData()
--   * src/app/dashboard/settings/account/page.tsx — UI toggle
-- ─────────────────────────────────────────────────────────────────────

alter table public.clients
  add column if not exists is_demo boolean not null default false;

alter table public.appointments
  add column if not exists is_demo boolean not null default false;

-- Masters table is local-only today (no Supabase counterpart yet).
-- The seed will skip masters until masters migrate to Supabase.

-- Indexes for the cleanup path. Partial indexes on the rare `true`
-- case keep them small and out of the hot read path.
create index if not exists clients_is_demo_idx
  on public.clients (tenant_id)
  where is_demo = true;

create index if not exists appointments_is_demo_idx
  on public.appointments (tenant_id)
  where is_demo = true;
