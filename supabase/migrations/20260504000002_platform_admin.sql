-- ─────────────────────────────────────────────────────────────────────
-- STORY-070 — Platform admin layer.
--
-- Babun's owner needs a separate admin surface (under /admin) to:
--   * View / search / filter tenants
--   * Override plans (e.g. AirFix lifetime)
--   * Approve or reject Sender ID requests
--   * Inspect billing events + SMS top-ups
--
-- Auth model: a separate `platform_admins` table — distinct from
-- tenant_members.role. A user can be both a tenant owner AND a
-- platform admin, or one of the two, or neither. The two role
-- spaces don't intersect; tenant owner = controls one tenant,
-- platform admin = controls the whole platform.
--
-- Bootstrap: this migration inserts the founder by email. If the
-- email doesn't yet exist in auth.users (user hasn't signed up),
-- the INSERT silently no-ops and the user can grant themselves
-- after first login via:
--   select public.add_platform_admin('giluta.art@gmail.com');
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null,
  notes      text
);

comment on table public.platform_admins is
  'STORY-070 — platform-level admin grants. Distinct from '
  'tenant_members.role (which is tenant-scoped). Members of this '
  'table can read/write any tenant via service-role bypass policies '
  'invoked from /admin server actions.';

-- ── Helper: is_platform_admin() ───────────────────────────────────
-- SECURITY DEFINER so leaf code can short-circuit cheaply without
-- needing a service-role client. Returns false for unauthenticated
-- requests (auth.uid() is null then).
create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins where user_id = auth.uid()
  );
$$;

revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;

-- ── Helper: add_platform_admin(email) ─────────────────────────────
-- Run from SQL editor as a one-shot bootstrap; keeps the founder's
-- user_id out of source control. No-op if email isn't found —
-- caller can re-run after signup. Idempotent.
create or replace function public.add_platform_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where email = p_email;
  if v_user_id is null then
    raise notice 'add_platform_admin: user with email % not found', p_email;
    return;
  end if;
  insert into public.platform_admins (user_id, granted_by, notes)
    values (v_user_id, v_user_id, 'bootstrap via add_platform_admin')
    on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.add_platform_admin(text) from public;
-- Intentionally NOT granted to authenticated — only superuser /
-- service_role can call this (via Supabase SQL editor or migrations).

-- Bootstrap the founder. Email matches `userEmail` from the project
-- CLAUDE.md auto-memory (giluta.art@gmail.com). No-op if not signed
-- up yet — re-run via SELECT add_platform_admin(...).
do $$
begin
  perform public.add_platform_admin('giluta.art@gmail.com');
  perform public.add_platform_admin('anubis0027@gmail.com'); -- second test account from screenshots
end $$;

-- ── RLS — platform_admins itself is admin-only ───────────────────
alter table public.platform_admins enable row level security;

-- Platform admins can SELECT the table to render the team list.
-- Other authenticated users get nothing (the table is invisible).
create policy platform_admins_select_admin
  on public.platform_admins for select to authenticated
  using (public.is_platform_admin());

-- service_role full access (for the admin server actions which run
-- server-side mutations against any tenant).
create policy platform_admins_service_role
  on public.platform_admins for all to service_role
  using (true) with check (true);

-- ── RPC: admin_dashboard_summary() ────────────────────────────────
-- Single round-trip for /admin landing. Returns a json blob with
-- the four-five tiles the dashboard cares about. Owner-gated.
create or replace function public.admin_dashboard_summary()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_tenants    integer;
  v_paid_tenants     integer;
  v_pending_senders  integer;
  v_sms_today        integer;
  v_topups_total_eur numeric;
begin
  if not public.is_platform_admin() then
    return json_build_object('error', 'forbidden');
  end if;

  select count(*) into v_total_tenants from public.tenants;

  select count(*) into v_paid_tenants
    from public.tenants
    where plan in ('pro', 'business')
       or plan_override in ('pro', 'business', 'lifetime');

  select count(*) into v_pending_senders
    from public.tenant_sms_config
    where sender_status = 'pending';

  select count(*) into v_sms_today
    from public.sms_logs
    where created_at >= date_trunc('day', now());

  select coalesce(sum(amount_cents), 0) / 100.0 into v_topups_total_eur
    from public.sms_topups
    where status = 'completed';

  return json_build_object(
    'total_tenants', v_total_tenants,
    'paid_tenants', v_paid_tenants,
    'pending_senders', v_pending_senders,
    'sms_today', v_sms_today,
    'topups_total_eur', v_topups_total_eur
  );
end;
$$;

revoke all on function public.admin_dashboard_summary() from public;
grant execute on function public.admin_dashboard_summary() to authenticated;

-- ── RPC: admin_tenants_list() ─────────────────────────────────────
-- Paginated tenant list with search + plan filter. Joins owner
-- email + key SMS state for at-a-glance row.
create or replace function public.admin_tenants_list(
  p_search text default null,
  p_plan_filter text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows json;
begin
  if not public.is_platform_admin() then
    return json_build_object('error', 'forbidden');
  end if;

  with members as (
    select tm.tenant_id, u.email, tm.role
    from public.tenant_members tm
    join auth.users u on u.id = tm.user_id
    where tm.role = 'owner'
  ),
  joined as (
    select
      t.id,
      t.name,
      t.plan,
      t.plan_override,
      t.created_at,
      m.email as owner_email,
      sc.sender_name,
      sc.sender_status,
      sc.balance_cents,
      sc.free_sms_remaining,
      sc.total_sent_count,
      (select count(*) from public.appointments a where a.tenant_id = t.id)
        as appointment_count,
      (select count(*) from public.clients c where c.tenant_id = t.id)
        as client_count
    from public.tenants t
    left join members m on m.tenant_id = t.id
    left join public.tenant_sms_config sc on sc.tenant_id = t.id
    where (
      p_search is null or p_search = ''
      or t.name ilike '%' || p_search || '%'
      or m.email ilike '%' || p_search || '%'
    )
    and (
      p_plan_filter is null or p_plan_filter = ''
      or t.plan = p_plan_filter
      or t.plan_override = p_plan_filter
    )
    order by t.created_at desc
    limit p_limit offset p_offset
  )
  select coalesce(json_agg(row_to_json(joined)), '[]'::json) into v_rows
    from joined;

  return v_rows;
end;
$$;

revoke all on function public.admin_tenants_list(text, text, integer, integer) from public;
grant execute on function public.admin_tenants_list(text, text, integer, integer) to authenticated;

-- ── RPC: admin_tenant_detail(tenant_id) ───────────────────────────
create or replace function public.admin_tenant_detail(p_tenant_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant       json;
  v_owner_email  text;
  v_sms          json;
  v_recent_logs  json;
  v_topups       json;
  v_billing      json;
begin
  if not public.is_platform_admin() then
    return json_build_object('error', 'forbidden');
  end if;

  select row_to_json(t) into v_tenant
    from (
      select id, name, vertical, city, plan, plan_override,
             stripe_customer_id, stripe_subscription_id,
             subscription_status, current_period_end, created_at
      from public.tenants where id = p_tenant_id
    ) t;
  if v_tenant is null then
    return json_build_object('error', 'not_found');
  end if;

  select u.email into v_owner_email
    from public.tenant_members tm
    join auth.users u on u.id = tm.user_id
    where tm.tenant_id = p_tenant_id and tm.role = 'owner'
    order by tm.joined_at asc
    limit 1;

  select row_to_json(s) into v_sms
    from (
      select sender_name, sender_status, sender_requested_at,
             sender_approved_at, sender_rejection_reason,
             balance_cents, free_sms_remaining, total_sent_count,
             enabled
      from public.tenant_sms_config where tenant_id = p_tenant_id
    ) s;

  select coalesce(json_agg(row_to_json(l) order by l.created_at desc), '[]'::json)
    into v_recent_logs
    from (
      select id, to_phone, body, sender_name_used, cost_cents,
             was_free, twilio_status, error_message, created_at
      from public.sms_logs
      where tenant_id = p_tenant_id
      order by created_at desc
      limit 20
    ) l;

  select coalesce(json_agg(row_to_json(tp) order by tp.created_at desc), '[]'::json)
    into v_topups
    from (
      select id, amount_cents, credits_added, pack_label,
             status, created_at, completed_at
      from public.sms_topups
      where tenant_id = p_tenant_id
      order by created_at desc
      limit 20
    ) tp;

  select coalesce(json_agg(row_to_json(be) order by be.created_at desc), '[]'::json)
    into v_billing
    from (
      select id, event_type, stripe_event_id, payload, created_at
      from public.billing_events
      where tenant_id = p_tenant_id
      order by created_at desc
      limit 20
    ) be;

  return json_build_object(
    'tenant', v_tenant,
    'owner_email', v_owner_email,
    'sms', v_sms,
    'recent_logs', v_recent_logs,
    'topups', v_topups,
    'billing_events', v_billing
  );
end;
$$;

revoke all on function public.admin_tenant_detail(uuid) from public;
grant execute on function public.admin_tenant_detail(uuid) to authenticated;

-- ── RPC: admin_pending_senders() ──────────────────────────────────
create or replace function public.admin_pending_senders()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_rows json;
begin
  if not public.is_platform_admin() then
    return json_build_object('error', 'forbidden');
  end if;

  select coalesce(json_agg(row_to_json(j) order by j.sender_requested_at asc), '[]'::json)
    into v_rows
    from (
      select
        sc.tenant_id,
        sc.sender_name,
        sc.sender_status,
        sc.sender_requested_at,
        sc.sender_rejection_reason,
        t.name as tenant_name,
        (select email from auth.users
          where id = (
            select user_id from public.tenant_members
            where tenant_id = sc.tenant_id and role = 'owner'
            limit 1
          )) as owner_email
      from public.tenant_sms_config sc
      join public.tenants t on t.id = sc.tenant_id
      where sc.sender_status = 'pending'
    ) j;

  return v_rows;
end;
$$;

revoke all on function public.admin_pending_senders() from public;
grant execute on function public.admin_pending_senders() to authenticated;
