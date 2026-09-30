-- «Какие календари у меня есть» — через границу компаний.
--
-- Человек в модели владельца живёт сразу в нескольких контурах: свой личный
-- и те компании, куда его добавили. Чтобы показать ему список, приложению
-- нужны имена — а сегодня их взять неоткуда: политика `tenants_select_owner`
-- отдаёт строку компании только владельцу и только для АКТИВНОЙ компании.
-- Свои членства человек прочитать может (`tenant_members_select_owner_or_self`),
-- но это голые id без названий.
--
-- Поэтому безопасная функция: без аргументов, всё от `auth.uid()`, наружу
-- только то, что нужно переключателю — название компании, название календаря,
-- цвет, роль и права. Ни телефона компании, ни реквизитов, ни чужих людей.
--
-- КТО КАКИЕ КАЛЕНДАРИ ВИДИТ:
--   • владелец компании — все её календари (он их и завёл);
--   • остальные — ровно те, что выданы в `calendar_members`.
-- Это же правило и в политиках: список не имеет права быть щедрее доступа.

create or replace function public.list_my_calendars()
returns table (
  tenant_id   uuid,
  tenant_name text,
  team_id     text,
  team_name   text,
  team_color  text,
  role        text,
  grants      text[],
  is_active   boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select t.tenant_id,
         tn.name,
         t.id,
         t.name,
         t.color,
         tm.role,
         case
           when tm.role = 'owner' then array[
             'view','book','edit_all','clients','phones','finance','close_day','settings'
           ]::text[]
           else coalesce(cm.grants, array[]::text[])
         end,
         t.tenant_id = public.current_tenant_id()
    from public.tenant_members tm
    join public.tenants tn on tn.id = tm.tenant_id
    join public.teams t on t.tenant_id = tm.tenant_id
    left join public.calendar_members cm
      on cm.tenant_id = t.tenant_id
     and cm.team_id = t.id
     and cm.user_id = tm.user_id
   where tm.user_id = auth.uid()
     and (tm.role = 'owner' or cm.user_id is not null)
     and t.is_active
   order by (t.tenant_id = public.current_tenant_id()) desc, tn.name, t.position, t.name
$$;

revoke all on function public.list_my_calendars() from public, anon;
grant execute on function public.list_my_calendars() to authenticated;

comment on function public.list_my_calendars() is
  'Календари человека во ВСЕХ его компаниях — для переключателя контуров. '
  'Владелец видит все календари своей компании, остальные — только выданные '
  'в calendar_members. Наружу идут только имя, цвет, роль и права.';

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'list_my_calendars'
  ) then
    raise exception 'list_my_calendars: функция не встала';
  end if;

  if has_function_privilege('anon', 'public.list_my_calendars()', 'EXECUTE') then
    raise exception 'list_my_calendars: функция открыта анониму';
  end if;
end $$;
