-- ─────────────────────────────────────────────────────────────────────
-- STORY-053b — Web Push subscriptions (G1).
--
-- One row per (user, device-endpoint) tuple. Subscriptions are
-- insert-or-delete only — there is no "edit a subscription" flow. When
-- a browser refreshes its push endpoint, we DELETE the old row and
-- INSERT the new one in the same /api/push/subscribe call.
--
-- The Edge Function `send_push` reads from this table to fan out a
-- Postgres trigger event to every device a user has registered. RLS
-- guarantees a user can only ever see / mutate their own rows; the
-- function uses the service role to query across users when fanning
-- out a notification triggered by a different user's action.
-- ─────────────────────────────────────────────────────────────────────

create table public.push_subscriptions (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants(id)   on delete cascade,
  user_id      uuid        not null references auth.users(id)       on delete cascade,
  endpoint     text        not null,
  -- { p256dh: base64-url, auth: base64-url } — opaque per Web Push spec.
  keys         jsonb       not null,
  -- Short label shown in /dashboard/settings — "iPhone 15 (Safari)" etc.
  -- Parsed once at subscribe time; we don't update it.
  device_label text,
  created_at   timestamptz not null default now(),

  -- One subscription per device per user. If a browser re-subscribes
  -- with the same endpoint we silently no-op via ON CONFLICT.
  unique (user_id, endpoint)
);

-- "Fan out to all of this user's devices" — hot path.
create index idx_push_subscriptions_user on public.push_subscriptions(user_id);
-- "All subscriptions in this tenant" — used by tenant-cascade cleanup
-- and admin diagnostics. Cheap because we already need an index here
-- for FK enforcement.
create index idx_push_subscriptions_tenant on public.push_subscriptions(tenant_id);

alter table public.push_subscriptions enable row level security;

-- ── RLS policies ──────────────────────────────────────────────────
-- Insert / select / delete only — no update policy because rotating
-- a subscription is delete + insert (different endpoint = different row).

create policy push_subscriptions_select_own
  on public.push_subscriptions
  for select
  to authenticated
  using (user_id = auth.uid());

create policy push_subscriptions_insert_own
  on public.push_subscriptions
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy push_subscriptions_delete_own
  on public.push_subscriptions
  for delete
  to authenticated
  using (user_id = auth.uid());

-- The Edge Function reads cross-user via the service role bypass — no
-- RLS policy required for that path. Document here so future readers
-- don't add a "service can read all" policy thinking it's missing.

comment on table public.push_subscriptions is
  'STORY-053b — Web Push endpoints, one row per (user, device).';
comment on column public.push_subscriptions.keys is
  'Opaque per Web Push spec: { p256dh, auth } as base64-url strings.';
comment on column public.push_subscriptions.device_label is
  'UI label shown in /dashboard/settings. Parsed from UA at subscribe.';
