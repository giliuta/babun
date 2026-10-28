-- СПРАВОЧНИКИ КЛИЕНТА — ТОЛЬКО СВОИХ ЖИВЫХ КОМАНД (P0 «изоляция клиентов»).
--
-- Владелец: «клиенты так, чтобы муха не пролетела» — ни меток, ни тегов, ни
-- типов объектов чужих и удалённых календарей. Три чтения отдавали партнёру
-- больше, чем его команды:
--   • `client_tags_select` открывал ВСЕ теги компании любому, у кого
--     «Клиенты: Видит» хоть в одной команде (`access_company('clients')`), —
--     теги чужих и архивных календарей тоже. Теперь — теги команд, где он
--     видит клиентов или правит теги (`access_calendars` — только живые
--     календари, где он работает).
--   • `cities_select` открывал метки всех прикреплённых команд, архивных
--     тоже, и удалённые метки (`deleted_at`). Теперь читатель видит метки
--     своих живых команд без удалённых; кто правит метки (владелец,
--     диспетчер, «Метки: Меняет») — по-прежнему все, с удалёнными: экран
--     «Метки» их возвращает.
--   • `location_labels_operational_read` отдавал любому сотруднику типы
--     объектов всех команд компании. Теперь партнёр — типы своих живых
--     команд; владелец и диспетчер — все.
-- Для выбора метки (шторка клиента, день) — представление `cities_live`:
-- без удалённых и без меток архивных календарей, под теми же правами строки.
-- Живые команды читаются помощниками с правами владельца: таблицу `teams`
-- партнёру RLS не показывает, и подзапрос политики под ним был бы пуст.

create or replace function public.member_active_team_ids()
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(mc.team_id order by mc.team_id), array[]::text[])
    from public.member_calendars mc
    join public.teams t
      on t.tenant_id = mc.tenant_id
     and t.id = mc.team_id
     and t.is_active
   where mc.tenant_id = public.current_tenant_id()
     and mc.user_id = auth.uid()
$function$;

create or replace function public.tenant_active_team_ids()
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(t.id order by t.id), array[]::text[])
    from public.teams t
   where t.tenant_id = public.current_tenant_id()
     and t.is_active
$function$;

revoke execute on function public.member_active_team_ids() from public, anon;
revoke execute on function public.tenant_active_team_ids() from public, anon;
grant execute on function public.member_active_team_ids() to authenticated;
grant execute on function public.tenant_active_team_ids() to authenticated;

drop policy client_tags_select on public.client_tags;
create policy client_tags_select on public.client_tags
  as permissive for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or team_id in (select unnest(public.access_calendars('clients', 'read')))
      or team_id in (select unnest(public.access_calendars('clients.settings_tags', 'write')))
    )
  );

drop policy cities_select on public.cities;
create policy cities_select on public.cities
  as permissive for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) in ('owner', 'dispatcher')
      or team_id in (select unnest(public.access_calendars('calendar.labels', 'write')))
      or (
        deleted_at is null
        and team_id in (select unnest(public.member_active_team_ids()))
      )
    )
  );

drop policy location_labels_operational_read on public.location_labels;
create policy location_labels_operational_read on public.location_labels
  as permissive for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) in ('owner', 'dispatcher')
      or team_id in (select unnest(public.member_active_team_ids()))
    )
  );

create view public.cities_live
  with (security_invoker = true)
  as
  select c.*
    from public.cities c
   where c.deleted_at is null
     and c.team_id = any(public.tenant_active_team_ids());

revoke all on public.cities_live from public, anon;
grant select on public.cities_live to authenticated;

do $guard$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'client_tags' and policyname = 'client_tags_select'
       and qual like '%access_company(%'
  ) then
    raise exception 'client_tags_select снова открывает теги всей компании';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'cities' and policyname = 'cities_select'
       and qual like '%deleted_at IS NULL%' and qual like '%member_active_team_ids%'
  ) then
    raise exception 'cities_select снова отдаёт удалённые и архивные метки';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'location_labels' and policyname = 'location_labels_operational_read'
       and qual like '%member_active_team_ids%'
  ) then
    raise exception 'location_labels снова открыты всей компании';
  end if;
  if has_table_privilege('anon', 'public.cities_live', 'select') then
    raise exception 'cities_live открыт anon';
  end if;
end;
$guard$;
