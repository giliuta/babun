-- Mobile-first CRM invitations.
-- The 14-digit prefix is a unique Supabase CLI migration version.
--
-- Security model:
--   * owners never INSERT arbitrary invitation rows; create_invitation() is
--     the only creation path and generates the bearer token inside Postgres;
--   * only dispatcher/master roles can be invited;
--   * accept_invitation() locks the token row, matches the authenticated
--     account email and is idempotent only for the user who accepted it;
--   * accepting membership does not silently switch the active tenant;
--     activate_tenant() validates membership and stamps the next JWT.

alter table public.invitations
  add column if not exists accepted_by_user_id uuid
    references auth.users(id) on delete set null;

alter table public.invitations
  add column if not exists master_id text;

-- Legacy schema allowed owner invitations. Preserve their audit rows but make
-- every still-pending privileged link unusable immediately.
update public.invitations
   set expires_at = least(expires_at, now())
 where accepted_at is null
   and role not in ('dispatcher', 'master');

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.invitations'::regclass
       and conname = 'invitations_master_fkey'
  ) then
    alter table public.invitations
      add constraint invitations_master_fkey
      foreign key (tenant_id, master_id)
      references public.masters(tenant_id, id)
      not valid;
  end if;
end;
$$;

alter table public.invitations
  validate constraint invitations_master_fkey;

-- One auth account per employee card. Without this invariant two accepted
-- users could both satisfy assigned-master RLS for the same person.
do $$
begin
  if exists (
    select 1
      from public.tenant_members tm
     where tm.master_id is not null
     group by tm.tenant_id, tm.master_id
    having count(*) > 1
  ) then
    raise exception 'mobile invitations: duplicate tenant_members.master_id links';
  end if;
end;
$$;

create unique index if not exists tenant_members_one_account_per_master
  on public.tenant_members(tenant_id, master_id)
  where master_id is not null;

create index if not exists idx_invitations_accepted_by
  on public.invitations(accepted_by_user_id)
  where accepted_by_user_id is not null;

-- Membership rows carry internal user ids, roles and metadata. Operational
-- users need only their own row for tenant resolution; the owner needs the
-- full list for access management. Membership creation is exclusively the
-- invite/new-user SECURITY DEFINER flow below.
drop policy if exists tenant_members_select_teammate
  on public.tenant_members;
drop policy if exists tenant_members_select_owner_or_self
  on public.tenant_members;
drop policy if exists tenant_members_insert_owner
  on public.tenant_members;

create policy tenant_members_select_owner_or_self
  on public.tenant_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or (
      tenant_id = public.current_tenant_id()
      and public.current_user_role() = 'owner'
    )
  );

-- The legacy FOR ALL policy let an owner supply their own token, expiry,
-- accepted_at and even an owner-role invitation. Keep read/revoke operations,
-- but route creation through the SECURITY DEFINER RPC below and disallow
-- direct UPDATE entirely.
drop policy if exists invitations_owner_manage on public.invitations;
drop policy if exists invitations_owner_select on public.invitations;
drop policy if exists invitations_owner_delete on public.invitations;
drop policy if exists invitations_owner_insert on public.invitations;
drop policy if exists invitations_owner_update on public.invitations;
drop policy if exists invitations_invitee_select on public.invitations;

create policy invitations_owner_select on public.invitations for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

create policy invitations_owner_delete on public.invitations for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
    and accepted_at is null
  );

create or replace function public.create_invitation(
  p_email text,
  p_role text,
  p_master_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
  v_invitation public.invitations%rowtype;
begin
  if auth.uid() is null
     or v_tenant_id is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'only an owner can create invitations'
      using errcode = '42501';
  end if;

  -- An invited operator cannot complete the owner-only onboarding flow. Fail
  -- closed instead of creating an account that DashboardGate would route to
  -- /onboarding forever. onboarded_at is monotonic after owner completion.
  if not exists (
    select 1
      from public.tenants t
     where t.id = v_tenant_id
       and t.onboarded_at is not null
  ) then
    raise exception 'finish company setup before inviting employees'
      using errcode = '55000';
  end if;

  if p_role not in ('dispatcher', 'master') then
    raise exception 'invitation role must be dispatcher or master'
      using errcode = '22023';
  end if;

  if p_role = 'master' and nullif(btrim(coalesce(p_master_id, '')), '') is null then
    raise exception 'master invitation requires an employee card'
      using errcode = '22023';
  end if;

  if p_role = 'dispatcher' and p_master_id is not null then
    raise exception 'dispatcher invitation cannot link an employee card'
      using errcode = '22023';
  end if;

  if p_role = 'master' and not exists (
    select 1 from public.masters m
     where m.tenant_id = v_tenant_id
       and m.id = p_master_id
       and m.is_active
  ) then
    raise exception 'employee card not found or inactive'
      using errcode = '22023';
  end if;

  if p_role = 'master' and exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = v_tenant_id
       and tm.master_id = p_master_id
  ) then
    raise exception 'employee card already linked to an account'
      using errcode = '23505';
  end if;

  if length(v_email) > 320
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid invitation email'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from public.tenant_members tm
      join auth.users u on u.id = tm.user_id
     where tm.tenant_id = v_tenant_id
       and lower(coalesce(u.email, '')) = v_email
  ) then
    raise exception 'this account already has access to the tenant'
      using errcode = '23505';
  end if;

  -- Serialise replacement for the same tenant/email. Direct INSERT is denied
  -- by RLS, so every post-migration writer participates in this lock.
  perform pg_advisory_xact_lock(
    hashtextextended(v_tenant_id::text || ':' || v_email, 0)
  );

  -- Recheck under the same lock used by accept/signup. The pre-lock check is
  -- only a fast failure; without this one a concurrent accept can leave a new
  -- pending link for an account that already joined.
  if exists (
    select 1
      from public.tenant_members tm
      join auth.users u on u.id = tm.user_id
     where tm.tenant_id = v_tenant_id
       and lower(coalesce(u.email, '')) = v_email
  ) then
    raise exception 'this account already has access to the tenant'
      using errcode = '23505';
  end if;

  if p_role = 'master' then
    perform pg_advisory_xact_lock(
      hashtextextended(v_tenant_id::text || ':master:' || p_master_id, 1)
    );
    if exists (
      select 1 from public.tenant_members tm
       where tm.tenant_id = v_tenant_id
         and tm.master_id = p_master_id
    ) then
      raise exception 'employee card already linked to an account'
        using errcode = '23505';
    end if;
    if exists (
      select 1 from public.invitations i
       where i.tenant_id = v_tenant_id
         and i.master_id = p_master_id
         and i.accepted_at is null
         and i.expires_at > now()
         and lower(i.email) <> v_email
    ) then
      raise exception 'employee card already has a pending invitation'
        using errcode = '23505';
    end if;
  end if;

  -- A resend invalidates every older pending bearer URL without firing the
  -- "accepted" notification trigger.
  delete from public.invitations
   where tenant_id = v_tenant_id
     and lower(email) = v_email
     and accepted_at is null;

  -- SHA-256 spreads >192 bits of UUIDv4 entropy; the first 24 bytes are an
  -- exact 192-bit token. 24 bytes encode to 32 URL-safe base64 characters
  -- with no padding.
  v_token := translate(
    encode(
      substring(
        sha256(
          convert_to(
            gen_random_uuid()::text || gen_random_uuid()::text ||
            gen_random_uuid()::text,
            'UTF8'
          )
        )
        from 1 for 24
      ),
      'base64'
    ),
    '+/',
    '-_'
  );

  insert into public.invitations (
    tenant_id,
    email,
    role,
    master_id,
    invited_by_user_id,
    token,
    expires_at
  ) values (
    v_tenant_id,
    v_email,
    p_role,
    case when p_role = 'master' then p_master_id else null end,
    auth.uid(),
    v_token,
    now() + interval '7 days'
  )
  returning * into v_invitation;

  return jsonb_build_object(
    'id', v_invitation.id,
    'tenant_id', v_invitation.tenant_id,
    'email', v_invitation.email,
    'role', v_invitation.role,
    'master_id', v_invitation.master_id,
    'token', v_invitation.token,
    'expires_at', v_invitation.expires_at,
    'created_at', v_invitation.created_at
  );
end;
$$;

revoke all on function public.create_invitation(text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_invitation(text, text, text)
  to authenticated;

-- Token-only preview for a cold deep link. The 192-bit token is the
-- capability; never disclose the full invitee email before authentication.
create or replace function public.invitation_preview(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tenant_name', t.name,
    'role', i.role,
    'email_hint',
      case
        when position('@' in i.email) > 1 then
          left(i.email, 1) || '***@' || split_part(i.email, '@', 2)
        else '***'
      end,
    'expires_at', i.expires_at,
    'state', case
      when i.accepted_at is not null then 'accepted'
      when i.expires_at <= now() then 'expired'
      else 'active'
    end
  )
    from public.invitations i
    join public.tenants t on t.id = i.tenant_id
   where i.token = p_token
     and p_token ~ '^[A-Za-z0-9_-]{32,128}$'
   limit 1
$$;

revoke all on function public.invitation_preview(text)
  from public, anon, authenticated;
grant execute on function public.invitation_preview(text)
  to anon, authenticated;

-- Replace the legacy implementation with a race-safe and retry-safe version.
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.invitations%rowtype;
  v_caller_email text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to accept an invitation'
      using errcode = '42501';
  end if;

  select lower(coalesce(u.email, ''))
    into v_caller_email
    from auth.users u
   where u.id = auth.uid();

  if coalesce(v_caller_email, '') = '' then
    raise exception 'signed-in account has no email'
      using errcode = '42501';
  end if;

  -- Read identity first, then take advisory locks in the same order as invite
  -- creation. Locking the row first would deadlock with a resend that already
  -- owns the email lock and is waiting to delete that row.
  select *
    into v_invitation
    from public.invitations
   where token = p_token;

  if not found then
    raise exception 'invitation not found'
      using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      v_invitation.tenant_id::text || ':' || lower(v_invitation.email),
      0
    )
  );
  if v_invitation.master_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(
        v_invitation.tenant_id::text || ':master:' || v_invitation.master_id,
        1
      )
    );
  end if;

  select *
    into v_invitation
    from public.invitations
   where token = p_token
   for update;

  if not found then
    raise exception 'invitation not found'
      using errcode = 'P0002';
  end if;

  -- An activation/network retry after a successful accept is safe for the
  -- same user, but the consumed bearer token can never be reused by another.
  if v_invitation.accepted_at is not null then
    if v_invitation.accepted_by_user_id = auth.uid()
       and exists (
         select 1 from public.tenant_members tm
          where tm.tenant_id = v_invitation.tenant_id
            and tm.user_id = auth.uid()
       ) then
      return v_invitation.tenant_id;
    end if;
    raise exception 'invitation already accepted'
      using errcode = '42501';
  end if;

  if v_invitation.expires_at <= now() then
    raise exception 'invitation expired'
      using errcode = '42501';
  end if;

  if v_invitation.role not in ('dispatcher', 'master') then
    raise exception 'unsupported invitation role'
      using errcode = '42501';
  end if;

  if lower(v_invitation.email) <> v_caller_email then
    raise exception 'invitation email does not match the signed-in account'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.tenants t
     where t.id = v_invitation.tenant_id
       and t.onboarded_at is not null
  ) then
    raise exception 'finish company setup before inviting employees'
      using errcode = '55000';
  end if;

  -- Different legacy bearer links can point at the same account and tenant.
  -- Serialise that boundary as well as the token row so two concurrent
  -- accepts cannot consume both links while only one membership is created.
  perform pg_advisory_xact_lock(
    hashtextextended(
      v_invitation.tenant_id::text || ':user:' || auth.uid()::text,
      2
    )
  );

  if exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = v_invitation.tenant_id
       and tm.user_id = auth.uid()
  ) then
    raise exception 'this account already has access to the tenant'
      using errcode = '23505';
  end if;

  if v_invitation.role = 'master'
     and (
       v_invitation.master_id is null
       or not exists (
         select 1 from public.masters m
          where m.tenant_id = v_invitation.tenant_id
            and m.id = v_invitation.master_id
            and m.is_active
       )
       or exists (
         select 1 from public.tenant_members tm
          where tm.tenant_id = v_invitation.tenant_id
            and tm.master_id = v_invitation.master_id
       )
     ) then
    raise exception 'employee card is unavailable'
      using errcode = '23505';
  end if;

  insert into public.tenant_members (
    tenant_id,
    user_id,
    role,
    invited_by_user_id,
    master_id
  ) values (
    v_invitation.tenant_id,
    auth.uid(),
    v_invitation.role,
    v_invitation.invited_by_user_id,
    v_invitation.master_id
  );

  update public.invitations
     set accepted_at = now(),
         accepted_by_user_id = auth.uid()
   where id = v_invitation.id;

  update auth.users u
     set raw_app_meta_data =
       coalesce(u.raw_app_meta_data, '{}'::jsonb)
       || jsonb_build_object(
         'available_tenants',
         coalesce(
           (
             select jsonb_agg(x.tenant_id order by x.joined_at, x.tenant_id)
               from (
                 select tm.tenant_id::text as tenant_id,
                        min(tm.joined_at) as joined_at
                   from public.tenant_members tm
                  where tm.user_id = auth.uid()
                  group by tm.tenant_id
               ) x
           ),
           '[]'::jsonb
         )
       )
   where u.id = auth.uid();

  return v_invitation.tenant_id;
end;
$$;

revoke all on function public.accept_invitation(text)
  from public, anon, authenticated;
grant execute on function public.accept_invitation(text)
  to authenticated;

-- The only tenant switch primitive exposed to the mobile app. It cannot add
-- membership and cannot activate an arbitrary tenant: auth.uid() must already
-- have a tenant_members row. Updating auth.users is intentionally isolated in
-- this SECURITY DEFINER function; the client must refreshSession afterwards.
create or replace function public.activate_tenant(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_master_id text;
  v_available jsonb;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to activate a tenant'
      using errcode = '42501';
  end if;

  select tm.role, tm.master_id
    into v_role, v_master_id
    from public.tenant_members tm
   where tm.tenant_id = p_tenant_id
     and tm.user_id = auth.uid();

  if not found then
    raise exception 'tenant membership not found'
      using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(x.tenant_id order by x.joined_at, x.tenant_id),
    '[]'::jsonb
  )
    into v_available
    from (
      select tm.tenant_id::text as tenant_id,
             min(tm.joined_at) as joined_at
        from public.tenant_members tm
       where tm.user_id = auth.uid()
       group by tm.tenant_id
    ) x;

  update auth.users u
     set raw_app_meta_data =
       (coalesce(u.raw_app_meta_data, '{}'::jsonb) - 'tenant_master_id')
       || jsonb_build_object(
         'tenant_id', p_tenant_id::text,
         'tenant_role', v_role,
         'available_tenants', v_available
       )
       || case
            when v_master_id is null then '{}'::jsonb
            else jsonb_build_object('tenant_master_id', v_master_id)
          end
   where u.id = auth.uid();

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'role', v_role,
    'master_id', v_master_id
  );
end;
$$;

revoke all on function public.activate_tenant(uuid)
  from public, anon, authenticated;
grant execute on function public.activate_tenant(uuid)
  to authenticated;

-- New users who arrived from an invite must not receive a throwaway owner
-- tenant from the generic signup trigger. The mobile register screen passes
-- only the pending bearer token in raw_user_meta_data; this trigger validates
-- token + email again, consumes it atomically, and creates the membership.
-- The invite screen still calls accept_invitation() after sign-in; that call is
-- intentionally idempotent for accepted_by_user_id and then activates JWT.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_invitation public.invitations%rowtype;
  v_invite_token text := coalesce(
    new.raw_user_meta_data ->> 'pending_invitation_token',
    ''
  );
begin
  -- A signup that explicitly carries an invitation token must either consume
  -- that invitation or fail atomically. Falling through to ordinary signup on
  -- an expired/mismatched/raced token created an unrelated owner tenant.
  if v_invite_token <> '' then
    if v_invite_token !~ '^[A-Za-z0-9_-]{32,128}$' then
      raise exception 'invalid invitation token'
        using errcode = '22023';
    end if;

    -- Identity read only; advisory locks must precede FOR UPDATE to keep the
    -- same email→master→row order as create_invitation/accept_invitation.
    select *
      into v_invitation
      from public.invitations i
     where i.token = v_invite_token;

    if not found then
      raise exception 'invitation not found'
        using errcode = 'P0002';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(
        v_invitation.tenant_id::text || ':' || lower(v_invitation.email),
        0
      )
    );
    if v_invitation.master_id is not null then
      perform pg_advisory_xact_lock(
        hashtextextended(
          v_invitation.tenant_id::text || ':master:' || v_invitation.master_id,
          1
        )
      );
    end if;

    select *
      into v_invitation
      from public.invitations i
     where i.token = v_invite_token
       and i.accepted_at is null
       and i.expires_at > now()
       and i.role in ('dispatcher', 'master')
       and lower(i.email) = lower(coalesce(new.email, ''))
     for update;

    if not found then
      raise exception 'invitation is expired, consumed, or belongs to another email'
        using errcode = '42501';
    end if;

    if not exists (
      select 1
        from public.tenants t
       where t.id = v_invitation.tenant_id
         and t.onboarded_at is not null
    ) then
      raise exception 'finish company setup before inviting employees'
        using errcode = '55000';
    end if;

    if exists (
      select 1
        from public.tenant_members tm
        join auth.users u on u.id = tm.user_id
       where tm.tenant_id = v_invitation.tenant_id
         and lower(coalesce(u.email, '')) = lower(v_invitation.email)
    ) then
      raise exception 'this account already has access to the tenant'
        using errcode = '23505';
    end if;

    if v_invitation.role = 'master'
       and (
         v_invitation.master_id is null
         or not exists (
           select 1 from public.masters m
            where m.tenant_id = v_invitation.tenant_id
              and m.id = v_invitation.master_id
              and m.is_active
         )
         or exists (
           select 1 from public.tenant_members tm
            where tm.tenant_id = v_invitation.tenant_id
              and tm.master_id = v_invitation.master_id
         )
       ) then
      raise exception 'employee card is unavailable'
        using errcode = '23505';
    end if;

    insert into public.tenant_members (
      tenant_id,
      user_id,
      role,
      invited_by_user_id,
      master_id,
      joined_at
    ) values (
      v_invitation.tenant_id,
      new.id,
      v_invitation.role,
      v_invitation.invited_by_user_id,
      v_invitation.master_id,
      now()
    );

    update public.invitations
       set accepted_at = now(),
           accepted_by_user_id = new.id
     where id = v_invitation.id;

    update auth.users u
       set raw_app_meta_data =
             coalesce(u.raw_app_meta_data, '{}'::jsonb)
             || jsonb_build_object(
               'tenant_id', v_invitation.tenant_id::text,
               'tenant_role', v_invitation.role,
               'available_tenants',
                 jsonb_build_array(v_invitation.tenant_id::text)
             ),
           raw_user_meta_data =
             coalesce(u.raw_user_meta_data, '{}'::jsonb)
             - 'pending_invitation_token'
     where u.id = new.id;

    return new;
  end if;

  -- Ordinary signup: preserve the existing first-owner workflow.
  insert into public.tenants (id, name, vertical)
  values (
    gen_random_uuid(),
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'business_name'), ''),
      new.email,
      'Компания'
    ),
    'other'
  )
  returning id into v_tenant_id;

  insert into public.tenant_members (
    tenant_id,
    user_id,
    role,
    joined_at
  ) values (
    v_tenant_id,
    new.id,
    'owner',
    now()
  );

  insert into public.client_tags (id, tenant_id, name, color) values
    (gen_random_uuid(), v_tenant_id, 'VIP',         '#f59e0b'),
    (gen_random_uuid(), v_tenant_id, 'Новый',       '#3b82f6'),
    (gen_random_uuid(), v_tenant_id, 'Постоянный',  '#10b981'),
    (gen_random_uuid(), v_tenant_id, 'Проблемный',  '#ef4444');

  insert into public.calendar_settings (tenant_id)
  values (v_tenant_id)
  on conflict (tenant_id) do nothing;

  update auth.users u
     set raw_app_meta_data =
           coalesce(u.raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object(
             'tenant_id', v_tenant_id::text,
             'tenant_role', 'owner',
             'available_tenants', jsonb_build_array(v_tenant_id::text)
           ),
         raw_user_meta_data =
           coalesce(u.raw_user_meta_data, '{}'::jsonb)
           - 'pending_invitation_token'
   where u.id = new.id;

  return new;
end;
$$;

revoke all on function public.handle_new_user()
  from public, anon, authenticated;

-- Fail the deployment if a permissive creation path or unsafe function grant
-- survived an earlier migration.
do $$
begin
  if exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'invitations'
       and cmd in ('INSERT', 'UPDATE', 'ALL')
  ) then
    raise exception 'mobile invitations: direct INSERT/UPDATE policy remains';
  end if;

  if exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'tenant_members'
       and cmd in ('INSERT', 'ALL')
       and 'authenticated' = any(roles)
  ) then
    raise exception 'mobile invitations: direct membership creation remains';
  end if;

  if has_function_privilege(
       'anon',
       'public.create_invitation(text,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.create_invitation(text,text,text)',
       'EXECUTE'
     ) then
    raise exception 'mobile invitations: create_invitation grants are unsafe';
  end if;

  if has_function_privilege('anon', 'public.activate_tenant(uuid)', 'EXECUTE')
     or not has_function_privilege(
       'authenticated',
       'public.activate_tenant(uuid)',
       'EXECUTE'
     ) then
    raise exception 'mobile invitations: activate_tenant grants are unsafe';
  end if;

  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'create_invitation',
         'accept_invitation',
         'activate_tenant',
         'invitation_preview'
       )
       and p.prosecdef
     group by n.nspname
    having count(*) = 4
  ) then
    raise exception 'mobile invitations: SECURITY DEFINER RPC is missing';
  end if;

  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'handle_new_user'
       and position('v_invite_token <>' in p.prosrc) > 0
       and position(
         'invitation is expired, consumed, or belongs to another email'
         in p.prosrc
       ) > 0
  ) then
    raise exception 'mobile invitations: invalid invite signup can fall through to owner';
  end if;

  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'create_invitation'
       and position('onboarded_at is not null' in lower(p.prosrc)) > 0
  ) then
    raise exception 'mobile invitations: incomplete tenant can invite operators';
  end if;
end;
$$;
