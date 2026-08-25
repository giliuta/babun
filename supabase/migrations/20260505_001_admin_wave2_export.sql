-- ─────────────────────────────────────────────────────────────────────
-- STORY-070 wave 2 + STORY-071 GDPR portability.
--
-- Three new RPCs:
--   * tenant_data_export()      — owner-only dump of every row a tenant owns
--   * admin_billing_history()   — paginated topup + Stripe-event feed (platform-wide)
--   * admin_stats_summary()     — time-series signups / SMS / topup revenue (last N days)
--
-- All SECURITY DEFINER + role-gated at the function entry. RLS isn't
-- enough alone — the platform admin RPCs need to read across tenants
-- which RLS would block. SECURITY DEFINER + an explicit
-- is_platform_admin() check is the same pattern as STORY-070 wave 1.
-- ─────────────────────────────────────────────────────────────────────

-- ── tenant_data_export() ─────────────────────────────────────────
-- GDPR right-to-portability. Returns a JSON envelope with every row
-- the tenant "owns" (clients, appointments, masters, brigades,
-- sms logs, topups, settings). Excludes sister-tenant data — caller
-- can only export their OWN tenant's slice.
--
-- Owner-only. Other team members get an error so a junior dispatcher
-- can't dump the customer list and walk out with it.
create or replace function public.tenant_data_export()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_role      text := public.current_user_role();
  v_clients   json;
  v_appts     json;
  v_masters   json;
  v_brigades  json;
  v_sms_logs  json;
  v_topups    json;
  v_settings  json;
  v_tenant    json;
begin
  if v_tenant_id is null then
    return json_build_object('error', 'no_tenant');
  end if;
  if v_role <> 'owner' then
    return json_build_object('error', 'owner_only');
  end if;

  select row_to_json(t)
    into v_tenant
    from (
      select id, name, vertical, city, plan, plan_override, created_at
      from public.tenants where id = v_tenant_id
    ) t;

  select coalesce(json_agg(row_to_json(c)), '[]'::json)
    into v_clients
    from public.clients c
    where c.tenant_id = v_tenant_id;

  select coalesce(json_agg(row_to_json(a)), '[]'::json)
    into v_appts
    from public.appointments a
    where a.tenant_id = v_tenant_id;

  -- Masters / brigades may not exist on all tenants — wrap in a
  -- "if-table-exists" guard via to_regclass so the dump degrades
  -- cleanly on older schemas.
  if to_regclass('public.masters') is not null then
    execute 'select coalesce(json_agg(row_to_json(m)), ''[]''::json) from public.masters m where m.tenant_id = $1'
      into v_masters using v_tenant_id;
  else
    v_masters := '[]'::json;
  end if;

  if to_regclass('public.brigades') is not null then
    execute 'select coalesce(json_agg(row_to_json(b)), ''[]''::json) from public.brigades b where b.tenant_id = $1'
      into v_brigades using v_tenant_id;
  else
    v_brigades := '[]'::json;
  end if;

  if to_regclass('public.sms_logs') is not null then
    execute 'select coalesce(json_agg(row_to_json(l)), ''[]''::json) from public.sms_logs l where l.tenant_id = $1'
      into v_sms_logs using v_tenant_id;
  else
    v_sms_logs := '[]'::json;
  end if;

  if to_regclass('public.sms_topups') is not null then
    execute 'select coalesce(json_agg(row_to_json(t)), ''[]''::json) from public.sms_topups t where t.tenant_id = $1'
      into v_topups using v_tenant_id;
  else
    v_topups := '[]'::json;
  end if;

  -- Settings collection — calendar / sms / cities / booking labels.
  select json_build_object(
    'calendar_settings', (
      select row_to_json(s) from public.calendar_settings s
      where s.tenant_id = v_tenant_id limit 1
    ),
    'tenant_sms_config', (
      select row_to_json(s) from public.tenant_sms_config s
      where s.tenant_id = v_tenant_id limit 1
    )
  )
  into v_settings;

  return json_build_object(
    'exported_at', now(),
    'tenant', v_tenant,
    'clients', v_clients,
    'appointments', v_appts,
    'masters', v_masters,
    'brigades', v_brigades,
    'sms_logs', v_sms_logs,
    'sms_topups', v_topups,
    'settings', v_settings
  );
end;
$$;

revoke all on function public.tenant_data_export() from public;
grant execute on function public.tenant_data_export() to authenticated;

comment on function public.tenant_data_export is
  'STORY-071 GDPR — owner-only JSON dump of every row in the calling tenant. '
  'Wired to Settings → Account → "Экспорт данных" download button.';

-- ── admin_billing_history() ──────────────────────────────────────
-- Paginated platform-wide list of payment events: SMS topups +
-- Stripe billing events joined with tenant + owner email.
create or replace function public.admin_billing_history(
  p_limit  integer default 50,
  p_offset integer default 0
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_topups  json;
  v_events  json;
begin
  if not public.is_platform_admin() then
    return json_build_object('error', 'forbidden');
  end if;

  -- Recent topups joined with tenant name + owner.
  select coalesce(json_agg(row_to_json(r)), '[]'::json)
  into v_topups
  from (
    select
      tp.id,
      tp.tenant_id,
      t.name as tenant_name,
      tp.amount_cents,
      tp.credits_added,
      tp.pack_label,
      tp.status,
      tp.stripe_session_id,
      tp.stripe_payment_intent_id,
      tp.created_at,
      tp.completed_at
    from public.sms_topups tp
    left join public.tenants t on t.id = tp.tenant_id
    order by tp.created_at desc
    limit p_limit offset p_offset
  ) r;

  -- Recent billing events (subscription state transitions).
  if to_regclass('public.billing_events') is not null then
    execute $sql$
      select coalesce(json_agg(row_to_json(r)), '[]'::json)
      from (
        select
          be.id,
          be.tenant_id,
          t.name as tenant_name,
          be.event_type,
          be.stripe_event_id,
          be.created_at
        from public.billing_events be
        left join public.tenants t on t.id = be.tenant_id
        order by be.created_at desc
        limit $1 offset $2
      ) r
    $sql$
    into v_events using p_limit, p_offset;
  else
    v_events := '[]'::json;
  end if;

  return json_build_object(
    'topups', v_topups,
    'events', v_events
  );
end;
$$;

revoke all on function public.admin_billing_history(integer, integer) from public;
grant execute on function public.admin_billing_history(integer, integer) to authenticated;

-- ── admin_stats_summary() ────────────────────────────────────────
-- Time-series numbers for the last p_days. Returns three series:
--   * signups_by_day   — tenants created per day
--   * sms_by_day       — sms_logs created per day
--   * topup_eur_by_day — sum of completed topups in EUR per day
create or replace function public.admin_stats_summary(p_days integer default 30)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signups   json;
  v_sms       json;
  v_topup     json;
  v_mrr_cents integer;
  v_paid_count integer;
begin
  if not public.is_platform_admin() then
    return json_build_object('error', 'forbidden');
  end if;

  -- Signups per day.
  select coalesce(json_agg(row_to_json(r) order by r.day), '[]'::json)
  into v_signups
  from (
    select date_trunc('day', created_at)::date as day, count(*)::int as count
    from public.tenants
    where created_at >= now() - (p_days || ' days')::interval
    group by 1
  ) r;

  -- SMS per day (all sends, including failed).
  if to_regclass('public.sms_logs') is not null then
    execute $sql$
      select coalesce(json_agg(row_to_json(r) order by r.day), '[]'::json)
      from (
        select date_trunc('day', created_at)::date as day, count(*)::int as count
        from public.sms_logs
        where created_at >= now() - ($1 || ' days')::interval
        group by 1
      ) r
    $sql$
    into v_sms using p_days;
  else
    v_sms := '[]'::json;
  end if;

  -- Topup revenue per day (completed only).
  if to_regclass('public.sms_topups') is not null then
    execute $sql$
      select coalesce(json_agg(row_to_json(r) order by r.day), '[]'::json)
      from (
        select date_trunc('day', created_at)::date as day,
               (sum(amount_cents))::int as cents
        from public.sms_topups
        where status = 'completed'
          and created_at >= now() - ($1 || ' days')::interval
        group by 1
      ) r
    $sql$
    into v_topup using p_days;
  else
    v_topup := '[]'::json;
  end if;

  -- Crude MRR estimate: count tenants on pro/business * fixed price.
  -- For wave-2 stats we read from STRIPE_PRICE env via app code; here
  -- we just count and let the page compute the EUR. Returns counts.
  select count(*) into v_paid_count
    from public.tenants
    where plan in ('pro', 'business')
       or plan_override in ('pro', 'business', 'lifetime');

  v_mrr_cents := 0; -- Computed by app from price IDs.

  return json_build_object(
    'days', p_days,
    'signups_by_day', v_signups,
    'sms_by_day', v_sms,
    'topup_eur_by_day', v_topup,
    'paid_tenants', v_paid_count
  );
end;
$$;

revoke all on function public.admin_stats_summary(integer) from public;
grant execute on function public.admin_stats_summary(integer) to authenticated;

-- ── admin_impersonate_tenant_owner() ─────────────────────────────
-- Returns the owner email for a tenant so the admin UI can ask
-- Supabase to generate a magic-link via the auth admin API server-side.
-- We don't generate the link in SQL — that's an HTTP call to GoTrue.
-- The function exists just to gate the email lookup behind
-- is_platform_admin() so the magic-link flow stays admin-only.
create or replace function public.admin_resolve_tenant_owner_email(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if not public.is_platform_admin() then
    return null;
  end if;

  select u.email
    into v_email
    from public.tenant_members tm
    join auth.users u on u.id = tm.user_id
    where tm.tenant_id = p_tenant_id
      and tm.role = 'owner'
    order by tm.joined_at asc
    limit 1;

  return v_email;
end;
$$;

revoke all on function public.admin_resolve_tenant_owner_email(uuid) from public;
grant execute on function public.admin_resolve_tenant_owner_email(uuid) to authenticated;

comment on function public.admin_resolve_tenant_owner_email is
  'STORY-070 wave 2 — gated email lookup so /admin can call '
  'auth.admin.generateLink() server-side and impersonate via magic link.';
