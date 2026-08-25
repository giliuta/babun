-- ─────────────────────────────────────────────────────────────────────
-- STORY-080 — Admin audit log.
--
-- Code review iter 3 flagged: every action in /admin/actions.ts mutates
-- tenant state with no who/when/why trail. Plan overrides, sender
-- approvals, manual SMS grants, and (worst) tenant impersonation via
-- magic-link all happen invisibly from a forensics standpoint. GDPR
-- Article 30 (records of processing) needs this kind of log for
-- platform-admin operations.
--
-- Pattern: insert one row per admin action at the top of the action
-- (before mutating anything). If the action fails afterwards the log
-- still captures the attempt, which is what auditors want.
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.admin_actions_log (
  id              uuid primary key default gen_random_uuid(),
  admin_user_id   uuid not null references auth.users(id) on delete set null,
  action          text not null,
  target_tenant_id uuid references public.tenants(id) on delete set null,
  target_user_id  uuid references auth.users(id) on delete set null,
  details         jsonb not null default '{}'::jsonb,
  ip              text,
  user_agent      text,
  created_at      timestamptz not null default now()
);

create index if not exists admin_actions_log_admin_idx
  on public.admin_actions_log (admin_user_id, created_at desc);
create index if not exists admin_actions_log_tenant_idx
  on public.admin_actions_log (target_tenant_id, created_at desc);
create index if not exists admin_actions_log_action_idx
  on public.admin_actions_log (action, created_at desc);

comment on table public.admin_actions_log is
  'STORY-080 — Forensic record of every platform-admin action: '
  'plan overrides, sender approval/rejection, balance grants, '
  'impersonation magic-link generation. Inserted by the admin action '
  'helper before the action mutates anything. Read-only from app code.';

-- RLS: only platform admins can read; service-role writes.
alter table public.admin_actions_log enable row level security;

drop policy if exists admin_actions_log_select_admin on public.admin_actions_log;
create policy admin_actions_log_select_admin
  on public.admin_actions_log for select to authenticated
  using (public.is_platform_admin());

drop policy if exists admin_actions_log_service_role on public.admin_actions_log;
create policy admin_actions_log_service_role
  on public.admin_actions_log for all to service_role
  using (true) with check (true);
