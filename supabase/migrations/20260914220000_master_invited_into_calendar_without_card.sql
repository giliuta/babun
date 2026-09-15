-- МАСТЕРА ЗОВУТ ПО ПОЧТЕ В КАЛЕНДАРЬ — БЕЗ КАРТОЧКИ СОТРУДНИКА.
--
-- Владелец 14.09, глядя на модалку «Новый мастер · Имя · Телефон»: «мы
-- договорились по почте». Решения 14.09: без аккаунта мастера не заводим,
-- «Добавить мастера» — приглашение. Сервер же требовал у приглашения мастера
-- активную свободную карточку (`master invitation requires an employee card`),
-- то есть позвать мастера, не заведя карточку заранее, было нельзя.
--
-- Теперь у мастера два законных входа:
--   • с карточкой — путь «Доступ в CRM» (007): карточка обязана быть активной и
--     свободной, проверки и замки прежние;
--   • без карточки — ТОЛЬКО в календарь (`p_team_id` задан). При приёме:
--     членство `master` с `master_id = null`, `calendar_members {view}` на этот
--     календарь и прикрепление `member_calendars` — всё через тот же помощник
--     `grant_invitation_calendar`.
-- Мастер без карточки и без календаря по-прежнему отказ: такому аккаунту
-- нечего показать (безопасный список мастера читает свою карточку или
-- выданные календари).
--
-- Что видит мастер без карточки: `list_master_appointments_safe` отдаёт записи
-- календарей с правом `view` без сумм. Двигать статус и грузить фото он не
-- может — это хвост этапа 2 (`record.status`), как и у мастера с одним `view`.
--
-- Заодно (находка 007, открытый пункт 005 от 13.09): оба входа отказывают,
-- если календарь приглашения заархивировали после создания приглашения.
-- Раньше членство создавалось, помощник на архиве выходил молча, и диспетчер
-- без строк прав получал всю компанию вместо одного календаря.
--
-- Тела — буквальные `create or replace` (живые тела 14.09 + правка ветки
-- мастера): контракт-тест 007 читает `accept_invitation` и `handle_new_user` из
-- последней миграции с буквальным определением.

create or replace function public.create_invitation(p_email text, p_role text, p_master_id text default null::text, p_team_id text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_team_id text := nullif(btrim(coalesce(p_team_id, '')), '');
  v_master_id text := nullif(btrim(coalesce(p_master_id, '')), '');
  v_token text;
  v_invitation public.invitations%rowtype;
begin
  if auth.uid() is null
     or v_tenant_id is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'only an owner can create invitations'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.tenants t
     where t.id = v_tenant_id and t.onboarded_at is not null
  ) then
    raise exception 'finish company setup before inviting employees'
      using errcode = '55000';
  end if;

  if p_role not in ('dispatcher', 'master') then
    raise exception 'invitation role must be dispatcher or master'
      using errcode = '22023';
  end if;

  if v_team_id is not null and not exists (
    select 1 from public.teams t
     where t.tenant_id = v_tenant_id
       and t.id = v_team_id
       and t.is_active
  ) then
    raise exception 'calendar not found or archived'
      using errcode = '22023';
  end if;

  -- Мастер без карточки — только в календарь: иначе аккаунту нечего показать.
  if p_role = 'master' and v_master_id is null and v_team_id is null then
    raise exception 'master invitation requires a calendar or an employee card'
      using errcode = '22023';
  end if;

  if p_role = 'dispatcher' and p_master_id is not null then
    raise exception 'dispatcher invitation cannot link an employee card'
      using errcode = '22023';
  end if;

  if p_role = 'master' and v_master_id is not null and not exists (
    select 1 from public.masters m
     where m.tenant_id = v_tenant_id and m.id = v_master_id and m.is_active
  ) then
    raise exception 'employee card not found or inactive'
      using errcode = '22023';
  end if;

  if p_role = 'master' and v_master_id is not null and exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = v_tenant_id and tm.master_id = v_master_id
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
    select 1 from public.tenant_members tm
      join auth.users u on u.id = tm.user_id
     where tm.tenant_id = v_tenant_id
       and lower(coalesce(u.email, '')) = v_email
  ) then
    raise exception 'this account already has access to the tenant'
      using errcode = '23505';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_tenant_id::text || ':' || v_email, 0)
  );

  if exists (
    select 1 from public.tenant_members tm
      join auth.users u on u.id = tm.user_id
     where tm.tenant_id = v_tenant_id
       and lower(coalesce(u.email, '')) = v_email
  ) then
    raise exception 'this account already has access to the tenant'
      using errcode = '23505';
  end if;

  if p_role = 'master' and v_master_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_tenant_id::text || ':master:' || v_master_id, 1)
    );
    if exists (
      select 1 from public.tenant_members tm
       where tm.tenant_id = v_tenant_id and tm.master_id = v_master_id
    ) then
      raise exception 'employee card already linked to an account'
        using errcode = '23505';
    end if;
    if exists (
      select 1 from public.invitations i
       where i.tenant_id = v_tenant_id
         and i.master_id = v_master_id
         and i.accepted_at is null
         and i.expires_at > now()
         and lower(i.email) <> v_email
    ) then
      raise exception 'employee card already has a pending invitation'
        using errcode = '23505';
    end if;
  end if;

  delete from public.invitations
   where tenant_id = v_tenant_id
     and lower(email) = v_email
     and accepted_at is null;

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
    tenant_id, email, role, master_id, team_id, invited_by_user_id, token, expires_at
  ) values (
    v_tenant_id,
    v_email,
    p_role,
    case when p_role = 'master' then v_master_id else null end,
    v_team_id,
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
    'team_id', v_invitation.team_id,
    'token', v_invitation.token,
    'expires_at', v_invitation.expires_at,
    'created_at', v_invitation.created_at
  );
end;
$function$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invitation public.invitations%rowtype;
  v_caller_email text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to accept an invitation'
      using errcode = '42501';
  end if;

  select lower(coalesce(u.email, '')) into v_caller_email
    from auth.users u where u.id = auth.uid();

  if coalesce(v_caller_email, '') = '' then
    raise exception 'signed-in account has no email' using errcode = '42501';
  end if;

  select * into v_invitation from public.invitations where token = p_token;
  if not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_invitation.tenant_id::text || ':' || lower(v_invitation.email), 0)
  );
  if v_invitation.master_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_invitation.tenant_id::text || ':master:' || v_invitation.master_id, 1)
    );
  end if;

  select * into v_invitation from public.invitations where token = p_token for update;
  if not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;

  if v_invitation.accepted_at is not null then
    -- Already accepted by this very person (signup through the link did it):
    -- return without granting again — the owner may have narrowed the rights
    -- since.
    if v_invitation.accepted_by_user_id = auth.uid()
       and exists (
         select 1 from public.tenant_members tm
          where tm.tenant_id = v_invitation.tenant_id and tm.user_id = auth.uid()
       ) then
      return v_invitation.tenant_id;
    end if;
    raise exception 'invitation already accepted' using errcode = '42501';
  end if;

  if v_invitation.expires_at <= now() then
    raise exception 'invitation expired' using errcode = '42501';
  end if;

  if v_invitation.role not in ('dispatcher', 'master') then
    raise exception 'unsupported invitation role' using errcode = '42501';
  end if;

  if lower(v_invitation.email) <> v_caller_email then
    raise exception 'invitation email does not match the signed-in account'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.tenants t
     where t.id = v_invitation.tenant_id and t.onboarded_at is not null
  ) then
    raise exception 'finish company setup before inviting employees'
      using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_invitation.tenant_id::text || ':user:' || auth.uid()::text, 2)
  );

  if exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = v_invitation.tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'this account already has access to the tenant'
      using errcode = '23505';
  end if;

  -- Календарь приглашения заархивировали между приглашением и приёмом: без
  -- отказа диспетчер без строк прав видел бы всю компанию, а мастер без
  -- карточки — ничего. Выход помощника на is_active остаётся вторым рубежом.
  if v_invitation.team_id is not null and not exists (
    select 1 from public.teams t
     where t.tenant_id = v_invitation.tenant_id
       and t.id = v_invitation.team_id
       and t.is_active
  ) then
    raise exception 'invitation calendar is archived'
      using errcode = '42501';
  end if;

  -- Мастер без карточки — только в календарь (create_invitation держит то же).
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
    raise exception 'employee card is unavailable' using errcode = '23505';
  end if;

  insert into public.tenant_members (
    tenant_id, user_id, role, invited_by_user_id, master_id
  ) values (
    v_invitation.tenant_id, auth.uid(), v_invitation.role,
    v_invitation.invited_by_user_id, v_invitation.master_id
  );

  perform public.grant_invitation_calendar(v_invitation, auth.uid());

  update public.invitations
     set accepted_at = now(), accepted_by_user_id = auth.uid()
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
                 select tm.tenant_id::text as tenant_id, min(tm.joined_at) as joined_at
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
$function$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
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

    -- Календарь приглашения заархивировали между приглашением и приёмом: без
    -- отказа диспетчер без строк прав видел бы всю компанию, а мастер без
    -- карточки — ничего. Выход помощника на is_active остаётся вторым рубежом.
    if v_invitation.team_id is not null and not exists (
      select 1 from public.teams t
       where t.tenant_id = v_invitation.tenant_id
         and t.id = v_invitation.team_id
         and t.is_active
    ) then
      raise exception 'invitation calendar is archived'
        using errcode = '42501';
    end if;

    -- Мастер без карточки — только в календарь (create_invitation держит то же).
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

    -- The invitation names a calendar: grant it here exactly as
    -- accept_invitation does, or the new account works by role and sees the
    -- whole company.
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
$function$;

do $guard$
declare
  v_create text := pg_get_functiondef('public.create_invitation(text, text, text, text)'::regprocedure);
  v_accept text := pg_get_functiondef('public.accept_invitation(text)'::regprocedure);
  v_signup text := pg_get_functiondef('public.handle_new_user()'::regprocedure);
begin
  if position('master invitation requires an employee card' in v_create) > 0 then
    raise exception 'миграция: create_invitation всё ещё требует карточку';
  end if;
  if position('requires a calendar or an employee card' in v_create) = 0
     or position('requires a calendar or an employee card' in v_accept) = 0
     or position('requires a calendar or an employee card' in v_signup) = 0 then
    raise exception 'миграция: вход без карточки и без календаря не закрыт';
  end if;
  if position('invitation calendar is archived' in v_accept) = 0
     or position('invitation calendar is archived' in v_signup) = 0 then
    raise exception 'миграция: вход принимает приглашение в архивный календарь';
  end if;
  if position('perform public.grant_invitation_calendar(v_invitation, auth.uid())' in v_accept) = 0
     or position('perform public.grant_invitation_calendar(v_invitation, new.id)' in v_signup) = 0 then
    raise exception 'миграция: вход приглашения не выдаёт календарь';
  end if;
end
$guard$;
