-- ─────────────────────────────────────────────────────────────────────
-- STORY-047 G1 — SMS Hybrid: per-tenant config + history.
--
-- Two tables driving the SMS-reminder pipeline:
--
--   public.tenant_sms_config — one row per tenant, owner-only RLS.
--   public.sms_messages      — append-only history, tenant-scoped reads,
--                              service-role-only writes from Edge Function.
--
-- Mode rationale:
--   - `platform`: tenant uses Babun's shared Twilio account
--                 (Free / Pro tier). Sender shows as "Babun".
--                 Quotas tracked in this row, refreshed monthly via
--                 `quota_period_start` (no extra cron needed —
--                 Edge Function checks the field on every send).
--   - `byok`:     Business tier. Tenant supplies own Twilio
--                 credentials. Sender label is whatever they set
--                 in their Twilio Console (e.g. "AirFix").
--
-- BYOK token storage decision (STORY-047 G0 #1): plaintext column
-- with service-role-only RLS. Postgres-at-rest on Supabase is
-- encrypted; the attack surface is equivalent to Edge Function
-- Secrets where the platform Twilio creds live. Migration to
-- pgsodium / Vault is deferred until ≥3 BYOK tenants + an audit
-- or compliance story justifies the complexity.
--
-- RLS shape mirrors STORY-053b:
--   - explicit `service_role` bypass policies (legacy auto-bypass
--     is gone after the JWT-Signing-Keys migration)
--   - tenant scope via `current_tenant_id()`
--   - role gate via `current_user_role()` for owner-only surfaces
--
-- Webhook lookup hot path: `sms_messages.twilio_sid` is the join key
-- from /api/twilio/status → tenant_sms_config. Indexed UNIQUE so
-- the lookup is O(log n) and the column doubles as an idempotency
-- marker if Twilio retries a status callback.
-- ─────────────────────────────────────────────────────────────────────

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║ tenant_sms_config — per-tenant configuration                      ║
-- ╚═══════════════════════════════════════════════════════════════════╝

create table public.tenant_sms_config (
  tenant_id            uuid        primary key
                                   references public.tenants(id) on delete cascade,
  mode                 text        not null default 'platform'
                                   check (mode in ('platform', 'byok')),
  enabled              boolean     not null default false,

  -- Reminder timing toggles. 24h ON by default; 2h opt-in.
  remind_24h_before    boolean     not null default true,
  remind_2h_before     boolean     not null default false,

  -- Templates (RU). Edit through the Settings UI; placeholders
  -- {client_name} {time} {date} {phone} {business_name} are
  -- substituted server-side in the Edge Function.
  template_24h         text        not null default
    'Здравствуйте, {client_name}! Напоминаем что у Вас завтра в {time} назначен визит. Если что-то изменилось — позвоните нам.',
  template_2h          text        not null default
    'Здравствуйте, {client_name}! Через 2 часа у Вас назначен визит на {time}.',

  -- BYOK fields. NULL when mode='platform'. Edge Function reads
  -- these via service-role JWT; authenticated users cannot SELECT
  -- the token column even with their own tenant_id (RLS below).
  twilio_account_sid     text      null,
  twilio_auth_token      text      null,
  twilio_phone_number    text      null,

  -- Platform-mode quota. `quota_period_start` is set to
  -- date_trunc('month', now()) when sent_this_month is incremented;
  -- the Edge Function compares against the current month's start
  -- and resets the counter if a month has elapsed. No separate
  -- janitor cron needed.
  sent_this_month        integer   not null default 0,
  free_quota_per_month   integer   not null default 50,
  quota_period_start     timestamptz not null default date_trunc('month', now()),

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- BYOK requires all three credential fields when mode='byok'.
  -- Enforce via a check constraint so a half-configured BYOK row
  -- can't slip past the Settings UI's client-side validation.
  constraint tenant_sms_config_byok_complete
    check (
      mode = 'platform'
      or (
        twilio_account_sid    is not null and twilio_account_sid    <> ''
        and twilio_auth_token   is not null and twilio_auth_token   <> ''
        and twilio_phone_number is not null and twilio_phone_number <> ''
      )
    )
);

create trigger tenant_sms_config_set_updated_at
  before update on public.tenant_sms_config
  for each row execute function public.set_updated_at();

comment on table public.tenant_sms_config is
  'STORY-047 — per-tenant SMS configuration. One row per tenant, '
  'owner-only RLS for select/insert/update. Service-role bypass '
  'lets the send_sms Edge Function read tokens cross-tenant.';
comment on column public.tenant_sms_config.twilio_auth_token is
  'STORY-047 G0 decision: plaintext per service-role-only RLS. '
  'Migrate to pgsodium/Vault when ≥3 BYOK tenants + audit story.';
comment on column public.tenant_sms_config.quota_period_start is
  'Start of the calendar month sent_this_month is counting against. '
  'Edge Function checks date_trunc(month, now()) > this and resets '
  'the counter on the next send instead of running a separate cron.';

-- ── RLS ───────────────────────────────────────────────────────────
alter table public.tenant_sms_config enable row level security;

-- IMPORTANT: there is intentionally NO `for select to authenticated`
-- policy on this table.
--
-- Threat model: an Owner JWT compromised via XSS / session hijack
-- could otherwise SELECT * via PostgREST and silently exfiltrate
-- twilio_auth_token, then send fraudulent SMS off-platform on the
-- tenant's account. Industry-standard pattern (Stripe, Twilio,
-- AWS) is "never expose a secret after creation". So:
--
--   * Owners read this table only through the security-definer
--     function `read_tenant_sms_config_safe()` defined below — it
--     returns `twilio_auth_token_configured` (boolean) instead of
--     the raw token. Settings UI binds to that.
--   * Owners CAN still INSERT / UPDATE the token (they could before;
--     a compromised JWT can overwrite as easily as read). The fix
--     here closes only the silent-extract attack, which is the
--     bigger of the two by orders of magnitude.
--   * Settings UI must use `Prefer: return=minimal` on its UPSERTs
--     so PostgREST doesn't try to read the row back through the
--     missing SELECT policy and 406 the request.
--   * The send_sms Edge Function reads via service_role JWT and
--     bypasses RLS entirely — that path is unaffected.

create policy tenant_sms_config_owner_insert
  on public.tenant_sms_config
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

create policy tenant_sms_config_owner_update
  on public.tenant_sms_config
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

-- No DELETE policy: the row lives and dies with the tenant via
-- ON DELETE CASCADE. Owners can disable SMS via `enabled=false`,
-- not by row deletion.

-- Service-role bypass — required after the JWT-Signing-Keys
-- migration so the send_sms Edge Function can read tokens
-- cross-tenant during the cron sweep.
grant all on public.tenant_sms_config to service_role;

create policy tenant_sms_config_service_role_all
  on public.tenant_sms_config
  for all to service_role
  using (true) with check (true);

comment on policy tenant_sms_config_service_role_all
  on public.tenant_sms_config is
  'STORY-047 — explicit RLS bypass for the send_sms Edge Function. '
  'Required after Supabase JWT-Signing-Keys migration.';

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║ sms_messages — append-only history                                ║
-- ╚═══════════════════════════════════════════════════════════════════╝

create table public.sms_messages (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references public.tenants(id) on delete cascade,

  -- Soft links — history survives appointment + client deletion so
  -- a billing dispute or audit still has the rendered SMS body and
  -- the recipient phone (denormalized below).
  appointment_id  uuid        null references public.appointments(id) on delete set null,
  client_id       uuid        null references public.clients(id)      on delete set null,

  to_phone        text        not null,
  message_body    text        not null,

  -- Twilio's MessageSid. NULL until the API call returns. Doubles
  -- as a webhook idempotency key — UNIQUE so a retried Twilio
  -- status callback can't insert two rows.
  twilio_sid      text        null unique,

  status          text        not null
                              check (status in ('queued', 'sent', 'delivered', 'failed', 'undelivered')),
  error_code      text        null,
  error_message   text        null,

  trigger_type    text        not null
                              check (trigger_type in ('reminder_24h', 'reminder_2h', 'manual', 'test')),
  -- Mode at the time of send — copied from tenant_sms_config so
  -- billing/audit isn't broken if a tenant later switches modes.
  mode            text        not null check (mode in ('platform', 'byok')),

  created_at      timestamptz not null default now(),
  delivered_at    timestamptz null
);

-- Tenant history: Settings UI lists 50 latest, filterable by status.
create index idx_sms_messages_tenant_created
  on public.sms_messages(tenant_id, created_at desc);

-- Status filter is fast on top of the tenant index above, but a
-- partial index on `failed` rows speeds up the "show me everything
-- that didn't work" admin filter without bloating the regular index.
create index idx_sms_messages_failed
  on public.sms_messages(tenant_id, created_at desc)
  where status in ('failed', 'undelivered');

-- Idempotency check during cron: "did we already enqueue a
-- reminder_24h for this appointment?" The send_sms Edge Function
-- guards against duplicate sends with this lookup before calling
-- Twilio. NULL appointment_id rows (manual / test sends) are
-- excluded from the index so manual debug sends don't mis-collide.
create unique index uniq_sms_messages_appointment_trigger
  on public.sms_messages(appointment_id, trigger_type)
  where appointment_id is not null;

comment on table public.sms_messages is
  'STORY-047 — append-only SMS history, one row per attempted send. '
  'Tenant-scoped reads for the Settings UI; service-role-only writes '
  'from the send_sms Edge Function and the Twilio status webhook.';
comment on column public.sms_messages.to_phone is
  'Denormalized recipient phone — survives client deletion so the '
  'history page can still show "+357 99 ...".';
comment on column public.sms_messages.twilio_sid is
  'Twilio MessageSid; UNIQUE so a retried webhook idempotently '
  'updates the same row. NULL for never-dispatched rows '
  '(quota_exceeded etc.).';

-- ── RLS ───────────────────────────────────────────────────────────
alter table public.sms_messages enable row level security;

-- Any user in the tenant can SELECT the history (Settings UI list).
-- Owner-only for the config row, but viewing what already went out
-- is fine for any role — it's analogous to a chat log.
create policy sms_messages_tenant_select
  on public.sms_messages
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- Authenticated users CANNOT insert / update / delete — only the
-- Edge Function can. No policies for those verbs → RLS denies.

grant all on public.sms_messages to service_role;

create policy sms_messages_service_role_all
  on public.sms_messages
  for all to service_role
  using (true) with check (true);

comment on policy sms_messages_service_role_all
  on public.sms_messages is
  'STORY-047 — Edge Function inserts/updates rows. Required after '
  'Supabase JWT-Signing-Keys migration removed legacy auto-bypass.';

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║ Owner-safe read function — PostgREST uses this instead of SELECT  ║
-- ╚═══════════════════════════════════════════════════════════════════╝
-- Settings UI calls supabase.rpc('read_tenant_sms_config_safe').
-- Returns every column EXCEPT twilio_auth_token; that column is
-- replaced with `twilio_auth_token_configured` (boolean: NOT NULL
-- AND non-empty). Owners learn whether BYOK is configured without
-- ever seeing the secret in flight again.
--
-- Auth: SECURITY DEFINER + an explicit `current_user_role() = 'owner'`
-- gate inside the body. Non-owners get an empty result via the
-- exception → 401 PostgREST error. (Anonymous users can't reach
-- it anyway because EXECUTE is granted only to authenticated.)

create or replace function public.read_tenant_sms_config_safe()
returns table (
  tenant_id                    uuid,
  mode                         text,
  enabled                      boolean,
  remind_24h_before            boolean,
  remind_2h_before             boolean,
  template_24h                 text,
  template_2h                  text,
  twilio_account_sid           text,
  twilio_phone_number          text,
  twilio_auth_token_configured boolean,
  sent_this_month              integer,
  free_quota_per_month         integer,
  quota_period_start           timestamptz,
  created_at                   timestamptz,
  updated_at                   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() is distinct from 'owner' then
    raise exception 'unauthorized: owner role required for SMS config'
      using errcode = '42501';
  end if;

  return query
    select
      t.tenant_id,
      t.mode,
      t.enabled,
      t.remind_24h_before,
      t.remind_2h_before,
      t.template_24h,
      t.template_2h,
      t.twilio_account_sid,
      t.twilio_phone_number,
      (t.twilio_auth_token is not null and length(t.twilio_auth_token) > 0)
        as twilio_auth_token_configured,
      t.sent_this_month,
      t.free_quota_per_month,
      t.quota_period_start,
      t.created_at,
      t.updated_at
    from public.tenant_sms_config t
   where t.tenant_id = public.current_tenant_id();
end;
$$;

revoke all on function public.read_tenant_sms_config_safe() from public;
grant execute on function public.read_tenant_sms_config_safe() to authenticated;

comment on function public.read_tenant_sms_config_safe() is
  'STORY-047 — owner-only read of tenant_sms_config that hides the '
  'twilio_auth_token. Settings UI binds to this RPC instead of the '
  'table to keep the BYOK secret unexfiltrable from a compromised '
  'JWT (write paths are still allowed; only silent-extract is closed).';

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║ Master switch in app_settings (mirror of push_enabled)            ║
-- ╚═══════════════════════════════════════════════════════════════════╝
-- Whole pipeline is inert until this row flips to 'on'. Safe to
-- ship the cron + Edge Function in skeleton mode; nothing fires.
insert into public.app_settings (key, value)
  values ('sms_enabled', 'off')
  on conflict (key) do nothing;
