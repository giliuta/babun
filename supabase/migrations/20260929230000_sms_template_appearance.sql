-- SMS, ВОЛНА 9 (STORY-089): ШАБЛОН — СПРАВОЧНИК ПО КАНОНУ.
--
-- Владелец 29.09: «шаблоны не надо подготовленные — если нужно, я сам ставлю…
-- шторка снизу, можно выбрать иконку, можно выбрать цвет, полноценный блок
-- красивый, слева скрыть, справа удалить… в нашей архитектуре». Шаблон SMS
-- становится справочником, как метки и типы событий:
--   • вид — цвет и значок (`color`, `icon`), строка списка заливается цветом;
--   • порядок — ручкой в самом списке (`sms_reorder_team_templates`);
--   • «Скрыть» — это `enabled = false`: скрытый шаблон не уходит сам и не
--     предлагается в листе «SMS клиенту», но помнит всё.
-- Готовые шаблоны, заведённые волной 8 (по шесть на команду, никем не
-- тронутые, ни одного SMS по ним), удаляются: шаблоны заводит владелец.

alter table public.sms_team_templates
  add column if not exists color text,
  add column if not exists icon text;

alter table public.sms_team_templates
  drop constraint if exists sms_team_templates_color_check;
alter table public.sms_team_templates
  add constraint sms_team_templates_color_check
  check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
alter table public.sms_team_templates
  drop constraint if exists sms_team_templates_icon_check;
alter table public.sms_team_templates
  add constraint sms_team_templates_icon_check
  check (icon is null or length(icon) between 1 and 40);

-- Заготовки волны 8: только нетронутые и без единого сообщения.
delete from public.sms_team_templates t
 where t.updated_at = t.created_at
   and t.name in ('Подтверждение записи', 'Напоминание накануне', 'Перенос', 'Отмена', 'Спасибо', 'Выехал к вам')
   and not exists (select 1 from public.sms_messages m where m.template_id = t.id::text);

/** Шаблон строкой ответа. */
create or replace function public.sms_team_template_json(t public.sms_team_templates)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', t.id,
    'team_id', t.team_id,
    'name', t.name,
    'body', t.body,
    'trigger', t.trigger,
    'hours', t.hours,
    'at_time', t.at_time,
    'months', t.months,
    'send_from', t.send_from,
    'send_to', t.send_to,
    'color', t.color,
    'icon', t.icon,
    'enabled', t.enabled,
    'position', t.position
  )
$function$;

/** Сохранить шаблон (новый — без id). Только владелец. Срок чистится под
 *  выбранное «когда»: лишние поля обнуляются, недостающие — отказ. */
create or replace function public.sms_save_team_template(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_team text := nullif(trim(coalesce(p ->> 'team_id', '')), '');
  v_trigger text := coalesce(nullif(p ->> 'trigger', ''), 'manual');
  v_hours integer := case when v_trigger in ('before', 'after') then nullif(p ->> 'hours', '')::integer end;
  v_at text := case when v_trigger = 'day_before' then nullif(p ->> 'at_time', '') end;
  v_months integer := case when v_trigger = 'repeat' then nullif(p ->> 'months', '')::integer end;
  v_from smallint := coalesce(nullif(p ->> 'send_from', '')::smallint, 8);
  v_to smallint := coalesce(nullif(p ->> 'send_to', '')::smallint, 21);
  v_color text := nullif(trim(coalesce(p ->> 'color', '')), '');
  v_icon text := nullif(trim(coalesce(p ->> 'icon', '')), '');
  saved public.sms_team_templates%rowtype;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms: owner only' using errcode = '42501';
  end if;
  if v_team is null or not exists (select 1 from public.teams t where t.tenant_id = v_tenant and t.id = v_team) then
    raise exception 'sms: bad team' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.sms_team_templates (
      tenant_id, team_id, name, body, trigger, hours, at_time, months, send_from, send_to,
      color, icon, enabled, position
    ) values (
      v_tenant, v_team, trim(p ->> 'name'), trim(p ->> 'body'), v_trigger, v_hours, v_at, v_months, v_from, v_to,
      v_color, v_icon,
      coalesce((p ->> 'enabled')::boolean, true),
      coalesce((select max(position) + 1 from public.sms_team_templates
                 where tenant_id = v_tenant and team_id = v_team), 0)
    )
    returning * into saved;
  else
    update public.sms_team_templates set
      name = trim(p ->> 'name'),
      body = trim(p ->> 'body'),
      trigger = v_trigger,
      hours = v_hours,
      at_time = v_at,
      months = v_months,
      send_from = v_from,
      send_to = v_to,
      color = v_color,
      icon = v_icon,
      enabled = coalesce((p ->> 'enabled')::boolean, enabled),
      updated_at = now()
    where id = v_id and tenant_id = v_tenant and team_id = v_team
    returning * into saved;
    if not found then
      raise exception 'sms: template not found' using errcode = 'P0002';
    end if;
  end if;
  return public.sms_team_template_json(saved);
end;
$function$;

/** Порядок шаблонов команды — как лёг список после ручки. Чужие и
 *  неизвестные id пропускаются молча. Только владелец. */
create or replace function public.sms_reorder_team_templates(p_team_id text, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms: owner only' using errcode = '42501';
  end if;
  update public.sms_team_templates t
     set position = o.ord - 1, updated_at = now()
    from unnest(p_ids) with ordinality as o(id, ord)
   where t.id = o.id and t.tenant_id = v_tenant and t.team_id = p_team_id;
end;
$function$;

revoke all on function public.sms_team_template_json(public.sms_team_templates) from public, anon, authenticated;
revoke all on function public.sms_save_team_template(jsonb) from public, anon;
grant execute on function public.sms_save_team_template(jsonb) to authenticated;
revoke all on function public.sms_reorder_team_templates(text, uuid[]) from public, anon;
grant execute on function public.sms_reorder_team_templates(text, uuid[]) to authenticated;

do $audit$
begin
  if has_function_privilege('anon', 'public.sms_reorder_team_templates(text, uuid[])', 'execute')
     or has_function_privilege('anon', 'public.sms_save_team_template(jsonb)', 'execute') then
    raise exception 'sms template functions are callable by anon';
  end if;
end
$audit$;
