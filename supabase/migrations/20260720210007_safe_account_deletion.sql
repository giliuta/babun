-- Fail-safe account deletion for the native CRM.
-- The 14-digit prefix is a unique Supabase CLI migration version.
--
-- The Edge Function first soft-deletes the auth account. Only then may this
-- service-role-only RPC remove company data. Every tenant for which the user
-- is the sole owner is deleted by one database transaction: a cascade failure
-- rolls the whole batch back instead of leaving half an account behind.

create table if not exists public.account_deletion_cleanup (
  user_id uuid primary key,
  status text not null check (
    status in (
      'requested',
      'soft_delete_failed',
      'soft_deleted',
      'tenant_cleanup_failed',
      'tenant_data_deleted',
      'pending_auth_delete'
    )
  ),
  deleted_tenant_count integer not null default 0
    check (deleted_tenant_count >= 0),
  last_error_code text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_retry_at timestamptz not null default (now() + interval '5 minutes'),
  lease_token uuid,
  lease_expires_at timestamptz,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- CREATE TABLE IF NOT EXISTS does not add columns on a database where an
-- earlier draft of this migration was applied manually. Keep the retry
-- metadata repairable without replacing or truncating the cleanup ledger.
alter table public.account_deletion_cleanup
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_retry_at timestamptz not null
    default (now() + interval '5 minutes'),
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz;

create index if not exists idx_account_deletion_cleanup_retry
  on public.account_deletion_cleanup (next_retry_at, updated_at)
  where status in (
    'requested',
    'soft_delete_failed',
    'soft_deleted',
    'tenant_cleanup_failed',
    'tenant_data_deleted',
    'pending_auth_delete'
  );

alter table public.account_deletion_cleanup enable row level security;
alter table public.account_deletion_cleanup force row level security;

revoke all on table public.account_deletion_cleanup
  from public, anon, authenticated;
grant select, insert, update, delete on table public.account_deletion_cleanup
  to service_role;

drop policy if exists account_deletion_cleanup_service_role
  on public.account_deletion_cleanup;
create policy account_deletion_cleanup_service_role
  on public.account_deletion_cleanup for all
  to service_role
  using (true)
  with check (true);

-- Claim a bounded retry batch atomically. The lease prevents overlapping cron
-- invocations from running the irreversible Auth Admin operations twice, and
-- expires automatically if an Edge worker terminates between steps.
create or replace function public.claim_account_deletion_cleanup(
  p_limit integer default 20
)
returns table (
  user_id uuid,
  status text,
  deleted_tenant_count integer,
  attempt_count integer,
  lease_token uuid
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required for account cleanup claims'
      using errcode = '42501';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'cleanup claim limit must be between 1 and 50'
      using errcode = '22023';
  end if;

  return query
  with candidates as materialized (
    select cleanup.user_id
      from public.account_deletion_cleanup cleanup
     where cleanup.status in (
       'requested',
       'soft_delete_failed',
       'soft_deleted',
       'tenant_cleanup_failed',
       'tenant_data_deleted',
       'pending_auth_delete'
     )
       and cleanup.next_retry_at <= now()
       and cleanup.updated_at <= now() - interval '5 minutes'
       and (
         cleanup.lease_token is null
         or cleanup.lease_expires_at is null
         or cleanup.lease_expires_at <= now()
       )
     order by cleanup.next_retry_at, cleanup.updated_at, cleanup.user_id
     for update skip locked
     limit p_limit
  ), claimed as (
    update public.account_deletion_cleanup cleanup
       set lease_token = gen_random_uuid(),
           lease_expires_at = now() + interval '5 minutes',
           attempt_count = cleanup.attempt_count + 1,
           updated_at = now()
      from candidates
     where cleanup.user_id = candidates.user_id
    returning cleanup.user_id,
              cleanup.status,
              cleanup.deleted_tenant_count,
              cleanup.attempt_count,
              cleanup.lease_token
  )
  select claimed.user_id,
         claimed.status,
         claimed.deleted_tenant_count,
         claimed.attempt_count,
         claimed.lease_token
    from claimed;
end;
$function$;

revoke all on function public.claim_account_deletion_cleanup(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_account_deletion_cleanup(integer)
  to service_role;

-- This historical audit FK already says ON DELETE SET NULL, but the column
-- was declared NOT NULL. That contradiction makes any admin account
-- impossible to delete after it has written an audit row.
do $$
begin
  if to_regclass('public.admin_actions_log') is not null then
    alter table public.admin_actions_log
      alter column admin_user_id drop not null;
  end if;
end;
$$;

create or replace function public.delete_sole_owned_tenants_for_account(
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_count integer := 0;
  v_fk record;
begin
  -- Grant checks are the first wall; the JWT-role assertion is a second wall
  -- against an accidental future EXECUTE grant.
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required for account cleanup'
      using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'account id is required'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('account-delete:' || p_user_id::text, 0)
  );

  -- Soft deletion is intentionally irreversible and blocks sign-in. Refuse
  -- to touch business data while the account is still active.
  if not exists (
    select 1
      from auth.users u
     where u.id = p_user_id
       and u.deleted_at is not null
  ) then
    raise exception 'account must be soft-deleted before tenant cleanup'
      using errcode = '55000';
  end if;

  -- Parent rows first, then every existing membership row in deterministic
  -- order. This stabilises sole-owner checks against role changes and keeps
  -- the lock order compatible with tenant cascades.
  perform t.id
    from public.tenants t
   where exists (
     select 1
       from public.tenant_members own
      where own.tenant_id = t.id
        and own.user_id = p_user_id
   )
   order by t.id
   for update of t;

  perform tm.user_id
    from public.tenant_members tm
   where tm.tenant_id in (
     select own.tenant_id
       from public.tenant_members own
      where own.user_id = p_user_id
   )
   order by tm.tenant_id, tm.user_id
   for update of tm;

  with doomed as materialized (
    select own.tenant_id
      from public.tenant_members own
     where own.user_id = p_user_id
       and own.role = 'owner'
       and not exists (
         select 1
           from public.tenant_members other_owner
          where other_owner.tenant_id = own.tenant_id
            and other_owner.role = 'owner'
            and other_owner.user_id <> p_user_id
       )
  ), deleted as (
    delete from public.tenants t
     using doomed d
     where t.id = d.tenant_id
    returning t.id
  )
  select count(*)::integer into v_deleted_count from deleted;

  -- A surviving co-owned tenant keeps its legal and financial history, but
  -- private calendar records authored by the deleted account do not belong
  -- to the remaining company members.
  delete from public.personal_event_types pet
   where pet.created_by = p_user_id;

  delete from public.appointments a
   where a.created_by = p_user_id
     and a.kind in ('event', 'personal');

  -- Nullable legacy attribution FKs were created with NO ACTION. Clear all
  -- such public-schema references generically so a later hard auth deletion
  -- cannot fail merely because the user created an invoice, account, master
  -- card, transaction, or work appointment in a surviving co-owned tenant.
  for v_fk in
    select ns.nspname as schema_name,
           child.relname as table_name,
           attr.attname as column_name
      from pg_constraint con
      join pg_class child on child.oid = con.conrelid
      join pg_namespace ns on ns.oid = child.relnamespace
      join pg_attribute attr
        on attr.attrelid = con.conrelid
       and attr.attnum = con.conkey[1]
     where con.contype = 'f'
       and con.confrelid = 'auth.users'::regclass
       and con.confdeltype in ('a', 'r')
       and array_length(con.conkey, 1) = 1
       and array_length(con.confkey, 1) = 1
       and ns.nspname = 'public'
       and not attr.attnotnull
  loop
    -- Attribution cleanup must not recalculate ledgers, reschedule pushes or
    -- run appointment finance sync. ACCESS EXCLUSIVE is held while USER
    -- triggers are disabled, so no concurrent writer can pass through the
    -- table during this short maintenance update. Constraint triggers remain
    -- enabled; any error aborts the transaction and rolls the DDL back.
    execute format(
      'alter table %I.%I disable trigger user',
      v_fk.schema_name,
      v_fk.table_name
    );
    execute format(
      'update %I.%I set %I = null where %I = $1',
      v_fk.schema_name,
      v_fk.table_name,
      v_fk.column_name,
      v_fk.column_name
    ) using p_user_id;
    execute format(
      'alter table %I.%I enable trigger user',
      v_fk.schema_name,
      v_fk.table_name
    );
  end loop;

  insert into public.account_deletion_cleanup (
    user_id,
    status,
    deleted_tenant_count,
    last_error_code,
    updated_at
  ) values (
    p_user_id,
    'tenant_data_deleted',
    v_deleted_count,
    null,
    now()
  )
  on conflict (user_id) do update
    set status = excluded.status,
        deleted_tenant_count = excluded.deleted_tenant_count,
        last_error_code = null,
        updated_at = excluded.updated_at;

  return v_deleted_count;
end;
$$;

revoke all on function public.delete_sole_owned_tenants_for_account(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_sole_owned_tenants_for_account(uuid)
  to service_role;

-- Native client removal is an archive operation. Keep a database backstop so
-- a stale build or direct PostgREST DELETE cannot detach legal/financial
-- history from the customer identity. Tenant cascades remain valid.
create or replace function public.guard_client_hard_delete_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.tenants t where t.id = old.tenant_id
  ) then
    return old;
  end if;

  if exists (
       select 1 from public.appointments a where a.client_id = old.id
     )
     or exists (
       select 1 from public.invoices i where i.client_id = old.id
     )
     or exists (
       select 1
         from public.finance_transactions ft
        where ft.client_id = old.id
     ) then
    raise exception 'client with history must be archived, not deleted'
      using errcode = '23503';
  end if;

  return old;
end;
$$;

drop trigger if exists clients_guard_hard_delete_history on public.clients;
create trigger clients_guard_hard_delete_history
  before delete on public.clients
  for each row execute function public.guard_client_hard_delete_history();

revoke all on function public.guard_client_hard_delete_history()
  from public, anon, authenticated;

-- Deployment assertions: no client role can invoke or inspect cleanup state,
-- and the transaction refuses to run before auth soft deletion.
do $$
begin
  if has_function_privilege(
       'anon',
       'public.delete_sole_owned_tenants_for_account(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.delete_sole_owned_tenants_for_account(uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.delete_sole_owned_tenants_for_account(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.claim_account_deletion_cleanup(integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.claim_account_deletion_cleanup(integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.claim_account_deletion_cleanup(integer)',
       'EXECUTE'
     ) then
    raise exception 'safe account deletion: RPC grants are unsafe';
  end if;

  if has_table_privilege(
       'authenticated',
       'public.account_deletion_cleanup',
       'SELECT'
     )
     or has_table_privilege(
       'anon',
       'public.account_deletion_cleanup',
       'SELECT'
     ) then
    raise exception 'safe account deletion: cleanup log is client-readable';
  end if;

  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'delete_sole_owned_tenants_for_account'
       and p.prosecdef
       and position('deleted_at is not null' in lower(p.prosrc)) > 0
  ) then
    raise exception 'safe account deletion: soft-delete precondition is missing';
  end if;

  if exists (
    select 1
      from pg_constraint con
      join pg_attribute attr
        on attr.attrelid = con.conrelid
       and attr.attnum = con.conkey[1]
      join pg_class child on child.oid = con.conrelid
      join pg_namespace ns on ns.oid = child.relnamespace
     where con.contype = 'f'
       and con.confrelid = 'auth.users'::regclass
       and con.confdeltype in ('a', 'r', 'n')
       and array_length(con.conkey, 1) = 1
       and ns.nspname = 'public'
       and attr.attnotnull
  ) then
    raise exception 'safe account deletion: non-null auth reference blocks hard delete';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'account_deletion_cleanup'
       and column_name = 'lease_token'
  )
     or not exists (
       select 1
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'account_deletion_cleanup'
          and column_name = 'next_retry_at'
     )
     or not exists (
       select 1
         from pg_indexes
        where schemaname = 'public'
          and tablename = 'account_deletion_cleanup'
          and indexname = 'idx_account_deletion_cleanup_retry'
     ) then
    raise exception 'safe account deletion: retry lease contract is missing';
  end if;

  if not exists (
    select 1
      from pg_trigger trg
     where trg.tgrelid = 'public.clients'::regclass
       and trg.tgname = 'clients_guard_hard_delete_history'
       and not trg.tgisinternal
  ) then
    raise exception 'safe account deletion: client history delete guard is missing';
  end if;
end;
$$;
