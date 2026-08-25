-- ─────────────────────────────────────────────────────────────────────
-- STORY-050 — Recurring reminders → Supabase (multi-device sync).
--
-- Lift-and-shift of @babun/shared/local/recurring.ts (the HVAC follow-up
-- reminder inbox: "we cleaned the A/C six months ago, time to call back").
-- This is NOT an RFC 5545 RRULE engine — see STORY-050 G0 inventory for
-- why that wasn't actually the missing piece. Each row is a one-shot
-- reminder; once `booked` or `dismissed` it leaves the inbox, and the
-- next cycle is created manually from the next completed appointment.
--
-- Schema mirrors RecurringReminder verbatim. `client_name` and `phone`
-- are denormalised so a future client delete (`on delete set null` on
-- client_id) doesn't drop the reminder.
--
-- RLS pattern STORY-038: single all-own policy gated on
-- tenant_id = public.current_tenant_id(). Cross-tenant reads return 0
-- rows; cross-tenant writes trip the WITH CHECK clause.
--
-- team_id stays as nullable text (NOT a FK) because teams still live
-- in localStorage, same as appointments.team_id.
-- ─────────────────────────────────────────────────────────────────────

create table public.recurring_reminders (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  client_id       uuid references public.clients(id) on delete set null,

  -- Denormalised from clients so deleting a client doesn't lose the reminder.
  client_name     text not null,
  phone           text not null default '',

  -- Local-only ref (text until masters/teams migrate).
  team_id         text,

  -- Service references — kept as jsonb of ids + a human summary string,
  -- mirroring the local-shape exactly.
  service_ids     jsonb not null default '[]'::jsonb,
  service_summary text not null default '',

  -- Date math is in calendar days; we store YYYY-MM-DD as text so the
  -- UI shape doesn't change. addMonthsYYYYMMDD clamps to last-of-month.
  last_date       text not null,
  next_due_date   text not null,
  interval_months integer not null,

  status          text not null default 'pending'
                       check (status in ('pending', 'booked', 'dismissed')),

  note            text not null default '',

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Tenant scoping (every query is filtered by RLS, but the explicit
-- index keeps PostgREST's planner happy).
create index idx_recurring_reminders_tenant
  on public.recurring_reminders(tenant_id);

-- Client profile timeline lookup: "what reminders does this client have?"
create index idx_recurring_reminders_client
  on public.recurring_reminders(client_id)
  where client_id is not null;

-- Inbox query — list pending reminders by due date for a tenant.
create index idx_recurring_reminders_due
  on public.recurring_reminders(tenant_id, status, next_due_date);

-- updated_at maintenance — reuses the helper from 20260427_001_init_clients.sql.
create trigger recurring_reminders_set_updated_at
  before update on public.recurring_reminders
  for each row execute function public.set_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────
alter table public.recurring_reminders enable row level security;

create policy recurring_reminders_all_own on public.recurring_reminders for all
  to anon, authenticated
  using      (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
