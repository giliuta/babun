-- НАСТРОЙКИ КОМАНДЫ — ПРАВА И ДВЕРЬ СОТРУДНИКА (владелец 30.09: «в
-- „Настройки команды" — полностью, чётко как в шестерёнке, вплоть до
-- изменения названия команды»; удаление календаря — нет: «удаление не буду
-- вообще добавлять сюда»; «не будет разделения „владелец, директор": если я
-- предоставляю доступ, что он может это редактировать, значит он может это
-- полностью всё редактировать; не хочу — сделаю, чтобы просто видел или
-- вообще не видел»).
--
-- Шаг 1 — настройки, что лежат в самой строке команды (`teams`):
--   • «Название и цвет» — `calendar.identity`: name, color, icon;
--   • «Часовой пояс»    — `calendar.timezone`: timezone;
--   • «Часы календаря»  — `calendar.hours`: calendar_window_start/end;
--   • «График команды»  — `calendar.schedule` (живое с 16.09): дни, часы и
--     перерывы дня пускает политика `team_schedules_write_access`, а
--     перерыв после записи — buffer_minutes — эта дверь.
-- Ступени у всех «Скрыт · Только видит · Видит и меняет» (off · read · write);
-- «Видит и меняет» — всё в строке. По умолчанию у сотрудника «Скрыт».
--
-- Строку `teams` меняет только владелец (`teams_write_owner`), поэтому
-- сотруднику — дверь `member_update_team`: каждое поле по праву ЕГО строки,
-- незнакомое поле не принимается никогда.

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values
  ('calendar.identity', 'calendar', 'calendar', array['off', 'read', 'write'], 'Название и цвет', false, true,
   array['function:public.member_update_team(text, jsonb)'], 76),
  ('calendar.timezone', 'calendar', 'calendar', array['off', 'read', 'write'], 'Часовой пояс', false, true,
   array['function:public.member_update_team(text, jsonb)'], 77),
  ('calendar.hours', 'calendar', 'calendar', array['off', 'read', 'write'], 'Часы календаря', false, true,
   array['function:public.member_update_team(text, jsonb)'], 78)
on conflict (key) do update
  set area = excluded.area,
      scope = excluded.scope,
      levels = excluded.levels,
      title_ru = excluded.title_ru,
      owner_only = excluded.owner_only,
      live = excluded.live,
      enforced_by = excluded.enforced_by,
      position = excluded.position;

CREATE OR REPLACE FUNCTION public.member_update_team(p_team text, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  k text;
  v_block text;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'master' then
    raise exception 'only an employee can use this team update' using errcode = '42501';
  end if;
  if p_team is null or p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'team and a non-empty patch are required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.teams t
     where t.tenant_id = public.current_tenant_id() and t.id = p_team and t.is_active
  ) then
    raise exception 'team not found' using errcode = 'P0002';
  end if;

  -- Каждое поле — по праву своей строки в «Настройках команды».
  for k in select jsonb_object_keys(p_patch) loop
    v_block := case
      when k in ('name', 'color', 'icon') then 'calendar.identity'
      when k = 'timezone' then 'calendar.timezone'
      when k in ('calendar_window_start', 'calendar_window_end') then 'calendar.hours'
      when k = 'buffer_minutes' then 'calendar.schedule'
      else null
    end;
    if v_block is null then
      raise exception 'access:field:%', k using errcode = '42501';
    end if;
    if not public.member_can(v_block, 'write', p_team) then
      raise exception 'access:block:%', v_block using errcode = '42501';
    end if;
  end loop;

  -- Значения — той же формы, что пишет экран владельца.
  if p_patch ? 'name'
     and (jsonb_typeof(p_patch -> 'name') <> 'string'
          or length(btrim(p_patch ->> 'name')) = 0
          or length(p_patch ->> 'name') > 80) then
    raise exception 'team name must be non-empty text' using errcode = '22023';
  end if;
  if p_patch ? 'color'
     and jsonb_typeof(p_patch -> 'color') <> 'null'
     and (jsonb_typeof(p_patch -> 'color') <> 'string' or (p_patch ->> 'color') !~ '^#[0-9A-Fa-f]{6}$') then
    raise exception 'team color must be #RRGGBB' using errcode = '22023';
  end if;
  if p_patch ? 'icon'
     and jsonb_typeof(p_patch -> 'icon') <> 'null'
     and (jsonb_typeof(p_patch -> 'icon') <> 'string' or length(p_patch ->> 'icon') > 64) then
    raise exception 'team icon must be a short name' using errcode = '22023';
  end if;
  if p_patch ? 'timezone'
     and jsonb_typeof(p_patch -> 'timezone') <> 'null'
     and (jsonb_typeof(p_patch -> 'timezone') <> 'string'
          or not exists (select 1 from pg_timezone_names z where z.name = p_patch ->> 'timezone')) then
    raise exception 'unknown timezone' using errcode = '22023';
  end if;
  if (p_patch ? 'calendar_window_start'
      and jsonb_typeof(p_patch -> 'calendar_window_start') <> 'null'
      and (p_patch ->> 'calendar_window_start') !~ '^([01][0-9]|2[0-4]):[0-5][0-9]$')
     or (p_patch ? 'calendar_window_end'
      and jsonb_typeof(p_patch -> 'calendar_window_end') <> 'null'
      and (p_patch ->> 'calendar_window_end') !~ '^([01][0-9]|2[0-4]):[0-5][0-9]$') then
    raise exception 'calendar hours must be HH:MM' using errcode = '22023';
  end if;
  if p_patch ? 'buffer_minutes'
     and jsonb_typeof(p_patch -> 'buffer_minutes') <> 'null'
     and (jsonb_typeof(p_patch -> 'buffer_minutes') <> 'number'
          or (p_patch ->> 'buffer_minutes')::numeric <> floor((p_patch ->> 'buffer_minutes')::numeric)
          or (p_patch ->> 'buffer_minutes')::integer not between 0 and 1439) then
    raise exception 'buffer must be whole minutes within a day' using errcode = '22023';
  end if;

  update public.teams t
     set name = case when p_patch ? 'name' then btrim(p_patch ->> 'name') else t.name end,
         color = case when p_patch ? 'color' then p_patch ->> 'color' else t.color end,
         icon = case when p_patch ? 'icon' then p_patch ->> 'icon' else t.icon end,
         timezone = case when p_patch ? 'timezone' then p_patch ->> 'timezone' else t.timezone end,
         calendar_window_start = case
           when p_patch ? 'calendar_window_start' then p_patch ->> 'calendar_window_start'
           else t.calendar_window_start
         end,
         calendar_window_end = case
           when p_patch ? 'calendar_window_end' then p_patch ->> 'calendar_window_end'
           else t.calendar_window_end
         end,
         buffer_minutes = case
           when p_patch ? 'buffer_minutes' then (p_patch ->> 'buffer_minutes')::integer
           else t.buffer_minutes
         end
   where t.tenant_id = public.current_tenant_id()
     and t.id = p_team;

  return jsonb_build_object('id', p_team);
end;
$function$;

revoke all on function public.member_update_team(text, jsonb) from public, anon;
grant execute on function public.member_update_team(text, jsonb) to authenticated;

update public.access_blocks
   set enforced_by = enforced_by || array['function:public.member_update_team(text, jsonb)']
 where key = 'calendar.schedule'
   and not ('function:public.member_update_team(text, jsonb)' = any(enforced_by));
