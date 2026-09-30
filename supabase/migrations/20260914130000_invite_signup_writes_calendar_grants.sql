-- РЕГИСТРАЦИЯ ПО ПРИГЛАШЕНИЮ ВЫДАЁТ ПРАВА НА КАЛЕНДАРЬ — РОВНО КАК ПРИЁМ.
--
-- Владелец 2026-09-12: «если я приглашаю сотрудника в календарь — он видит
-- исключительно этот календарь». `invite_into_calendar` научила этому
-- `accept_invitation`, но у приглашения ДВА входа, а научили один.
--
-- ДЫРА (найдена 2026-09-14, при подготовке теста передачи календаря между
-- двумя аккаунтами). Человек без аккаунта открывает ссылку и жмёт «Создать
-- аккаунт». Клиент кладёт токен в метаданные регистрации, и приглашение
-- проводит ТРИГГЕР `handle_new_user` (тело от 20.07): он пишет
-- `tenant_members` и отмечает приглашение принятым, а строку прав на календарь
-- не пишет — он старше прав по календарям. Следом экран приглашения зовёт
-- `accept_invitation`; та видит «принято этим же человеком» и выходит РАНЬШЕ
-- выдачи прав. Итог: позванный в один календарь остаётся с нулём строк прав,
-- ветка роли для него жива — диспетчер видит ВСЮ компанию. Путь «уже есть
-- аккаунт → войти → принять» был исправен.
--
-- ЧТО ДЕЛАЕМ. У выдачи прав по приглашению появляется ОДНО тело —
-- `grant_invitation_calendar`, и его зовут оба входа. Две копии одного правила
-- эту дыру и родили: второй вход не узнал, что правило появилось.
--
-- ПОВЕДЕНИЕ ПРИЁМА НЕ МЕНЯЕТСЯ: те же галочки (диспетчеру
-- `view·book·edit_all·clients·phones`, мастеру `view`); приглашение без
-- календаря и приглашение в архивный календарь прав не дают; повторная строка
-- не дублируется.
--
-- РАННЯЯ ВЕТКА `accept_invitation` («уже принято этим же человеком») права
-- НАМЕРЕННО не досыпает: иначе старая ссылка возвращала бы права, которые
-- владелец снял уже после приёма.
--
-- ДОСЫПАТЬ ЗАДНИМ ЧИСЛОМ НЕЧЕГО: на 2026-09-14 в базе ноль принятых приглашений
-- (проверено запросом до наката).

create or replace function public.grant_invitation_calendar(
  p_invitation public.invitations,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if p_invitation.team_id is null or p_user_id is null then
    return;
  end if;

  -- create_invitation refuses archived calendars, but the calendar can be
  -- archived between the invitation and its acceptance.
  if not exists (
    select 1 from public.teams t
     where t.tenant_id = p_invitation.tenant_id
       and t.id = p_invitation.team_id
       and t.is_active
  ) then
    return;
  end if;

  insert into public.calendar_members (tenant_id, team_id, user_id, master_id, grants)
  values (
    p_invitation.tenant_id,
    p_invitation.team_id,
    p_user_id,
    p_invitation.master_id,
    case p_invitation.role
      when 'dispatcher' then array['view','book','edit_all','clients','phones']::text[]
      else array['view']::text[]
    end
  )
  on conflict (tenant_id, team_id, user_id) do nothing;
end;
$function$;

-- Only the two invitation entries call it; a client must never grant itself a
-- calendar.
revoke all on function public.grant_invitation_calendar(public.invitations, uuid)
  from public, anon, authenticated;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
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

-- СТОРОЖ. Права по приглашению выдаёт одно тело: оба входа зовут помощника,
-- ни один не пишет строку прав сам, клиент помощника позвать не может. Новый
-- третий вход в приглашение (или возврат вставки в одну из функций) уронит
-- накат, а не тихо разведёт правила снова.
do $$
declare
  v_accept text := pg_get_functiondef('public.accept_invitation(text)'::regprocedure);
  v_signup text := pg_get_functiondef('public.handle_new_user()'::regprocedure);
begin
  if v_accept not like '%grant_invitation_calendar(v_invitation, auth.uid())%' then
    raise exception 'accept_invitation must grant calendar rights through grant_invitation_calendar';
  end if;
  if v_signup not like '%grant_invitation_calendar(v_invitation, new.id)%' then
    raise exception 'handle_new_user must grant calendar rights through grant_invitation_calendar';
  end if;
  if v_accept ilike '%insert into public.calendar_members%'
     or v_signup ilike '%insert into public.calendar_members%' then
    raise exception 'invitation calendar rights must have one body: grant_invitation_calendar';
  end if;
  if has_function_privilege('authenticated', 'public.grant_invitation_calendar(public.invitations, uuid)', 'execute')
     or has_function_privilege('anon', 'public.grant_invitation_calendar(public.invitations, uuid)', 'execute') then
    raise exception 'grant_invitation_calendar must not be callable by clients';
  end if;
end $$;
