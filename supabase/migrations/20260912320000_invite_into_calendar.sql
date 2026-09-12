-- ПРИГЛАШЕНИЕ ЗОВЁТ В КАЛЕНДАРЬ, А НЕ ПРОСТО В КОМПАНИЮ.
--
-- Владелец 2026-09-12: «если я приглашаю сотрудника в календарь — он видит
-- исключительно этот календарь»; «календарь — это и есть основной актив».
--
-- ЧЕГО НЕ ХВАТАЛО. Приглашение знало компанию и роль, но не календарь, а
-- `accept_invitation` писала только `tenant_members`. Значит человек входил
-- вообще без строк прав — и работал по ветке роли, то есть диспетчер получал
-- ВСЮ компанию. Выдать ему один календарь было можно только руками, уже после
-- приёма, и до этого момента он видел всё.
--
-- ЧТО ДЕЛАЕМ. У приглашения появляется календарь. Приняли такое приглашение —
-- в тот же миг появляется строка прав ровно на него, и по правилу «явное
-- право гасит роль» (`calendar_grants_replace_role`) человек видит ровно этот
-- календарь с первой секунды. Промежутка «уже вошёл, но ещё видит всё» больше
-- нет.
--
-- КАЛЕНДАРЬ ПОКА НЕОБЯЗАТЕЛЕН. Старое приглашение без календаря продолжает
-- работать по-прежнему: прав не пишем, человек идёт по ветке роли. Так шаг
-- «расширяем» и делается — сначала обе формы живы, потом экран начинает
-- присылать календарь всегда, и только тогда колонку можно потребовать.
--
-- ГАЛОЧКИ ПО УМОЛЧАНИЮ повторяют перенос 12.09 ровно: диспетчеру
-- `view·book·edit_all·clients·phones`, мастеру `view`. Приглашение НЕ выдаёт
-- ни денег, ни закрытия дня, ни настроек — это владелец добавляет руками,
-- осознанно. Право по умолчанию обязано быть самым скромным из разумных:
-- забытая галочка должна закрывать, а не открывать.
--
-- ССЫЛКА СОСТАВНАЯ, `(tenant_id, team_id)`, потому что первичный ключ команды
-- именно такой: `team_id` уникален только внутри компании. Ссылка на один
-- `team_id` пустила бы приглашение в чужой календарь с совпавшим кодом.

alter table public.invitations
  add column if not exists team_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invitations_team_fkey'
  ) then
    alter table public.invitations
      add constraint invitations_team_fkey
      foreign key (tenant_id, team_id)
      references public.teams (tenant_id, id)
      on delete cascade;
  end if;
end $$;

comment on column public.invitations.team_id is
  'Календарь, в который зовут. NULL — приглашение старой формы, без календаря: '
  'человек войдёт по роли, строк прав ему не пишется.';

-- Старая трёхаргументная форма СНОСИТСЯ, а не остаётся рядом: две функции с
-- одним именем сделали бы вызов с тремя аргументами неоднозначным, и приглашения
-- перестали бы создаваться вовсе. Клиент зовёт по именам аргументов, поэтому
-- старые сборки попадут в новую функцию и получат календарь по умолчанию NULL.
drop function if exists public.create_invitation(text, text, text);

create or replace function public.create_invitation(
  p_email text,
  p_role text,
  p_master_id text default null,
  p_team_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_team_id text := nullif(btrim(coalesce(p_team_id, '')), '');
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

  -- Календарь проверяется ЗДЕСЬ, при создании, а не при приёме: приглашение в
  -- несуществующий календарь должно отказать владельцу сразу, а не встретить
  -- приглашённого пустым экраном через неделю.
  if v_team_id is not null and not exists (
    select 1 from public.teams t
     where t.tenant_id = v_tenant_id
       and t.id = v_team_id
       and t.is_active
  ) then
    raise exception 'calendar not found or archived'
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
     where m.tenant_id = v_tenant_id and m.id = p_master_id and m.is_active
  ) then
    raise exception 'employee card not found or inactive'
      using errcode = '22023';
  end if;

  if p_role = 'master' and exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = v_tenant_id and tm.master_id = p_master_id
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

  if p_role = 'master' then
    perform pg_advisory_xact_lock(
      hashtextextended(v_tenant_id::text || ':master:' || p_master_id, 1)
    );
    if exists (
      select 1 from public.tenant_members tm
       where tm.tenant_id = v_tenant_id and tm.master_id = p_master_id
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
    case when p_role = 'master' then p_master_id else null end,
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

-- Приём приглашения теперь ещё и ВЫДАЁТ ПРАВА на названный календарь.
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_invitation public.invitations%rowtype;
  v_caller_email text;
  v_grants text[];
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

  -- ПРАВА НА НАЗВАННЫЙ КАЛЕНДАРЬ. Календарь мог быть заархивирован или удалён
  -- за те дни, что письмо лежало, — проверяем ещё раз и молча пропускаем шаг,
  -- а не отказываем: человек приглашение принял честно, и терять доступ в
  -- компанию из-за чужой правки справочника он не должен. Он войдёт по роли,
  -- а владелец увидит его на экране прав и выдаст календарь заново.
  if v_invitation.team_id is not null and exists (
    select 1 from public.teams t
     where t.tenant_id = v_invitation.tenant_id
       and t.id = v_invitation.team_id
       and t.is_active
  ) then
    v_grants := case v_invitation.role
      when 'dispatcher' then array['view','book','edit_all','clients','phones']::text[]
      else array['view']::text[]
    end;

    insert into public.calendar_members (tenant_id, team_id, user_id, master_id, grants)
    values (
      v_invitation.tenant_id, v_invitation.team_id, auth.uid(),
      v_invitation.master_id, v_grants
    )
    on conflict (tenant_id, team_id, user_id) do nothing;
  end if;

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

-- Приглашённый видит, КУДА его зовут: компания и календарь, а не одна компания.
create or replace function public.invitation_preview(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select jsonb_build_object(
    'tenant_name', t.name,
    'team_name', tm.name,
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
    left join public.teams tm
      on tm.tenant_id = i.tenant_id and tm.id = i.team_id
   where i.token = p_token
     and p_token ~ '^[A-Za-z0-9_-]{32,128}$'
   limit 1
$function$;

do $$
declare v_src text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='invitations' and column_name='team_id'
  ) then
    raise exception 'invitations: колонка календаря не заведена';
  end if;

  if not exists (select 1 from pg_constraint where conname='invitations_team_fkey') then
    raise exception 'invitations: ссылка на календарь не составная — приглашение пустит в чужой';
  end if;

  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='accept_invitation';

  if position('calendar_members' in v_src) = 0 then
    raise exception 'accept_invitation: права на календарь не выдаются';
  end if;

  -- Сторож против самой вероятной правки: потребовать календарь раньше, чем
  -- экран научится его присылать. Тогда приглашения перестанут создаваться.
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='invitations'
       and column_name='team_id' and is_nullable='NO'
  ) then
    raise exception 'invitations: календарь стал обязательным раньше экрана';
  end if;
end $$;
