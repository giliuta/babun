-- В ПРИГЛАШЕНИИ — МИНИ-КАРТОЧКА ЧЕЛОВЕКА: ИМЯ, ПОЧТА, ТЕЛЕФОН.
--
-- Владелец 15.09, глядя на шторку «Пригласить мастера» с одной почтой: «при
-- отправке мы можем сделать имя и ввести почту, также ввести номер телефона —
-- грубо говоря, мини-информацию об этом человеке».
--
--   • `invitations.full_name`, `invitations.phone` — что владелец знает о
--     человеке до его ответа: строка «Ждут ответа» называет его по имени;
--   • `create_invitation` получает `p_full_name` и `p_phone` — оба необязательны,
--     телефон только в E.164, как его пишет экран. Прежняя форма из четырёх
--     аргументов снесена: две функции с одним именем сделали бы вызов
--     неоднозначным, а старые сборки зовут по именам и попадают в новую;
--   • карточка мастера при приёме берёт имя и телефон из приглашения, а если
--     их нет — из аккаунта, как было; повторное приглашение с именем или
--     телефоном обновляет их в карточке;
--   • `list_members` называет человека именем его карточки: владелец видит в
--     «Мастерах» то имя, которое написал сам; без карточки — как было;
--   • заодно `create_invitation` больше не открыт анониму: внутри он и так
--     отказывал, но права на вызов у `anon` быть не должно.

alter table public.invitations
  add column if not exists full_name text,
  add column if not exists phone text;

alter table public.invitations drop constraint if exists invitations_full_name_length;
alter table public.invitations
  add constraint invitations_full_name_length
  check (full_name is null or char_length(full_name) between 1 and 120);

alter table public.invitations drop constraint if exists invitations_phone_e164;
alter table public.invitations
  add constraint invitations_phone_e164
  check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$');

drop function if exists public.create_invitation(text, text, text, text);

create or replace function public.create_invitation(
  p_email text,
  p_role text,
  p_master_id text default null::text,
  p_team_id text default null::text,
  p_full_name text default null::text,
  p_phone text default null::text
)
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
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
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

  -- Мини-карточка человека (15.09): имя и телефон необязательны.
  if v_full_name is not null and char_length(v_full_name) > 120 then
    raise exception 'invitation name is too long'
      using errcode = '22023';
  end if;

  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'invalid invitation phone'
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
    tenant_id, email, role, master_id, team_id, invited_by_user_id, token, expires_at,
    full_name, phone
  ) values (
    v_tenant_id,
    v_email,
    p_role,
    case when p_role = 'master' then v_master_id else null end,
    v_team_id,
    auth.uid(),
    v_token,
    now() + interval '7 days',
    v_full_name,
    v_phone
  )
  returning * into v_invitation;

  return jsonb_build_object(
    'id', v_invitation.id,
    'tenant_id', v_invitation.tenant_id,
    'email', v_invitation.email,
    'role', v_invitation.role,
    'master_id', v_invitation.master_id,
    'team_id', v_invitation.team_id,
    'full_name', v_invitation.full_name,
    'phone', v_invitation.phone,
    'token', v_invitation.token,
    'expires_at', v_invitation.expires_at,
    'created_at', v_invitation.created_at
  );
end;
$function$;

revoke all on function public.create_invitation(text, text, text, text, text, text) from public, anon;
grant execute on function public.create_invitation(text, text, text, text, text, text) to authenticated;

create or replace function public.attach_invited_master_card(p_invitation public.invitations, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_master_id text;
  v_name text;
  v_phone text;
  v_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_stamp text := '';
begin
  if p_invitation.role is distinct from 'master'
     or p_invitation.master_id is not null
     or p_invitation.team_id is null
     or p_user_id is null then
    return p_invitation.master_id;
  end if;

  -- Имя и телефон, которые написал владелец в приглашении (15.09), сильнее
  -- того, что человек написал о себе при регистрации.
  select coalesce(
           nullif(btrim(p_invitation.full_name), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
           nullif(split_part(coalesce(u.email, ''), '@', 1), '')
         ),
         coalesce(
           nullif(btrim(p_invitation.phone), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'phone'), '')
         )
    into v_name, v_phone
    from auth.users u
   where u.id = p_user_id;

  select m.id
    into v_master_id
    from public.masters m
   where m.tenant_id = p_invitation.tenant_id
     and m.user_id = p_user_id
   for update;

  if v_master_id is null then
    -- Тот же вид номера, что у карточек из приложения: `generateId("master")`.
    while v_ms > 0 loop
      v_stamp := substr('0123456789abcdefghijklmnopqrstuvwxyz', (v_ms % 36)::int + 1, 1) || v_stamp;
      v_ms := v_ms / 36;
    end loop;
    v_master_id := 'master-' || v_stamp || '-' || substr(md5(gen_random_uuid()::text), 1, 5);

    insert into public.masters (
      id, tenant_id, full_name, phone, team_id, account_status, user_id, created_by
    ) values (
      v_master_id,
      p_invitation.tenant_id,
      coalesce(v_name, 'Мастер'),
      v_phone,
      p_invitation.team_id,
      'active',
      p_user_id,
      p_invitation.invited_by_user_id
    );
  else
    update public.masters m
       set team_id = p_invitation.team_id,
           is_active = true,
           account_status = 'active',
           full_name = coalesce(nullif(btrim(p_invitation.full_name), ''), m.full_name),
           phone = coalesce(nullif(btrim(p_invitation.phone), ''), m.phone)
     where m.tenant_id = p_invitation.tenant_id
       and m.id = v_master_id;
  end if;

  update public.tenant_members tm
     set master_id = v_master_id
   where tm.tenant_id = p_invitation.tenant_id
     and tm.user_id = p_user_id
     and tm.master_id is null;

  return v_master_id;
end;
$function$;

revoke all on function public.attach_invited_master_card(public.invitations, uuid) from public, anon, authenticated;

create or replace function public.list_members(p_team_id text default null::text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
  result jsonb;
begin
  if auth.uid() is null or active_tenant is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'людей компании видит владелец' using errcode = '42501', hint = 'access:not_owner';
  end if;
  if p_team_id is not null and not exists (
    select 1 from public.teams t where t.tenant_id = active_tenant and t.id = p_team_id
  ) then
    raise exception 'календарь не из этой компании' using errcode = '22023', hint = 'access:bad_team';
  end if;

  -- Имя и телефон — сперва из карточки сотрудника (15.09): владелец видит того,
  -- кого сам назвал в приглашении; без карточки — из регистрации, как было.
  select coalesce(jsonb_agg(person order by person->>'name'), '[]'::jsonb)
    into result
    from (
      select jsonb_build_object(
               'user_id', tm.user_id,
               'role', tm.role,
               'name', coalesce(
                 nullif(btrim(m.full_name), ''),
                 nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                 nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
                 split_part(u.email, '@', 1)
               ),
               'email', u.email,
               'phone', coalesce(
                 nullif(btrim(m.phone), ''),
                 nullif(u.phone, ''),
                 nullif(btrim(u.raw_user_meta_data ->> 'phone'), '')
               ),
               'phone_verified', u.phone_confirmed_at is not null
                 and coalesce(u.phone, '') <> ''
                 and u.phone = coalesce(nullif(btrim(m.phone), ''), u.phone),
               'calendars', coalesce((
                 select jsonb_agg(mc.team_id order by mc.team_id)
                   from public.member_calendars mc
                  where mc.tenant_id = tm.tenant_id and mc.user_id = tm.user_id
               ), '[]'::jsonb),
               'joined_at', tm.joined_at
             ) as person
        from public.tenant_members tm
        join auth.users u on u.id = tm.user_id
        left join public.masters m on m.tenant_id = tm.tenant_id and m.id = tm.master_id
       where tm.tenant_id = active_tenant
         and (
           p_team_id is null
           or exists (
             select 1 from public.member_calendars mc
              where mc.tenant_id = tm.tenant_id and mc.user_id = tm.user_id and mc.team_id = p_team_id
           )
         )
    ) people;

  return result;
end;
$function$;

do $guard$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'create_invitation' and p.pronargs <> 6
  ) then
    raise exception 'миграция: осталась вторая форма create_invitation';
  end if;
  if has_function_privilege('anon', 'public.create_invitation(text, text, text, text, text, text)', 'execute') then
    raise exception 'миграция: create_invitation открыт анониму';
  end if;
  if position('p_invitation.full_name' in pg_get_functiondef('public.attach_invited_master_card(public.invitations, uuid)'::regprocedure)) = 0 then
    raise exception 'миграция: карточка не берёт имя из приглашения';
  end if;
  if position('m.full_name' in pg_get_functiondef('public.list_members(text)'::regprocedure)) = 0 then
    raise exception 'миграция: люди календаря не называются именем карточки';
  end if;
end
$guard$;
