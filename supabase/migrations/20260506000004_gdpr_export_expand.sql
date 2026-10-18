-- ─────────────────────────────────────────────────────────────────────
-- STORY-078 — Expand tenant_data_export() to cover every table that
-- holds tenant-scoped user data.
--
-- Code review (iter 1, issue #3) found the original RPC dumped only:
--   tenants, clients, appointments, masters, brigades, sms_logs,
--   sms_topups, calendar_settings, tenant_sms_config
--
-- Missing — and re-added below:
--   client_tags, client_tag_assignments
--   appointment_photos
--   recurring_reminders
--   team_schedules
--   day_cities, day_extras
--   tenant_members, invitations
--   sms_messages           (real message bodies sent — different from sms_logs)
--   billing_events         (Stripe state-transition audit)
--   push_subscriptions     (PWA push endpoints)
--
-- Each is wrapped in a `to_regclass(...) is not null` guard so the
-- export degrades cleanly on environments where some tables haven't
-- been created yet (CI / branch DB).
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.tenant_data_export()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_role      text := public.current_user_role();
  v_clients         json;
  v_client_tags     json;
  v_client_tag_assg json;
  v_appts           json;
  v_appt_photos     json;
  v_recurring       json;
  v_masters         json;
  v_brigades        json;
  v_team_schedules  json;
  v_day_cities      json;
  v_day_extras      json;
  v_tenant_members  json;
  v_invitations     json;
  v_sms_messages    json;
  v_sms_logs        json;
  v_topups          json;
  v_billing_events  json;
  v_push_subs       json;
  v_settings        json;
  v_tenant          json;
begin
  if v_tenant_id is null then
    return json_build_object('error', 'no_tenant');
  end if;
  if v_role <> 'owner' then
    return json_build_object('error', 'owner_only');
  end if;

  -- Tenant row (full).
  select row_to_json(t)
    into v_tenant
    from (
      select * from public.tenants where id = v_tenant_id
    ) t;

  -- Always-present tables.
  select coalesce(json_agg(row_to_json(c)), '[]'::json)
    into v_clients
    from public.clients c
    where c.tenant_id = v_tenant_id;

  select coalesce(json_agg(row_to_json(a)), '[]'::json)
    into v_appts
    from public.appointments a
    where a.tenant_id = v_tenant_id;

  -- Conditionally-present tables (degrade cleanly on branch DBs).
  if to_regclass('public.client_tags') is not null then
    execute 'select coalesce(json_agg(row_to_json(t)), ''[]''::json) from public.client_tags t where t.tenant_id = $1'
      into v_client_tags using v_tenant_id;
  else v_client_tags := '[]'::json; end if;

  if to_regclass('public.client_tag_assignments') is not null then
    execute 'select coalesce(json_agg(row_to_json(a)), ''[]''::json) from public.client_tag_assignments a join public.clients c on c.id = a.client_id where c.tenant_id = $1'
      into v_client_tag_assg using v_tenant_id;
  else v_client_tag_assg := '[]'::json; end if;

  if to_regclass('public.appointment_photos') is not null then
    execute 'select coalesce(json_agg(row_to_json(p)), ''[]''::json) from public.appointment_photos p where p.tenant_id = $1'
      into v_appt_photos using v_tenant_id;
  else v_appt_photos := '[]'::json; end if;

  if to_regclass('public.recurring_reminders') is not null then
    execute 'select coalesce(json_agg(row_to_json(r)), ''[]''::json) from public.recurring_reminders r where r.tenant_id = $1'
      into v_recurring using v_tenant_id;
  else v_recurring := '[]'::json; end if;

  if to_regclass('public.masters') is not null then
    execute 'select coalesce(json_agg(row_to_json(m)), ''[]''::json) from public.masters m where m.tenant_id = $1'
      into v_masters using v_tenant_id;
  else v_masters := '[]'::json; end if;

  if to_regclass('public.brigades') is not null then
    execute 'select coalesce(json_agg(row_to_json(b)), ''[]''::json) from public.brigades b where b.tenant_id = $1'
      into v_brigades using v_tenant_id;
  else v_brigades := '[]'::json; end if;

  if to_regclass('public.team_schedules') is not null then
    execute 'select coalesce(json_agg(row_to_json(s)), ''[]''::json) from public.team_schedules s where s.tenant_id = $1'
      into v_team_schedules using v_tenant_id;
  else v_team_schedules := '[]'::json; end if;

  if to_regclass('public.day_cities') is not null then
    execute 'select coalesce(json_agg(row_to_json(d)), ''[]''::json) from public.day_cities d where d.tenant_id = $1'
      into v_day_cities using v_tenant_id;
  else v_day_cities := '[]'::json; end if;

  if to_regclass('public.day_extras') is not null then
    execute 'select coalesce(json_agg(row_to_json(d)), ''[]''::json) from public.day_extras d where d.tenant_id = $1'
      into v_day_extras using v_tenant_id;
  else v_day_extras := '[]'::json; end if;

  if to_regclass('public.tenant_members') is not null then
    execute 'select coalesce(json_agg(row_to_json(m)), ''[]''::json) from public.tenant_members m where m.tenant_id = $1'
      into v_tenant_members using v_tenant_id;
  else v_tenant_members := '[]'::json; end if;

  if to_regclass('public.invitations') is not null then
    execute 'select coalesce(json_agg(row_to_json(i)), ''[]''::json) from public.invitations i where i.tenant_id = $1'
      into v_invitations using v_tenant_id;
  else v_invitations := '[]'::json; end if;

  if to_regclass('public.sms_messages') is not null then
    execute 'select coalesce(json_agg(row_to_json(m)), ''[]''::json) from public.sms_messages m where m.tenant_id = $1'
      into v_sms_messages using v_tenant_id;
  else v_sms_messages := '[]'::json; end if;

  if to_regclass('public.sms_logs') is not null then
    execute 'select coalesce(json_agg(row_to_json(l)), ''[]''::json) from public.sms_logs l where l.tenant_id = $1'
      into v_sms_logs using v_tenant_id;
  else v_sms_logs := '[]'::json; end if;

  if to_regclass('public.sms_topups') is not null then
    execute 'select coalesce(json_agg(row_to_json(t)), ''[]''::json) from public.sms_topups t where t.tenant_id = $1'
      into v_topups using v_tenant_id;
  else v_topups := '[]'::json; end if;

  if to_regclass('public.billing_events') is not null then
    execute 'select coalesce(json_agg(row_to_json(b)), ''[]''::json) from public.billing_events b where b.tenant_id = $1'
      into v_billing_events using v_tenant_id;
  else v_billing_events := '[]'::json; end if;

  if to_regclass('public.push_subscriptions') is not null then
    execute 'select coalesce(json_agg(row_to_json(p)), ''[]''::json) from public.push_subscriptions p where p.tenant_id = $1'
      into v_push_subs using v_tenant_id;
  else v_push_subs := '[]'::json; end if;

  -- Settings collection.
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
    'export_version', 2,
    'tenant', v_tenant,
    'clients', v_clients,
    'client_tags', v_client_tags,
    'client_tag_assignments', v_client_tag_assg,
    'appointments', v_appts,
    'appointment_photos', v_appt_photos,
    'recurring_reminders', v_recurring,
    'masters', v_masters,
    'brigades', v_brigades,
    'team_schedules', v_team_schedules,
    'day_cities', v_day_cities,
    'day_extras', v_day_extras,
    'tenant_members', v_tenant_members,
    'invitations', v_invitations,
    'sms_messages', v_sms_messages,
    'sms_logs', v_sms_logs,
    'sms_topups', v_topups,
    'billing_events', v_billing_events,
    'push_subscriptions', v_push_subs,
    'settings', v_settings
  );
end;
$$;

revoke all on function public.tenant_data_export() from public;
grant execute on function public.tenant_data_export() to authenticated;

comment on function public.tenant_data_export is
  'STORY-078 (was 071) GDPR Article 20 — owner-only JSON dump of '
  'every tenant-scoped row. Wired to Settings → Account → Скачать '
  'данные (JSON). Bumped to version 2 with full table coverage '
  '(client_tags, photos, recurring, schedules, day_cities, day_extras, '
  'tenant_members, invitations, sms_messages, billing_events, '
  'push_subscriptions).';
