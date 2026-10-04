-- «ПАРТНЁРЫ» — ПРАВО ДИРЕКТОРА (владелец 04.10: «кто-то ещё добавлял
-- партнёров… если я передаю директору, он может также добавлять людей-
-- партнёров и управлять; с собой он не может, сам себе доступ не выдаёт»).
--
-- Право раздела «Кабинет» `company.partners`: Скрыты · Только видит ·
-- Управляет.
--   • «Только видит» — список партнёров аккаунта, их команды и права.
--   • «Управляет» — приглашает, правит права и команды, снимает приглашения
--     и убирает партнёров.
--
-- Границы директора (решено так, чтобы он не мог выдать доступ себе ни
-- прямо, ни через другого человека):
--   1. себя, владельца и других директоров (у кого право «Партнёры» не
--      «Скрыты») он не трогает — их ведёт только владелец;
--   2. само право «Партнёры» выдаёт только владелец;
--   3. ступень, которую он ставит, — не выше его собственной в той же команде
--      (и в том же праве «Кабинета»); неизменённые строки не проверяются;
--   4. команды он добавляет и снимает только те, где работает сам.
-- Владелец — без изменений: все проверки пропускают его первым же условием.

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values (
  'company.partners', 'company', 'company', array['off', 'read', 'write'],
  'Партнёры', false, true,
  array[
    'function:public.list_members(text)',
    'function:public.list_member_access(uuid)',
    'function:public.access_writer_target(uuid)',
    'function:public.set_member_access(uuid, jsonb)',
    'function:public.set_member_calendars(uuid, text[])',
    'function:public.create_invitation(text, text, text, text, text, text, text[], text, text, jsonb)',
    'function:public.update_invitation(uuid, text, text, text[], text, text, jsonb)',
    'function:public.patch_master_profile(text, jsonb)',
    'policy:public.invitations.invitations_partners_select',
    'policy:public.invitations.invitations_partners_delete',
    'policy:public.tenant_members.tenant_members_select_partners',
    'policy:public.tenant_members.tenant_members_delete_partners',
    'policy:public.masters.masters_select_partners',
    'policy:public.masters.masters_update_partners'
  ],
  375
)
on conflict (key) do update
  set area = excluded.area, scope = excluded.scope, levels = excluded.levels,
      title_ru = excluded.title_ru, owner_only = excluded.owner_only,
      live = excluded.live, enforced_by = excluded.enforced_by,
      position = excluded.position;

-- ── Кем может управлять звонящий ─────────────────────────────────────────
create or replace function public.partners_manageable(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  active_tenant uuid := public.current_tenant_id();
  target_role text;
begin
  if auth.uid() is null or active_tenant is null or p_user is null or p_user = auth.uid() then
    return false;
  end if;
  select tm.role into target_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant and tm.user_id = p_user;
  if target_role is null or target_role = 'owner' then
    return false;
  end if;
  if public.current_user_role() = 'owner' then
    return true;
  end if;
  if not public.access_company('company.partners', 'write') then
    return false;
  end if;
  -- Директора ведёт только владелец.
  return not exists (
    select 1 from public.member_access ma
     where ma.tenant_id = active_tenant
       and ma.user_id = p_user
       and ma.block = 'company.partners'
       and ma.team_id is null
       and ma.level <> 'off'
  );
end;
$$;
revoke all on function public.partners_manageable(uuid) from public, anon;
grant execute on function public.partners_manageable(uuid) to authenticated;

-- Карточка партнёра, которую директор вправе править: человека, которым он
-- управляет, или его собственного ещё не принятого приглашения.
create or replace function public.partners_card_manageable(p_master_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and public.current_tenant_id() is not null
     and (
       public.current_user_role() = 'owner'
       or (
         public.access_company('company.partners', 'write')
         and (
           exists (
             select 1 from public.tenant_members tm
              where tm.tenant_id = public.current_tenant_id()
                and tm.master_id = p_master_id
                and public.partners_manageable(tm.user_id)
           )
           or exists (
             select 1 from public.invitations i
              where i.tenant_id = public.current_tenant_id()
                and i.master_id = p_master_id
                and i.accepted_at is null
                and i.invited_by_user_id = auth.uid()
           )
         )
       )
     )
$$;
revoke all on function public.partners_card_manageable(text) from public, anon;
grant execute on function public.partners_card_manageable(text) to authenticated;

-- Команды, которые директор добавляет или снимает, — только свои.
create or replace function public.partners_check_teams(p_wanted text[], p_stored text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bad text;
begin
  if public.current_user_role() = 'owner' then
    return;
  end if;
  select x.t into bad
    from (
      (select unnest(coalesce(p_wanted, array[]::text[])) as t
       except
       select unnest(coalesce(p_stored, array[]::text[])))
      union
      (select unnest(coalesce(p_stored, array[]::text[]))
       except
       select unnest(coalesce(p_wanted, array[]::text[])))
    ) x
   where not exists (
     select 1 from public.member_calendars mc
      where mc.tenant_id = public.current_tenant_id()
        and mc.user_id = auth.uid()
        and mc.team_id = x.t
   )
   limit 1;
  if bad is not null then
    raise exception 'В этой команде вы не работаете — её назначает владелец'
      using errcode = '42501', hint = 'access:not_your_calendar', detail = bad;
  end if;
end;
$$;
revoke all on function public.partners_check_teams(text[], text[]) from public, anon;
grant execute on function public.partners_check_teams(text[], text[]) to authenticated;

-- Ступени директора — не выше своих; право «Партнёры» — только владельцу.
create or replace function public.partners_check_caps(p_tenant uuid, p_user uuid, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  change jsonb;
  b public.access_blocks%rowtype;
  change_team text;
  change_level text;
  current_level text;
  my_level text;
begin
  if public.current_user_role() = 'owner' then
    return;
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    return;
  end if;
  for change in select value from jsonb_array_elements(p_changes) loop
    select * into b from public.access_blocks where key = change ->> 'block';
    if not found then
      continue;
    end if;
    change_team := nullif(change ->> 'team_id', '');
    change_level := change ->> 'level';

    if p_user is not null then
      select ma.level into current_level
        from public.member_access ma
       where ma.tenant_id = p_tenant
         and ma.user_id = p_user
         and ma.block = b.key
         and ma.team_id is not distinct from change_team;
      -- Неизменённая строка — не решение директора: её не проверяем.
      if change_level is not distinct from coalesce(current_level, b.levels[1]) then
        continue;
      end if;
    end if;

    if b.key = 'company.partners' then
      raise exception 'Право «Партнёры» выдаёт только владелец'
        using errcode = '42501', hint = 'access:partners_owner_only';
    end if;

    if b.scope = 'calendar' and not exists (
      select 1 from public.member_calendars mc
       where mc.tenant_id = p_tenant
         and mc.user_id = auth.uid()
         and mc.team_id = change_team
    ) then
      raise exception 'В этой команде вы не работаете — её права ставит владелец'
        using errcode = '42501', hint = 'access:not_your_calendar', detail = change_team;
    end if;

    select ma.level into my_level
      from public.member_access ma
     where ma.tenant_id = p_tenant
       and ma.user_id = auth.uid()
       and ma.block = b.key
       and ma.team_id is not distinct from change_team;
    my_level := coalesce(my_level, b.levels[1]);

    if coalesce(array_position(b.levels, change_level), 0) > coalesce(array_position(b.levels, my_level), 0) then
      raise exception 'Нельзя дать больше, чем есть у вас: «%»', b.title_ru
        using errcode = '42501', hint = 'access:above_own', detail = b.key;
    end if;
  end loop;
end;
$$;
revoke all on function public.partners_check_caps(uuid, uuid, jsonb) from public, anon;
grant execute on function public.partners_check_caps(uuid, uuid, jsonb) to authenticated;

-- ── Списки партнёров и их прав ───────────────────────────────────────────
do $patch$
declare
  d text;
begin
  d := pg_get_functiondef('public.list_members(text)'::regprocedure);
  if position($a$or public.current_user_role() is distinct from 'owner' then$a$ in d) = 0 then
    raise exception 'list_members: anchor missing';
  end if;
  execute replace(d,
    $a$or public.current_user_role() is distinct from 'owner' then$a$,
    $b$or not public.access_company('company.partners', 'read') then$b$);

  d := pg_get_functiondef('public.list_member_access(uuid)'::regprocedure);
  if position($a$or public.current_user_role() is distinct from 'owner' then$a$ in d) = 0 then
    raise exception 'list_member_access: anchor missing';
  end if;
  execute replace(d,
    $a$or public.current_user_role() is distinct from 'owner' then$a$,
    $b$or not public.access_company('company.partners', 'read') then$b$);

  -- ── Приглашения ──
  d := pg_get_functiondef('public.create_invitation(text,text,text,text,text,text,text[],text,text,jsonb)'::regprocedure);
  if position($a$or public.current_user_role() is distinct from 'owner' then
    raise exception 'only an owner can create invitations'$a$ in d) = 0
     or position($a$  v_team_id := v_team_ids[1];
$a$ in d) = 0
     or position($a$  perform public.access_validate_changes(v_tenant_id, v_team_ids, v_access);
$a$ in d) = 0 then
    raise exception 'create_invitation: anchor missing';
  end if;
  d := replace(d,
    $a$or public.current_user_role() is distinct from 'owner' then
    raise exception 'only an owner can create invitations'$a$,
    $b$or not (public.current_user_role() = 'owner' or public.access_company('company.partners', 'write')) then
    raise exception 'only an owner can create invitations'$b$);
  d := replace(d,
    $a$  v_team_id := v_team_ids[1];
$a$,
    $b$  v_team_id := v_team_ids[1];
  -- Директор зовёт только в свои команды (04.10).
  perform public.partners_check_teams(v_team_ids, array[]::text[]);
$b$);
  d := replace(d,
    $a$  perform public.access_validate_changes(v_tenant_id, v_team_ids, v_access);
$a$,
    $b$  perform public.access_validate_changes(v_tenant_id, v_team_ids, v_access);
  -- Ступени директора — не выше его собственных (04.10).
  perform public.partners_check_caps(v_tenant_id, null, v_access);
$b$);
  execute d;

  d := pg_get_functiondef('public.update_invitation(uuid,text,text,text[],text,text,jsonb)'::regprocedure);
  if position($a$or public.current_user_role() is distinct from 'owner' then
    raise exception 'only an owner can update invitations'$a$ in d) = 0
     or position($a$  perform public.access_validate_changes(v_tenant_id, v_team_ids, v_access);
$a$ in d) = 0 then
    raise exception 'update_invitation: anchor missing';
  end if;
  d := replace(d,
    $a$or public.current_user_role() is distinct from 'owner' then
    raise exception 'only an owner can update invitations'$a$,
    $b$or not (public.current_user_role() = 'owner' or public.access_company('company.partners', 'write')) then
    raise exception 'only an owner can update invitations'$b$);
  d := replace(d,
    $a$  perform public.access_validate_changes(v_tenant_id, v_team_ids, v_access);
$a$,
    $b$  perform public.access_validate_changes(v_tenant_id, v_team_ids, v_access);
  -- Директор: команды — только свои, ступени — не выше своих (04.10).
  perform public.partners_check_teams(v_team_ids, v_stored);
  perform public.partners_check_caps(v_tenant_id, null, v_access);
$b$);
  execute d;

  -- ── Карточка партнёра ──
  d := pg_get_functiondef('public.patch_master_profile(text,jsonb)'::regprocedure);
  if position($a$or public.current_user_role() is distinct from 'owner' then$a$ in d) = 0 then
    raise exception 'patch_master_profile: anchor missing';
  end if;
  execute replace(d,
    $a$or public.current_user_role() is distinct from 'owner' then$a$,
    $b$or not public.partners_card_manageable(p_master_id) then$b$);
end;
$patch$;

-- ── Чьи права можно менять ───────────────────────────────────────────────
create or replace function public.access_writer_target(p_user_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  active_tenant uuid := public.current_tenant_id();
  target_role text;
begin
  if auth.uid() is null or active_tenant is null
     or not (public.current_user_role() = 'owner' or public.access_company('company.partners', 'write')) then
    raise exception 'права меняет владелец' using errcode = '42501', hint = 'access:not_owner';
  end if;
  select tm.role into target_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant and tm.user_id = p_user_id;
  if target_role is null then
    raise exception 'человек не состоит в компании' using errcode = '22023', hint = 'access:not_member';
  end if;
  if p_user_id = auth.uid() or target_role = 'owner' then
    raise exception 'владелец не ограничивается' using errcode = '42501', hint = 'access:target_owner';
  end if;
  -- Директор не трогает других директоров (04.10).
  if not public.partners_manageable(p_user_id) then
    raise exception 'Права этого партнёра меняет владелец'
      using errcode = '42501', hint = 'access:not_manageable';
  end if;
  return active_tenant;
end;
$$;

create or replace function public.set_member_access(p_user_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  active_tenant uuid := public.access_writer_target(p_user_id);
  attached text[];
begin
  -- Все прикреплённые календари, архивные тоже: экран прав их показывает, и
  -- уровень там должен сниматься.
  select coalesce(array_agg(mc.team_id), array[]::text[])
    into attached
    from public.member_calendars mc
   where mc.tenant_id = active_tenant and mc.user_id = p_user_id;

  -- Та же проверка и тот же писатель, что у приглашения: права, выставленные
  -- в карточке до «Пригласить», и права, поправленные потом, — одно и то же.
  -- Неживые блоки больше не отказываются (владелец 15.09).
  perform public.access_validate_changes(active_tenant, attached, p_changes);
  -- Директор (04.10): ступени не выше своих, право «Партнёры» — владельцу.
  perform public.partners_check_caps(active_tenant, p_user_id, p_changes);
  perform public.access_apply_changes(active_tenant, p_user_id, p_changes, auth.uid());

  return public.access_map_for(active_tenant, p_user_id, true);
end;
$$;

create or replace function public.set_member_calendars(p_user_id uuid, p_team_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  active_tenant uuid := public.access_writer_target(p_user_id);
  wanted text[] := coalesce(p_team_ids, array[]::text[]);
  stored text[];
  foreign_team text;
begin
  select w into foreign_team
    from unnest(wanted) as w
   where not exists (select 1 from public.teams t where t.tenant_id = active_tenant and t.id = w)
   limit 1;
  if foreign_team is not null then
    raise exception 'календарь % не из этой компании', foreign_team using errcode = '22023', hint = 'access:bad_team';
  end if;

  -- Директор добавляет и снимает только свои команды (04.10).
  select coalesce(array_agg(mc.team_id), array[]::text[])
    into stored
    from public.member_calendars mc
   where mc.tenant_id = active_tenant and mc.user_id = p_user_id;
  perform public.partners_check_teams(wanted, stored);

  delete from public.member_calendars mc
   where mc.tenant_id = active_tenant
     and mc.user_id = p_user_id
     and not (mc.team_id = any(wanted));

  insert into public.member_calendars (tenant_id, user_id, team_id, attached_by, attached_at)
  select distinct active_tenant, p_user_id, w, auth.uid(), now()
    from unnest(wanted) as w
  on conflict (tenant_id, user_id, team_id) do nothing;

  perform public.seed_records_level(active_tenant, p_user_id, auth.uid());

  return public.access_map_for(active_tenant, p_user_id, true);
end;
$$;

-- ── Политики ─────────────────────────────────────────────────────────────
drop policy if exists invitations_partners_select on public.invitations;
create policy invitations_partners_select on public.invitations
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.access_company('company.partners', 'read'))
  );

drop policy if exists invitations_partners_delete on public.invitations;
create policy invitations_partners_delete on public.invitations
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.access_company('company.partners', 'write'))
    and accepted_at is null
    and invited_by_user_id = (select auth.uid())
  );

-- Удаление видит только строки, открытые чтением: без этой политики директор
-- «убирал» партнёра впустую (0 строк). Список людей ему и так отдаёт
-- `list_members`.
drop policy if exists tenant_members_select_partners on public.tenant_members;
create policy tenant_members_select_partners on public.tenant_members
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.access_company('company.partners', 'read'))
  );

drop policy if exists tenant_members_delete_partners on public.tenant_members;
create policy tenant_members_delete_partners on public.tenant_members
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and public.partners_manageable(user_id)
  );

drop policy if exists masters_select_partners on public.masters;
create policy masters_select_partners on public.masters
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.access_company('company.partners', 'read'))
  );

drop policy if exists masters_update_partners on public.masters;
create policy masters_update_partners on public.masters
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and public.partners_card_manageable(id)
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and public.partners_card_manageable(id)
  );
