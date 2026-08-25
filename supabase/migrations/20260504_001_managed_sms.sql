-- ─────────────────────────────────────────────────────────────────────
-- STORY-069 — Managed SMS: per-tenant Sender ID + prepaid balance.
--
-- Architecture flip from STORY-047's BYOK model:
--   * One Twilio account at the platform level (Babun owner's).
--   * Each tenant chooses an Alphanumeric Sender ID (e.g. "AirFix")
--     which the owner registers on the platform Twilio account.
--   * Tenant tops up a balance via Stripe Checkout; outgoing SMS
--     deduct from balance.
--   * 10 free SMS on signup, sent from the platform's default
--     sender ("Babun"), so new tenants can validate the channel
--     before paying.
--
-- BYOK columns (twilio_account_sid / twilio_auth_token /
-- twilio_phone_number) are kept on tenant_sms_config for backward
-- compatibility with existing test rows. New tenants will not use
-- them; the Settings UI hides them.
--
-- Tables shipped here:
--   * tenant_sms_config (extended)
--   * sms_topups        (history + Stripe idempotency)
--   * sms_logs          (per-message log for History UI + audit)
-- ─────────────────────────────────────────────────────────────────────

-- ── Extend tenant_sms_config ──────────────────────────────────────
alter table public.tenant_sms_config
  add column if not exists sender_name text,
  add column if not exists sender_status text
    check (
      sender_status is null
      or sender_status in ('pending', 'approved', 'rejected')
    ),
  add column if not exists sender_requested_at timestamptz,
  add column if not exists sender_approved_at  timestamptz,
  add column if not exists sender_rejection_reason text,

  -- Prepaid balance in cents (EUR). Per-SMS cost is decided
  -- server-side at send time so we can change pricing without a
  -- migration. Default 0; new tenants get free_sms_remaining=10
  -- on signup so they can validate before topping up.
  add column if not exists balance_cents integer not null default 0,
  add column if not exists free_sms_remaining integer not null default 10,
  add column if not exists total_sent_count integer not null default 0;

comment on column public.tenant_sms_config.sender_name is
  'STORY-069 — Alphanumeric Sender ID requested by the tenant. '
  'Empty/null while the tenant is on free trial; populated when '
  'they submit a request from Settings → SMS. Owner approves '
  'manually after registering the Sender ID in Twilio Console.';

comment on column public.tenant_sms_config.balance_cents is
  'STORY-069 — Prepaid SMS balance in EUR cents. Topped up via '
  'Stripe Checkout (sms_topups), debited per-send by send_sms '
  'Edge Function. Hard-block when below per-send cost.';

comment on column public.tenant_sms_config.free_sms_remaining is
  'STORY-069 — Free trial counter. Decremented per send instead of '
  'balance_cents while > 0. Sent from the platform default sender '
  '("Babun") since the tenant has no approved sender yet.';

-- Backfill: existing tenants get the same 10-free grant.
update public.tenant_sms_config
   set free_sms_remaining = greatest(coalesce(free_sms_remaining, 0), 10)
 where free_sms_remaining < 10
   or  free_sms_remaining is null;

-- ── sms_topups ────────────────────────────────────────────────────
-- One row per Stripe payment that credits a tenant's SMS balance.
-- The unique stripe_payment_intent_id gives webhook idempotency.
create table if not exists public.sms_topups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Pack metadata at the time of purchase. Recorded from the
  -- Checkout session so future price-card edits don't rewrite
  -- history.
  amount_cents integer not null,
  credits_added integer not null,
  pack_label text not null,

  -- Stripe linkage. Unique to make the webhook handler idempotent.
  stripe_session_id text,
  stripe_payment_intent_id text unique,

  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed', 'refunded')),

  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists sms_topups_tenant_idx
  on public.sms_topups (tenant_id, created_at desc);

comment on table public.sms_topups is
  'STORY-069 — Audit + idempotency log for SMS balance top-ups. '
  'Webhook checks stripe_payment_intent_id uniqueness before '
  'crediting balance_cents on tenant_sms_config.';

-- ── sms_logs ──────────────────────────────────────────────────────
-- Per-message audit row. Drives Settings → SMS → History list and
-- gives ops a paper trail for billing disputes.
create table if not exists public.sms_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Recipient + body at send time. Body kept (not redacted) so
  -- support can debug delivery issues; trim before public exports.
  to_phone text not null,
  body text not null,

  -- Sender used at send time. Captures which name went out — could
  -- differ from current tenant_sms_config.sender_name if the tenant
  -- changed it after this send.
  sender_name_used text not null,

  -- Money: 0 when was_free=true, otherwise the per-send price.
  cost_cents integer not null default 0,
  was_free boolean not null default false,

  -- Twilio side. Populated by Edge Function on send + status webhook.
  twilio_message_sid text,
  twilio_status text,
  error_code text,
  error_message text,

  -- Optional FK for "this SMS belongs to appointment X" — kept text
  -- like the rest of the appointments code; can tighten later.
  appointment_id uuid references public.appointments(id) on delete set null,

  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index if not exists sms_logs_tenant_idx
  on public.sms_logs (tenant_id, created_at desc);

create index if not exists sms_logs_twilio_sid_idx
  on public.sms_logs (twilio_message_sid)
  where twilio_message_sid is not null;

comment on table public.sms_logs is
  'STORY-069 — Per-SMS audit. UI shows the last N for the tenant '
  '(History tab in Settings → SMS). Twilio status webhook updates '
  'twilio_status + delivered_at by twilio_message_sid match.';

-- ── RLS ───────────────────────────────────────────────────────────
alter table public.sms_topups enable row level security;
alter table public.sms_logs    enable row level security;

-- Topups: owner-only read (it's payment history; team members
-- shouldn't see how much the boss spent). service_role full access
-- so the Stripe webhook can insert + flip status to 'completed'.
create policy sms_topups_select_owner
  on public.sms_topups for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

create policy sms_topups_service_role
  on public.sms_topups for all to service_role
  using (true) with check (true);

-- Logs: any tenant member can see (dispatchers debug delivery).
-- service_role for Edge Function inserts + status webhook updates.
create policy sms_logs_select_member
  on public.sms_logs for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy sms_logs_service_role
  on public.sms_logs for all to service_role
  using (true) with check (true);

-- ── Helper: tenant_sms_summary RPC ────────────────────────────────
-- One round-trip from the Settings UI — returns the slice of
-- tenant_sms_config the user is allowed to see + the last 20 logs.
-- Excludes BYOK token columns same as read_tenant_sms_config_safe.
create or replace function public.tenant_sms_summary()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_role      text := public.current_user_role();
  v_config    json;
  v_logs      json;
begin
  if v_tenant_id is null then
    return json_build_object('error', 'no_tenant');
  end if;

  -- Owner sees the full balance picture; team members get sender
  -- name + free counter only (so dispatchers can see "we still
  -- have 7 free SMS left" without the financial column).
  select json_build_object(
    'enabled', t.enabled,
    'sender_name', t.sender_name,
    'sender_status', t.sender_status,
    'sender_requested_at', t.sender_requested_at,
    'sender_approved_at', t.sender_approved_at,
    'free_sms_remaining', t.free_sms_remaining,
    'total_sent_count', t.total_sent_count,
    'balance_cents',
      case when v_role = 'owner' then t.balance_cents else null end,
    'remind_24h_before', t.remind_24h_before,
    'remind_2h_before', t.remind_2h_before,
    'template_24h', t.template_24h,
    'template_2h', t.template_2h
  )
  into v_config
  from public.tenant_sms_config t
  where t.tenant_id = v_tenant_id;

  -- Last 20 sends. Owner-only (other roles get null).
  if v_role = 'owner' then
    select coalesce(json_agg(row_to_json(l) order by l.created_at desc), '[]'::json)
    into v_logs
    from (
      select id, to_phone, body, sender_name_used, cost_cents,
             was_free, twilio_status, error_code, error_message,
             created_at, delivered_at
      from public.sms_logs
      where tenant_id = v_tenant_id
      order by created_at desc
      limit 20
    ) l;
  else
    v_logs := '[]'::json;
  end if;

  return json_build_object(
    'config', coalesce(v_config, 'null'::json),
    'logs', v_logs
  );
end;
$$;

grant execute on function public.tenant_sms_summary() to authenticated;

revoke all on function public.tenant_sms_summary() from public;

comment on function public.tenant_sms_summary is
  'STORY-069 — Settings → SMS one-shot fetch. Returns tenant_sms_config '
  '(minus BYOK token + only owner sees balance_cents) + last 20 sms_logs.';
