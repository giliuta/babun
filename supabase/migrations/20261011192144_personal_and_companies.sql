-- ЛИЧНОЕ И КОМПАНИИ (владелец 11.10, docs/PLAN-COMPANIES-2026-10-11.md).
--
-- У человека — одно Личное: аккаунт с одним календарём «Личный», свои
-- события и клиенты. Компания — отдельный аккаунт: календари, участники,
-- клиенты, деньги; живёт без основателя, владение передаётся. Обе — строки
-- `tenants`, разный `kind`. Всё остальное (изоляция по заголовку компании,
-- лента всех аккаунтов, тарифы с лимитами) уже работает поверх `tenants`.

-- ─── 1. Колонки ──────────────────────────────────────────────────────────

alter table public.tenants
  add column if not exists kind text not null default 'company',
  add column if not exists personal_of uuid references auth.users(id) on delete cascade,
  add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table public.tenants
  add constraint tenants_kind_check check (kind in ('personal', 'company')),
  add constraint tenants_personal_of_matches_kind check ((kind = 'personal') = (personal_of is not null));

create unique index if not exists tenants_personal_of_key
  on public.tenants (personal_of) where personal_of is not null;

comment on column public.tenants.kind is
  'personal — Личное человека (personal_of), один календарь; company — компания.';

-- Вид аккаунта и его хозяин не меняются из приложения: только функциями ниже.
create or replace function public.tenants_guard_kind()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.role() is null
     or auth.role() = 'service_role'
     or current_setting('babun.kind_write', true) = 'on' then
    return new;
  end if;
  if new.kind is distinct from old.kind
     or new.personal_of is distinct from old.personal_of
     or new.created_by is distinct from old.created_by then
    raise exception 'Вид аккаунта не меняется'
      using errcode = '42501', hint = 'account:kind';
  end if;
  return new;
end;
$$;

create trigger tenants_guard_kind
  before update on public.tenants
  for each row execute function public.tenants_guard_kind();

-- ─── 2. Личное человека ──────────────────────────────────────────────────

/** Имя календаря «Личный» на языке человека (как его называет приложение). */
create or replace function public.personal_calendar_name(p_locale text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(coalesce(left(p_locale, 2), ''))
    when 'en' then 'Personal'
    when 'es' then 'Personal'
    when 'de' then 'Persönlich'
    when 'uk' then 'Особистий'
    when 'bg' then 'Личен'
    when 'el' then 'Προσωπικό'
    else 'Личный'
  end
$$;

/** Личное человека: есть — вернуть, нет — завести (аккаунт, владелец,
 *  настройки календаря и календарь «Личный»). Только для функций базы. */
create or replace function public.ensure_personal_space(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_meta jsonb;
  v_email text;
  v_name text;
begin
  select t.id into v_tenant from public.tenants t where t.personal_of = p_user;
  if v_tenant is not null then
    return v_tenant;
  end if;

  select coalesce(u.raw_user_meta_data, '{}'::jsonb), u.email
    into v_meta, v_email
    from auth.users u
   where u.id = p_user;
  if not found then
    raise exception 'нет такого человека' using errcode = '22023';
  end if;

  v_name := coalesce(
    nullif(btrim(v_meta ->> 'full_name'), ''),
    nullif(btrim(v_meta ->> 'business_name'), ''),
    nullif(split_part(coalesce(v_email, ''), '@', 1), ''),
    'Личное'
  );

  insert into public.tenants (name, vertical, onboarded_at, kind, personal_of, created_by)
  values (v_name, 'other', now(), 'personal', p_user, p_user)
  returning id into v_tenant;

  insert into public.tenant_members (tenant_id, user_id, role, joined_at)
  values (v_tenant, p_user, 'owner', now());

  insert into public.calendar_settings (tenant_id)
  values (v_tenant)
  on conflict (tenant_id) do nothing;

  insert into public.teams (id, tenant_id, name, payout_percentage)
  values (
    'team-' || replace(gen_random_uuid()::text, '-', ''),
    v_tenant,
    public.personal_calendar_name(v_meta ->> 'locale'),
    30
  );

  return v_tenant;
end;
$$;

revoke all on function public.ensure_personal_space(uuid) from public, anon, authenticated;

-- ─── 3. Разметка живых аккаунтов ─────────────────────────────────────────
--
-- Другие участники или больше одного живого календаря — компания. Иначе —
-- Личное своего владельца (первое по дате). Каждому без Личного — новое.
-- Активный аккаунт в claim'ах не трогаем: телефон остаётся там, где был.

do $$
declare
  r record;
begin
  for r in
    select t.id,
           (select tm.user_id from public.tenant_members tm
             where tm.tenant_id = t.id and tm.role = 'owner'
             order by tm.joined_at, tm.user_id limit 1) as owner_id,
           (select count(*) from public.tenant_members tm
             where tm.tenant_id = t.id and tm.role <> 'owner') as others,
           (select count(*) from public.teams tm
             where tm.tenant_id = t.id and tm.is_active) as live_teams
      from public.tenants t
     order by t.created_at, t.id
  loop
    if r.owner_id is not null
       and r.others = 0
       and r.live_teams <= 1
       and not exists (select 1 from public.tenants p where p.personal_of = r.owner_id) then
      update public.tenants
         set kind = 'personal', personal_of = r.owner_id, created_by = r.owner_id
       where id = r.id;
    else
      update public.tenants
         set created_by = r.owner_id
       where id = r.id;
    end if;
  end loop;

  -- Личное без календаря (регистрация без открытия календаря) — «Личный».
  insert into public.teams (id, tenant_id, name, payout_percentage)
  select 'team-' || replace(gen_random_uuid()::text, '-', ''),
         t.id,
         public.personal_calendar_name(u.raw_user_meta_data ->> 'locale'),
         30
    from public.tenants t
    join auth.users u on u.id = t.personal_of
   where t.kind = 'personal'
     and not exists (select 1 from public.teams tm where tm.tenant_id = t.id and tm.is_active);

  for r in
    select u.id
      from auth.users u
     where u.deleted_at is null
       and not exists (select 1 from public.tenants t where t.personal_of = u.id)
     order by u.created_at
  loop
    perform public.ensure_personal_space(r.id);
    perform public.sync_tenant_claims(r.id);
  end loop;
end;
$$;

-- ─── 4. Сторожа Личного ──────────────────────────────────────────────────

/** В Личном один живой календарь: новые календари — в компании. */
create or replace function public.personal_space_one_calendar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.is_active then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.is_active then
    return new;
  end if;
  if exists (select 1 from public.tenants t where t.id = new.tenant_id and t.kind = 'personal')
     and exists (
       select 1 from public.teams tm
        where tm.tenant_id = new.tenant_id and tm.is_active and tm.id <> new.id
     ) then
    raise exception 'В Личном один календарь. Новый календарь заводится в компании'
      using errcode = '42501', hint = 'calendar:personal';
  end if;
  return new;
end;
$$;

create trigger teams_personal_one_calendar
  before insert or update of is_active on public.teams
  for each row execute function public.personal_space_one_calendar();

/** В Личное не приглашают и не вступают. */
create or replace function public.personal_space_no_members()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.tenants t where t.id = new.tenant_id and t.kind = 'personal') then
    if tg_table_name = 'invitations' then
      raise exception 'В Личное не приглашают. Пригласите в компанию'
        using errcode = '42501', hint = 'invite:personal';
    end if;
    if new.role <> 'owner' then
      raise exception 'В Личное не вступают'
        using errcode = '42501', hint = 'invite:personal';
    end if;
  end if;
  return new;
end;
$$;

create trigger invitations_personal_no_members
  before insert on public.invitations
  for each row execute function public.personal_space_no_members();

create trigger tenant_members_personal_no_members
  before insert or update of role on public.tenant_members
  for each row execute function public.personal_space_no_members();

-- ─── 5. Регистрация заводит Личное ───────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
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
  -- ПОЧТА ЕЩЁ НЕ ПОДТВЕРЖДЕНА — ПРИГЛАШЕНИЕ ЖДЁТ (аудит 03.10): принять
  -- его без подтверждённой почты не даёт сторож 24.09, и регистрация по
  -- ссылке падала целиком. Без подтверждения — обычная регистрация, а
  -- приглашение примет accept_invitation после подтверждения и входа.
  if v_invite_token <> '' and new.email_confirmed_at is not null then
    if v_invite_token !~ '^[A-Za-z0-9_-]{32,128}$' then
      raise exception 'invalid invitation token'
        using errcode = '22023';
    end if;

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

    if v_invitation.team_id is not null and not exists (
      select 1
        from unnest(coalesce(v_invitation.team_ids, array[v_invitation.team_id])) as x(team_id)
        join public.teams t
          on t.tenant_id = v_invitation.tenant_id
         and t.id = x.team_id
         and t.is_active
    ) then
      raise exception 'invitation calendar is archived'
        using errcode = '42501';
    end if;

    if v_invitation.role = 'master'
       and v_invitation.master_id is null
       and v_invitation.team_id is null then
      raise exception 'master invitation requires a calendar or an employee card'
        using errcode = '22023';
    end if;

    if v_invitation.role = 'master'
       and v_invitation.master_id is not null
       and (
         not exists (
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

    perform public.grant_invitation_calendar(v_invitation, new.id);

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

    -- ЛИЧНОЕ — У КАЖДОГО (11.10), и у пришедшего по приглашению: телефон
    -- открывает компанию, Личное стоит в ленте первым.
    perform public.ensure_personal_space(new.id);
    perform public.sync_tenant_claims(new.id);

    return new;
  end if;

  -- ОБЫЧНАЯ РЕГИСТРАЦИЯ — ЛИЧНОЕ (11.10): аккаунт с именем человека и
  -- календарь «Личный». Компанию человек заводит сам, когда понадобится.
  v_tenant_id := public.ensure_personal_space(new.id);

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
$function$;

-- ─── 6. Компания ─────────────────────────────────────────────────────────

/** Завести компанию: человек — владелец, первый календарь с её именем,
 *  14 дней Про, если пробный для компании человек ещё не брал. */
create or replace function public.create_company(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_personal public.tenants%rowtype;
  v_tenant uuid;
  v_team text := 'team-' || replace(gen_random_uuid()::text, '-', '');
  v_trial boolean;
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501', hint = 'company:auth';
  end if;
  if v_name = '' then
    raise exception 'Нет названия компании' using errcode = '22023', hint = 'company:name';
  end if;
  if length(v_name) > 80 then
    raise exception 'Слишком длинное название' using errcode = '22023', hint = 'company:name';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('create_company:' || v_uid::text, 0));

  if (select count(*) from public.tenants t
       where t.created_by = v_uid and t.kind = 'company'
         and t.created_at > now() - interval '1 day') >= 5 then
    raise exception 'Слишком много компаний за день' using errcode = '54000', hint = 'company:rate';
  end if;

  select * into v_personal from public.tenants t where t.personal_of = v_uid;

  v_trial := not exists (
    select 1 from public.tenants t
     where t.created_by = v_uid and t.kind = 'company' and t.trial_started_at is not null
  );

  insert into public.tenants (
    name, vertical, onboarded_at, kind, created_by, country, currency,
    trial_tier, trial_started_at, trial_ends_at
  ) values (
    v_name, 'other', now(), 'company', v_uid,
    coalesce(v_personal.country, 'CY'), coalesce(v_personal.currency, 'EUR'),
    case when v_trial then 'pro' end,
    case when v_trial then now() end,
    case when v_trial then now() + interval '14 days' end
  )
  returning id into v_tenant;

  insert into public.tenant_members (tenant_id, user_id, role, joined_at)
  values (v_tenant, v_uid, 'owner', now());

  insert into public.calendar_settings (tenant_id)
  values (v_tenant)
  on conflict (tenant_id) do nothing;

  insert into public.teams (id, tenant_id, name, payout_percentage)
  values (v_team, v_tenant, v_name, 30);

  perform public.sync_tenant_claims(v_uid);

  return jsonb_build_object('tenant_id', v_tenant, 'team_id', v_team, 'trial', v_trial);
end;
$$;

revoke all on function public.create_company(text) from public, anon;
grant execute on function public.create_company(text) to authenticated;

/** Все права компании человеку — по каждому живому календарю, верхним
 *  положением каждого блока. Бывший владелец после передачи. */
create or replace function public.grant_full_company_access(p_tenant uuid, p_user uuid, p_by uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.member_calendars (tenant_id, user_id, team_id, attached_by, attached_at)
  select p_tenant, p_user, t.id, p_by, now()
    from public.teams t
   where t.tenant_id = p_tenant and t.is_active
  on conflict (tenant_id, user_id, team_id) do nothing;

  delete from public.member_access ma
   where ma.tenant_id = p_tenant and ma.user_id = p_user;

  insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
  select p_tenant, p_user, b.key, t.id, b.levels[array_length(b.levels, 1)], p_by, now()
    from public.access_blocks b
    join public.teams t on t.tenant_id = p_tenant and t.is_active
   where b.live and not b.owner_only and b.scope = 'calendar';

  insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
  select p_tenant, p_user, b.key, null, b.levels[array_length(b.levels, 1)], p_by, now()
    from public.access_blocks b
   where b.live and not b.owner_only and b.scope = 'company';
end;
$$;

revoke all on function public.grant_full_company_access(uuid, uuid, uuid) from public, anon, authenticated;

/** Передать владение компанией участнику. Прежний владелец остаётся
 *  партнёром со всеми правами. Личное не передаётся. */
create or replace function public.transfer_company_ownership(p_tenant uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501', hint = 'owner:auth';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = p_tenant and tm.user_id = v_uid and tm.role = 'owner'
  ) then
    raise exception 'Передать владение может только владелец' using errcode = '42501', hint = 'owner:not_owner';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant and t.kind = 'company') then
    raise exception 'Личное не передаётся' using errcode = '42501', hint = 'owner:personal';
  end if;
  if p_user is null or p_user = v_uid or not exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = p_tenant and tm.user_id = p_user
  ) then
    raise exception 'Этот человек не в компании' using errcode = '22023', hint = 'owner:not_member';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('owner:' || p_tenant::text, 0));

  update public.tenant_members
     set role = 'owner'
   where tenant_id = p_tenant and user_id = p_user;

  update public.tenant_members
     set role = 'master'
   where tenant_id = p_tenant and user_id = v_uid;

  -- Новому владельцу строки прав не нужны: владелец видит всё по роли.
  delete from public.member_access where tenant_id = p_tenant and user_id = p_user;

  perform public.grant_full_company_access(p_tenant, v_uid, v_uid);

  perform public.sync_tenant_claims(p_user);
  perform public.sync_tenant_claims(v_uid);
end;
$$;

revoke all on function public.transfer_company_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_company_ownership(uuid, uuid) to authenticated;

/** Выйти из компании целиком. Владелец не выходит — сначала передаёт. */
create or replace function public.leave_company(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501', hint = 'leave:anon';
  end if;
  select tm.role into v_role
    from public.tenant_members tm
   where tm.tenant_id = p_tenant and tm.user_id = v_uid;
  if v_role is null then
    raise exception 'Вы не в этой компании' using errcode = '42501', hint = 'leave:not_member';
  end if;
  if v_role = 'owner' then
    raise exception 'Владелец не выходит из компании — сначала передайте владение'
      using errcode = '42501', hint = 'leave:owner';
  end if;

  delete from public.member_access where tenant_id = p_tenant and user_id = v_uid;
  delete from public.team_notification_prefs where tenant_id = p_tenant and user_id = v_uid;
  delete from public.member_calendars where tenant_id = p_tenant and user_id = v_uid;
  delete from public.calendar_members where tenant_id = p_tenant and user_id = v_uid;
  delete from public.tenant_members where tenant_id = p_tenant and user_id = v_uid;
end;
$$;

revoke all on function public.leave_company(uuid) from public, anon;
grant execute on function public.leave_company(uuid) to authenticated;

/** Мои аккаунты для переключателя Кабинета и ленты: `tenants` читает только
 *  владелец, а имя и вид чужой компании нужны и партнёру. */
create or replace function public.list_my_accounts()
returns table (tenant_id uuid, name text, kind text, role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select tm.tenant_id, tn.name, tn.kind, tm.role, tm.joined_at
    from public.tenant_members tm
    join public.tenants tn on tn.id = tm.tenant_id
   where tm.user_id = auth.uid()
   order by (tn.kind = 'personal') desc, tn.name, tm.tenant_id
$$;

revoke all on function public.list_my_accounts() from public, anon;
grant execute on function public.list_my_accounts() to authenticated;

/** Компании, которые человек держит один и где есть другие участники: пока
 *  они есть, аккаунт не удалить — сначала передать владение. */
create or replace function public.companies_blocking_account_delete(p_user uuid default null)
returns table (tenant_id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.name
    from public.tenants t
    join public.tenant_members own
      on own.tenant_id = t.id and own.role = 'owner'
   where own.user_id = case
           when auth.role() = 'service_role' then coalesce(p_user, auth.uid())
           else auth.uid()
         end
     and t.kind = 'company'
     and not exists (
       select 1 from public.tenant_members o2
        where o2.tenant_id = t.id and o2.role = 'owner' and o2.user_id <> own.user_id
     )
     and exists (
       select 1 from public.tenant_members m
        where m.tenant_id = t.id and m.user_id <> own.user_id
     )
   order by t.name
$$;

revoke all on function public.companies_blocking_account_delete(uuid) from public, anon;
grant execute on function public.companies_blocking_account_delete(uuid) to authenticated, service_role;

-- ─── 7. Пробный: Личное — Соло, компания — Про или Макс ─────────────────

create or replace function public.start_trial(p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_kind text;
  v_started timestamptz;
  v_ends timestamptz := now() + interval '14 days';
begin
  if auth.uid() is null or v_tenant is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'Пробный период включает владелец аккаунта'
      using errcode = '42501', hint = 'plan:owner';
  end if;
  select t.kind, t.trial_started_at into v_kind, v_started
    from public.tenants t
   where t.id = v_tenant
     for update;
  if p_tier is null or p_tier not in ('solo', 'pro', 'max') then
    raise exception 'Неизвестный тариф' using errcode = '22023';
  end if;
  -- Личное — только Соло, компания — не ниже Про. Приложения из магазина
  -- (1.0.2, 1.0.3) предлагают пробный «Про» и в Личном: не отказ, а Соло.
  if v_kind = 'personal' then
    p_tier := 'solo';
  elsif p_tier = 'solo' then
    p_tier := 'pro';
  end if;
  if v_started is not null then
    raise exception 'Пробный период уже был'
      using errcode = 'P0001', hint = 'plan:trial-used';
  end if;
  if public.tenant_effective_plan(v_tenant) is distinct from 'free' then
    raise exception 'Тариф уже действует'
      using errcode = 'P0001', hint = 'plan:active';
  end if;
  perform set_config('babun.billing_write', 'on', true);
  update public.tenants
     set trial_tier = p_tier,
         trial_started_at = now(),
         trial_ends_at = v_ends
   where id = v_tenant;
  perform set_config('babun.billing_write', 'off', true);
  return jsonb_build_object('tier', p_tier, 'trial_ends_at', v_ends);
end;
$function$;
