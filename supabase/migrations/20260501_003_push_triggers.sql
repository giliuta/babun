-- ─────────────────────────────────────────────────────────────────────
-- STORY-053b — Web Push triggers (G3).
--
-- TWO triggers fan out push notifications to the send_push Edge
-- Function via pg_net.http_post (fire-and-forget). Triggers wake up
-- on:
--   1. INSERT into tenant_members (role != 'owner') — notify owners
--   2. UPDATE on invitations where accepted_at flips NULL→NOT NULL —
--      notify the inviter
--
-- A third trigger (master_new_appointment) was originally planned but
-- deferred to STORY-039b — `appointments.master_id` is `text` today
-- (legacy local-storage slug), not `uuid`. It will be added in the
-- same migration that converts the masters domain to auth.users-keyed
-- UUIDs. The Edge Function `send_push` keeps a `master.new_appointment`
-- TEMPLATES entry as forward-compat scaffolding (Edge Function dead
-- code is cheap to keep; trigger dead code in the DB is not).
--
-- All notifications are gated by TWO independent flags so we can
-- deploy the triggers in an inert state and flip them on once the
-- Edge Function is verified end-to-end:
--
--   - public.app_settings (key='push_enabled', value='off') — global
--     master switch. Flip ON / OFF via:
--       update public.app_settings
--          set value = 'on', updated_at = now()
--        where key = 'push_enabled';
--     Takes effect immediately on the next trigger fire (no connection
--     cache lag because the helper does a fresh SELECT each time).
--     Originally drafted as a `alter database ... set app.push_enabled`
--     GUC but Supabase managed Postgres doesn't grant superuser, so a
--     small one-row table is the next-cleanest pattern. The table is
--     reusable for future flags (sms_enabled, stripe_test_mode, etc.).
--
--   - app.skip_push (transaction-scoped, set via set_config(...,
--     true)) — used by bulk imports (CSV) so a 5000-row import
--     doesn't flood subscribers. Wrap the import block in:
--       begin;
--         select set_config('app.skip_push', '1', true);
--         -- bulk inserts here
--       commit;
--     The two flags answer different questions (global vs txn-local)
--     so they intentionally use different storage mechanisms.
--
-- The Edge Function (send_push) renders all notification copy
-- server-side from event_type + payload data, so a copy change is
-- a 1-minute Edge Function redeploy, not a database migration.
-- ─────────────────────────────────────────────────────────────────────

-- ── Step 1: enable pg_net (HTTP from inside Postgres) ─────────────
create extension if not exists pg_net with schema extensions;

-- ── Step 2: feature-flag store + initial row ──────────────────────
-- Generic key-value table for global flags. RLS-protected; only
-- service_role + the postgres role (used by SQL Editor and migrations)
-- can touch it. Read access from triggers happens via security definer
-- helpers, so authenticated users never query it directly.
create table if not exists public.app_settings (
  key        text        primary key,
  value      text        not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists app_settings_service_role_all on public.app_settings;
create policy app_settings_service_role_all
  on public.app_settings
  for all to service_role
  using (true) with check (true);

-- Initial flag value: push_enabled = 'off'. The whole pipeline is
-- inert until this row is updated to 'on'.
insert into public.app_settings (key, value)
  values ('push_enabled', 'off')
  on conflict (key) do nothing;

comment on table public.app_settings is
  'Generic key-value store for global feature flags / settings that '
  'change infrequently (master switches, kill flips). Reads happen '
  'through security-definer helpers; never expose to authenticated.';

-- ── Step 3: shared dispatch helper ────────────────────────────────
-- All triggers funnel through this. It bails early on either flag
-- and on empty recipients, then calls pg_net.http_post with the
-- shape send_push expects: { user_ids, event_type, data }.
create or replace function public._dispatch_push(
  p_event_type text,
  p_data       jsonb,
  p_recipients uuid[]
) returns void
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  push_enabled text;
  skip_push    text;
  fn_url       text := 'https://rdtokosbqvgemicqeqwz.supabase.co/functions/v1/send_push';
begin
  -- Master switch (global). Read fresh on each call so flag flips
  -- take effect immediately without cycling connections. If the row
  -- is missing entirely (someone DROPPED it, migration order glitch,
  -- etc.) — treat as OFF, which is the safe default.
  select value into push_enabled
    from public.app_settings
   where key = 'push_enabled';

  if not found or push_enabled is distinct from 'on' then
    return;
  end if;

  -- Bulk-import mute (transaction-scoped).
  skip_push := current_setting('app.skip_push', true);
  if skip_push = '1' then
    return;
  end if;

  -- No recipients → nothing to do.
  if p_recipients is null or cardinality(p_recipients) = 0 then
    return;
  end if;

  -- Fire and forget. pg_net queues the request and returns immediately,
  -- so the trigger doesn't block the parent INSERT/UPDATE on Edge
  -- Function latency. Failures land in net._http_response and the
  -- function's own Logs view; we don't propagate them up.
  perform extensions.http_post(
    url     := fn_url,
    body    := jsonb_build_object(
                 'user_ids',   to_jsonb(p_recipients),
                 'event_type', p_event_type,
                 'data',       p_data
               ),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
exception when others then
  -- Never let push failures break the parent transaction. Log and
  -- swallow. The pg_net request itself is async; this only catches
  -- mis-config (extension missing, URL malformed, etc.).
  raise warning 'dispatch_push failed: %', sqlerrm;
end;
$$;

comment on function public._dispatch_push(text, jsonb, uuid[]) is
  'STORY-053b — internal helper. Fan-out to send_push Edge Function. '
  'Gated by app.push_enabled (database GUC) and app.skip_push (txn).';

-- ── Step 4: trigger #1 — owners notified about new tenant member ──
create or replace function public._tg_notify_owner_new_member()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  owner_ids uuid[];
begin
  -- Skip if the new member IS an owner (no one to "notify" — the
  -- second-owner case is rare enough we let it slide), or the new
  -- member is the same user as auth.uid() (self-add edge case).
  if NEW.role = 'owner' or NEW.user_id = auth.uid() then
    return NEW;
  end if;

  -- Recipients = all owners of this tenant other than auth.uid().
  -- (No reason to notify the owner who just clicked Invite.)
  select coalesce(array_agg(user_id), '{}')
    into owner_ids
    from public.tenant_members
   where tenant_id = NEW.tenant_id
     and role      = 'owner'
     and user_id  <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  perform public._dispatch_push(
    'owner.new_member',
    jsonb_build_object(
      'tenant_id',  NEW.tenant_id,
      'user_id',    NEW.user_id,
      'role',       NEW.role,
      'joined_at',  NEW.joined_at
    ),
    owner_ids
  );

  return NEW;
end;
$$;

drop trigger if exists notify_owner_new_member on public.tenant_members;
create trigger notify_owner_new_member
  after insert on public.tenant_members
  for each row execute function public._tg_notify_owner_new_member();

-- ── Step 5: trigger #2 — inviter notified when invite accepted ────
-- Fires only on the NULL → NOT NULL transition of accepted_at, so a
-- subsequent UPDATE that touches other columns doesn't re-fire.
create or replace function public._tg_notify_inviter_invite_accepted()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- Did the invitation just transition from "pending" to "accepted"?
  if OLD.accepted_at is not null or NEW.accepted_at is null then
    return NEW;
  end if;

  -- Skip if the inviter accepted their own invite (corner case).
  if NEW.invited_by_user_id is null or NEW.invited_by_user_id = auth.uid() then
    return NEW;
  end if;

  perform public._dispatch_push(
    'inviter.invite_accepted',
    jsonb_build_object(
      'invitation_id', NEW.id,
      'tenant_id',     NEW.tenant_id,
      'email',         NEW.email,
      'role',          NEW.role,
      'accepted_at',   NEW.accepted_at
    ),
    array[NEW.invited_by_user_id]
  );

  return NEW;
end;
$$;

drop trigger if exists notify_inviter_invite_accepted on public.invitations;
create trigger notify_inviter_invite_accepted
  after update on public.invitations
  for each row execute function public._tg_notify_inviter_invite_accepted();

-- ── Diagnostics / runbook ─────────────────────────────────────────
-- Flip the master switch ON (after end-to-end verification):
--   update public.app_settings
--      set value = 'on', updated_at = now()
--    where key = 'push_enabled';
--   -- effect is immediate; the next trigger fire reads the new value.
--
-- Flip OFF (kill switch):
--   update public.app_settings
--      set value = 'off', updated_at = now()
--    where key = 'push_enabled';
--
-- Read current value:
--   select key, value, updated_at
--     from public.app_settings
--    where key = 'push_enabled';
--
-- Inspect recent http requests (pg_net's outbox):
--   select id, status_code, content_type, error_msg, created
--     from net._http_response
--    order by created desc
--    limit 50;
--
-- Add CSV-import mute around bulk inserts:
--   begin;
--     select set_config('app.skip_push', '1', true);
--     -- bulk inserts here (no notifications fire)
--   commit;
