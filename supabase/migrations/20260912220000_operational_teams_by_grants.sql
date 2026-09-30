-- Список календарей мастера учитывает выданные права, а не только назначения.
--
-- `list_operational_teams_safe()` — единственный путь диспетчера и мастера к
-- списку календарей (сырой SELECT на `teams` им закрыт). Мастеру он собирает
-- календари через `current_user_team_ids()` — то есть по СТАРОМУ механизму:
-- `masters.team_id` плюс три jsonb-списка в самой команде.
--
-- Из-за этого выданные права не работали в самом видном месте: человек,
-- которому в календарь выдали `view` через `calendar_members`, переключался в
-- компанию и видел «Календарь ещё не назначен» — прав у него по базе не было
-- только с точки зрения старого механизма. Поймано вживую 2026-09-12 на
-- переключении контуров.
--
-- Теперь источника два, через ИЛИ: старые назначения И новые права. Это тот же
-- шаг «старое ИЛИ новое», что у политик записей и денег, — никто не теряет
-- доступ, а новые права начинают действовать сразу. Старую ветку снимем
-- вместе с остальными, когда интерфейс научится выдавать права.
--
-- Форма вызова новой ветки — подзапросом (`in (select unnest(...))`), иначе
-- функция считается на каждую строку. Старая ветка оставлена как была: менять
-- её форму здесь значит смешивать две причины в одной правке.

create or replace function public.list_operational_teams_safe()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', t.id,
    'tenant_id', t.tenant_id,
    'name', t.name,
    'region', t.region,
    'color', t.color,
    'is_active', t.is_active,
    'position', t.position,
    'timezone', t.timezone,
    'default_city', t.default_city,
    'cities', t.cities,
    'tint_days_by_label', t.tint_days_by_label,
    'hide_cancelled', t.hide_cancelled,
    'allow_overtime', t.allow_overtime,
    'appointment_blocks', t.appointment_blocks,
    'buffer_minutes', t.buffer_minutes,
    'calendar_window_start', t.calendar_window_start,
    'calendar_window_end', t.calendar_window_end,
    'default_scroll_time', t.default_scroll_time,
    'default_slot_minutes', t.default_slot_minutes,
    'created_at', t.created_at,
    'updated_at', t.updated_at
  )
    from public.teams t
   where public.current_user_role() in ('dispatcher', 'master')
     and t.tenant_id = public.current_tenant_id()
     and (
       public.current_user_role() = 'dispatcher'
       or t.id = any(public.current_user_team_ids())
       or t.id in (select unnest(public.current_user_calendar_ids('view')))
     )
   order by t.position, t.name, t.id
$$;

revoke all on function public.list_operational_teams_safe()
  from public, anon, authenticated;
grant execute on function public.list_operational_teams_safe()
  to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'list_operational_teams_safe'
       and position('current_user_calendar_ids' in p.prosrc) > 0
  ) then
    raise exception 'список календарей мастера не знает о правах на календарь';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'list_operational_teams_safe'
       and position('current_user_team_ids' in p.prosrc) > 0
  ) then
    raise exception 'старые назначения выброшены раньше времени';
  end if;
end $$;
