-- Lock down the Verify-JWT-OFF SMS dispatcher and make credit consumption
-- The 14-digit prefix is a unique Supabase CLI migration version.
-- atomic across overlapping cron runs and owner test sends.

create table if not exists public.edge_cron_secrets (
  name text primary key,
  secret text not null check (char_length(secret) >= 64),
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

alter table public.edge_cron_secrets enable row level security;
alter table public.edge_cron_secrets force row level security;
revoke all on table public.edge_cron_secrets
  from public, anon, authenticated;
grant select on table public.edge_cron_secrets to service_role;

insert into public.edge_cron_secrets (name, secret)
values ('send_sms', encode(gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

insert into public.edge_cron_secrets (name, secret)
values ('account-delete-cleanup', encode(gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

create or replace function public.reserve_sms_credit(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  config_row public.tenant_sms_config%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'SMS credit reservation is service-only'
      using errcode = '42501';
  end if;

  select * into config_row
    from public.tenant_sms_config config
   where config.tenant_id = p_tenant_id
     and config.enabled
   for update;

  if not found then
    return null;
  end if;

  if config_row.free_sms_remaining > 0 then
    update public.tenant_sms_config config
       set free_sms_remaining = config.free_sms_remaining - 1,
           total_sent_count = config.total_sent_count + 1
     where config.tenant_id = p_tenant_id;
    return 'free';
  end if;

  if config_row.balance_cents >= 10 then
    update public.tenant_sms_config config
       set balance_cents = config.balance_cents - 10,
           total_sent_count = config.total_sent_count + 1
     where config.tenant_id = p_tenant_id;
    return 'paid';
  end if;

  return null;
end;
$function$;

create or replace function public.release_sms_credit(
  p_tenant_id uuid,
  p_charge text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'SMS credit release is service-only'
      using errcode = '42501';
  end if;
  if p_charge not in ('free', 'paid') then
    raise exception 'Unknown SMS credit charge'
      using errcode = '22023';
  end if;

  update public.tenant_sms_config config
     set free_sms_remaining = config.free_sms_remaining
           + case when p_charge = 'free' then 1 else 0 end,
         balance_cents = config.balance_cents
           + case when p_charge = 'paid' then 10 else 0 end,
         total_sent_count = greatest(config.total_sent_count - 1, 0)
   where config.tenant_id = p_tenant_id;

  if not found then
    raise exception 'SMS configuration disappeared during credit release';
  end if;
end;
$function$;

revoke all on function public.reserve_sms_credit(uuid)
  from public, anon, authenticated;
revoke all on function public.release_sms_credit(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reserve_sms_credit(uuid) to service_role;
grant execute on function public.release_sms_credit(uuid, text) to service_role;

-- Replace the historical unauthenticated heartbeat. The secret is generated
-- in Postgres, never granted to API roles, and read by the Edge Function only
-- through its service-role client.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sms_reminder_check') then
    perform cron.unschedule('sms_reminder_check');
  end if;
end;
$$;

select cron.schedule(
  'sms_reminder_check',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url     := 'https://rdtokosbqvgemicqeqwz.supabase.co/functions/v1/send_sms',
      body    := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (
          select secret
            from public.edge_cron_secrets
           where name = 'send_sms'
        )
      )
    );
  $cron$
);

-- Retry cleanup records left after a transient Auth Admin or tenant-cascade
-- failure. The public account-delete endpoint remains JWT-gated; this separate
-- worker accepts only the database-held secret and atomically leases rows via
-- claim_account_deletion_cleanup().
do $$
begin
  if exists (
    select 1
      from cron.job
     where jobname = 'account_deletion_cleanup_retry'
  ) then
    perform cron.unschedule('account_deletion_cleanup_retry');
  end if;
end;
$$;

select cron.schedule(
  'account_deletion_cleanup_retry',
  '*/15 * * * *',
  $cron$
    select net.http_post(
      url     := 'https://rdtokosbqvgemicqeqwz.supabase.co/functions/v1/account-delete-cleanup',
      body    := '{"mode":"retry"}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cleanup-secret', (
          select secret
            from public.edge_cron_secrets
           where name = 'account-delete-cleanup'
        )
      )
    );
  $cron$
);

do $audit$
begin
  if has_table_privilege(
       'authenticated', 'public.edge_cron_secrets', 'SELECT'
     )
     or has_table_privilege('anon', 'public.edge_cron_secrets', 'SELECT')
     or has_function_privilege(
       'authenticated', 'public.reserve_sms_credit(uuid)', 'EXECUTE'
     )
     or has_function_privilege(
       'authenticated', 'public.release_sms_credit(uuid,text)', 'EXECUTE'
     ) then
    raise exception 'SMS dispatcher hardening leaked a service-only capability';
  end if;

  if not exists (
    select 1
      from cron.job
     where jobname = 'sms_reminder_check'
       and command like '%x-cron-secret%'
  ) then
    raise exception 'SMS dispatcher cron is not authenticated';
  end if;

  if not exists (
    select 1
      from cron.job
     where jobname = 'account_deletion_cleanup_retry'
       and command like '%x-cleanup-secret%'
       and command like '%account-delete-cleanup%'
  ) then
    raise exception 'Account deletion cleanup cron is not authenticated';
  end if;
end;
$audit$;
