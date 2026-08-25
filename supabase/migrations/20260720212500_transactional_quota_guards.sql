-- Transactional subscription quota backstops.
--
-- UI/repository preflights remain useful for friendly errors, but they cannot
-- serialize two devices. These BEFORE INSERT triggers take a per-tenant,
-- per-quota transaction advisory lock and re-count inside Postgres before the
-- row becomes visible. The same team lock protects pending invitations and
-- active memberships, so accepting an invitation converts one reserved slot
-- instead of consuming a second slot.

create or replace function public.enforce_tenant_insert_quota()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_limit integer;
  v_current integer;
  v_pending integer;
  v_projected integer;
  v_has_reserved_invitation boolean := false;
  v_month_start timestamptz;
begin
  if new.tenant_id is null then
    raise exception 'quota guard requires tenant_id'
      using errcode = '22023';
  end if;

  if tg_table_schema <> 'public' then
    raise exception 'quota guard attached outside public schema'
      using errcode = '55000';
  end if;

  if tg_table_name = 'clients' then
    perform pg_advisory_xact_lock(
      hashtextextended('tenant-quota:clients:' || new.tenant_id::text, 0)
    );

    v_limit := public.tenant_quota_clients(new.tenant_id);
    select count(*)::integer
      into v_current
      from public.clients client
     where client.tenant_id = new.tenant_id;

    if v_current >= v_limit then
      raise exception 'quota_exceeded: clients %/%', v_current, v_limit
        using errcode = 'P0001',
              detail = 'quota_exceeded:clients';
    end if;
    return new;
  end if;

  if tg_table_name = 'appointments' then
    if tg_op = 'UPDATE' then
      if new.created_at is distinct from old.created_at then
        raise exception 'appointment created_at is server-owned and immutable'
          using errcode = '22023';
      end if;
      return new;
    end if;

    -- Match the billing UI/repository contract: usage belongs to the UTC
    -- calendar month in which the server received the row, not the scheduled
    -- date. Stamping + immutability closes the direct-PostgREST backdating
    -- bypass while leaving the operational appointment date untouched.
    new.created_at := statement_timestamp();
    v_month_start := date_trunc(
      'month',
      timezone('UTC', new.created_at)
    ) at time zone 'UTC';

    perform pg_advisory_xact_lock(
      hashtextextended(
        'tenant-quota:appointments-month:' || new.tenant_id::text,
        0
      )
    );

    v_limit := public.tenant_quota_appointments_month(new.tenant_id);
    select count(*)::integer
      into v_current
      from public.appointments appointment
     where appointment.tenant_id = new.tenant_id
       and appointment.created_at >= v_month_start
       and appointment.created_at < v_month_start + interval '1 month';

    if v_current >= v_limit then
      raise exception 'quota_exceeded: appointments_month %/%',
        v_current, v_limit
        using errcode = 'P0001',
              detail = 'quota_exceeded:appointments_month';
    end if;
    return new;
  end if;

  if tg_table_name = 'invitations' then
    -- Accepted or already-expired audit rows do not reserve a team slot.
    if new.accepted_at is not null or new.expires_at <= statement_timestamp() then
      return new;
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('tenant-quota:team-members:' || new.tenant_id::text, 0)
    );

    v_limit := public.tenant_quota_team_members(new.tenant_id);
    select count(*)::integer
      into v_current
      from public.tenant_members member
     where member.tenant_id = new.tenant_id;
    select count(*)::integer
      into v_pending
      from public.invitations invitation
     where invitation.tenant_id = new.tenant_id
       and invitation.accepted_at is null
       and invitation.expires_at > statement_timestamp();

    v_projected := v_current + v_pending + 1;
    if v_projected > v_limit then
      raise exception 'quota_exceeded: team_members %/%',
        v_current + v_pending, v_limit
        using errcode = 'P0001',
              detail = 'quota_exceeded:team_members';
    end if;
    return new;
  end if;

  if tg_table_name = 'tenant_members' then
    perform pg_advisory_xact_lock(
      hashtextextended('tenant-quota:team-members:' || new.tenant_id::text, 0)
    );

    v_limit := public.tenant_quota_team_members(new.tenant_id);
    select count(*)::integer
      into v_current
      from public.tenant_members member
     where member.tenant_id = new.tenant_id;
    select count(*)::integer
      into v_pending
      from public.invitations invitation
     where invitation.tenant_id = new.tenant_id
       and invitation.accepted_at is null
       and invitation.expires_at > statement_timestamp();

    -- accept_invitation() and invited handle_new_user() insert membership
    -- before stamping accepted_at. Match that user's active bearer row so the
    -- pending reservation is converted, not double-counted. Ordinary owner
    -- bootstrap has no reservation and naturally consumes the Free slot 1/1.
    select exists (
      select 1
        from auth.users account
        join public.invitations invitation
          on invitation.tenant_id = new.tenant_id
         and lower(invitation.email) = lower(coalesce(account.email, ''))
       where account.id = new.user_id
         and invitation.accepted_at is null
         and invitation.expires_at > statement_timestamp()
         and invitation.role = new.role
         and invitation.master_id is not distinct from new.master_id
    ) into v_has_reserved_invitation;

    v_projected := v_current + v_pending
      + case when v_has_reserved_invitation then 0 else 1 end;
    if v_projected > v_limit then
      raise exception 'quota_exceeded: team_members %/%',
        v_current + v_pending, v_limit
        using errcode = 'P0001',
              detail = 'quota_exceeded:team_members';
    end if;
    return new;
  end if;

  raise exception 'quota guard attached to unsupported table %', tg_table_name
    using errcode = '55000';
end;
$function$;

revoke all on function public.enforce_tenant_insert_quota()
  from public, anon, authenticated, service_role;

drop trigger if exists clients_enforce_insert_quota on public.clients;
create trigger clients_enforce_insert_quota
  before insert on public.clients
  for each row execute function public.enforce_tenant_insert_quota();

drop trigger if exists appointments_enforce_insert_quota
  on public.appointments;
create trigger appointments_enforce_insert_quota
  before insert or update of created_at on public.appointments
  for each row execute function public.enforce_tenant_insert_quota();

drop trigger if exists invitations_enforce_insert_quota
  on public.invitations;
create trigger invitations_enforce_insert_quota
  before insert on public.invitations
  for each row execute function public.enforce_tenant_insert_quota();

drop trigger if exists tenant_members_enforce_insert_quota
  on public.tenant_members;
create trigger tenant_members_enforce_insert_quota
  before insert on public.tenant_members
  for each row execute function public.enforce_tenant_insert_quota();

-- Refuse a rollout where any write path lost its server-side backstop or the
-- trigger helper accidentally became an API-callable SECURITY DEFINER RPC.
do $audit$
declare
  v_table text;
  v_trigger text;
begin
  for v_table, v_trigger in
    select expected.table_name, expected.trigger_name
      from (values
        ('clients', 'clients_enforce_insert_quota'),
        ('appointments', 'appointments_enforce_insert_quota'),
        ('invitations', 'invitations_enforce_insert_quota'),
        ('tenant_members', 'tenant_members_enforce_insert_quota')
      ) as expected(table_name, trigger_name)
  loop
    if not exists (
      select 1
        from pg_trigger trigger_row
       where trigger_row.tgrelid = format('public.%I', v_table)::regclass
         and trigger_row.tgname = v_trigger
         and not trigger_row.tgisinternal
         and (trigger_row.tgtype & 2) = 2
    ) then
      raise exception 'transactional quota guard missing for %', v_table;
    end if;
  end loop;

  if has_function_privilege(
       'anon', 'public.enforce_tenant_insert_quota()', 'EXECUTE'
     )
     or has_function_privilege(
       'authenticated', 'public.enforce_tenant_insert_quota()', 'EXECUTE'
     )
     or has_function_privilege(
       'service_role', 'public.enforce_tenant_insert_quota()', 'EXECUTE'
     ) then
    raise exception 'transactional quota trigger is API-callable';
  end if;
end;
$audit$;
