-- НАСТРОЙКИ КОМАНДЫ, ШАГ 2 — «ЗАПИСИ», «УСЛУГИ», «МЕТКИ» (владелец 30.09:
-- «продолжаем дальше — Кабинет → Сотрудники и туда добавляем»; блок
-- «Настройки команды» — «полностью все функции, которые находятся в
-- настройках»). Ступени «Скрыт · Только видит · Видит и меняет»; «Видит и
-- меняет» — всё на странице (владелец 30.09: «разделения „владелец,
-- директор" не будет»). По умолчанию у сотрудника «Скрыт».
--
--   • «Записи» (до 30.09 — «Дизайн») — `calendar.booking_form`: блоки и цвет
--     записи (`team_design`), блоки и типы событий (`personal_event_types`),
--     «Обычный цвет» и «Скрывать отменённые» (`teams.color`,
--     `teams.hide_cancelled` — через дверь `member_update_team`).
--   • «Услуги» — `calendar.services` (новый ключ; старый `services` на всю
--     компанию так и остаётся неживым): строки `services` этой команды.
--   • «Метки» — `calendar.labels` (новый ключ): справочник меток команды
--     (`cities`). Ставить метку на день — другое право, «Метка дня».
--
-- Всё — по команде: и правка, и новая строка проходят, только если команда
-- строки — та, где у него право (`with check` не даёт увести строку или
-- завести её в чужой команде). Правила владельца и диспетчера не трогаются —
-- новые политики только добавляются к ним.

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values
  ('calendar.booking_form', 'calendar', 'calendar', array['off', 'read', 'write'], 'Записи', false, true,
   array[
     'policy:public.team_design.team_design_write_access',
     'policy:public.personal_event_types.personal_event_types_write_access',
     'function:public.member_update_team(text, jsonb)'
   ], 79),
  ('calendar.services', 'calendar', 'calendar', array['off', 'read', 'write'], 'Услуги', false, true,
   array[
     'policy:public.services.services_select_access',
     'policy:public.services.services_write_access',
     'policy:public.service_categories.service_categories_select_access'
   ], 80),
  ('calendar.labels', 'calendar', 'calendar', array['off', 'read', 'write'], 'Метки', false, true,
   array['policy:public.cities.cities_write_access'], 81)
on conflict (key) do update
  set area = excluded.area,
      scope = excluded.scope,
      levels = excluded.levels,
      title_ru = excluded.title_ru,
      owner_only = excluded.owner_only,
      live = excluded.live,
      enforced_by = excluded.enforced_by,
      position = excluded.position;

-- ── «Записи» ──────────────────────────────────────────────────────────────
create policy team_design_write_access on public.team_design
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('calendar.booking_form', 'write')))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('calendar.booking_form', 'write')))
  );

create policy personal_event_types_write_access on public.personal_event_types
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('calendar.booking_form', 'write')))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('calendar.booking_form', 'write')))
  );

-- ── «Метки» ───────────────────────────────────────────────────────────────
-- Читать метки могут все члены компании и сейчас (`cities_select_member`):
-- ими подписаны записи и дни.
create policy cities_write_access on public.cities
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('calendar.labels', 'write')))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('calendar.labels', 'write')))
  );

-- ── «Услуги» ──────────────────────────────────────────────────────────────
create policy services_select_access on public.services
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('calendar.services', 'read')))
  );

create policy services_write_access on public.services
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('calendar.services', 'write')))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('calendar.services', 'write')))
  );

-- Категории — на всю компанию (без команды): сотрудник с «Услугами» хоть в
-- одной команде их ЧИТАЕТ, чтобы список услуг стоял группами, как у
-- владельца. Заводить и править категории — только владельцу: правка
-- категории меняет прайс всех команд, а право сотрудника — одна команда.
create policy service_categories_select_access on public.service_categories
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select coalesce(cardinality(public.access_calendars('calendar.services', 'read')), 0)) > 0
  );

-- ── Дверь сотрудника к строке команды: «Скрывать отменённые» и «Обычный
--    цвет» страницы «Записи» (шаг 1 — `20260930030000_member_team_settings`).
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
    -- «Обычный цвет» на странице «Записи» — это цвет команды: его меняет и
    -- «Название и цвет», и «Записи» (владелец 30.09: «Видит и меняет» —
    -- всё на странице).
    if k = 'color'
       and (public.member_can('calendar.identity', 'write', p_team)
            or public.member_can('calendar.booking_form', 'write', p_team)) is true then
      continue;
    end if;
    v_block := case
      when k in ('name', 'color', 'icon') then 'calendar.identity'
      when k = 'timezone' then 'calendar.timezone'
      when k in ('calendar_window_start', 'calendar_window_end') then 'calendar.hours'
      when k = 'buffer_minutes' then 'calendar.schedule'
      when k = 'hide_cancelled' then 'calendar.booking_form'
      else null
    end;
    if v_block is null then
      raise exception 'access:field:%', k using errcode = '42501';
    end if;
    -- `is not true`, а не `not …`: пустой ответ проверки не пускает.
    if public.member_can(v_block, 'write', p_team) is not true then
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
  if p_patch ? 'hide_cancelled' and jsonb_typeof(p_patch -> 'hide_cancelled') <> 'boolean' then
    raise exception 'hide_cancelled must be true or false' using errcode = '22023';
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
         end,
         hide_cancelled = case
           when p_patch ? 'hide_cancelled' then (p_patch ->> 'hide_cancelled')::boolean
           else t.hide_cancelled
         end
   where t.tenant_id = public.current_tenant_id()
     and t.id = p_team;

  return jsonb_build_object('id', p_team);
end;
$function$;

revoke all on function public.member_update_team(text, jsonb) from public, anon;
grant execute on function public.member_update_team(text, jsonb) to authenticated;

-- ── Переименование метки в днях (`day_cities`) сотрудником «Меток» ───────
-- Имя метки лежит в днях строкой, и экран меток после переименования
-- разносит новое имя по дням этой команды. Дни пишет право «Метка дня», а у
-- сотрудника с «Метками: Видит и меняет» его может не быть — и переименование
-- оставило бы дни со старым именем. Эта дверь делает ровно разнос: только в
-- его команде, только по праву «Метки», и только в имя метки, которая в этой
-- команде уже есть.
CREATE OR REPLACE FUNCTION public.member_rename_day_label(p_team text, p_from text, p_to text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n integer;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'master' then
    raise exception 'only an employee can use this label rename' using errcode = '42501';
  end if;
  if p_team is null or p_from is null or p_to is null or length(btrim(p_to)) = 0 then
    raise exception 'team, old and new label names are required' using errcode = '22023';
  end if;
  if public.member_can('calendar.labels', 'write', p_team) is not true then
    raise exception 'access:block:calendar.labels' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.cities c
     where c.tenant_id = public.current_tenant_id()
       and c.team_id = p_team
       and c.name = p_to
       and c.deleted_at is null
  ) then
    raise exception 'label not found in this team' using errcode = 'P0002';
  end if;

  update public.day_cities d
     set city = p_to
   where d.tenant_id = public.current_tenant_id()
     and d.team_id = p_team
     and d.city = p_from;
  get diagnostics n = row_count;
  return n;
end;
$function$;

revoke all on function public.member_rename_day_label(text, text, text) from public, anon;
grant execute on function public.member_rename_day_label(text, text, text) to authenticated;

update public.access_blocks
   set enforced_by = enforced_by || array['function:public.member_rename_day_label(text, text, text)']
 where key = 'calendar.labels'
   and not ('function:public.member_rename_day_label(text, text, text)' = any(enforced_by));
