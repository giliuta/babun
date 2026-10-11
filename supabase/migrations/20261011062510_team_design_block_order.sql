-- ПОРЯДОК БЛОКОВ ЗАПИСИ И СОБЫТИЯ — У КОМАНДЫ (владелец 11.10: «брат хотел бы
-- в событиях и клиентах менять местонахождение блока — поставить первым
-- объект, вторым клиент — и самому редактировать»).
--
-- Порядок живёт там же, где выключенные блоки: в строке `team_design` команды,
-- и правится тем же правом «Записи» (`calendar.booking_form`). `null` — команда
-- порядок не меняла, форма стоит как всегда. В массиве — только подвижные
-- блоки (команда и время всегда сверху), неизвестные приложение пропускает.

alter table public.team_design
  add column if not exists record_order text[],
  add column if not exists event_order text[];

-- Сторож колонок — действующее тело (снято с боевой 11.10) плюс две колонки
-- порядка в части «Записи».
create or replace function public.team_design_guard_columns()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  old_blocks text[] := array[]::text[];
  new_blocks text[];
  old_rule text := 'team';
  old_palette jsonb;
  old_fallback text;
  old_list text[];
  old_ways jsonb;
  old_maps jsonb;
  old_months integer;
  old_record_order text[];
  old_event_order text[];
  team text;
begin
  if auth.uid() is null or public.current_user_role() is not distinct from 'owner' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'удалять настройки команды может только владелец'
      using errcode = '42501', hint = 'access:owner';
  end if;

  -- Приложение пишет «вставить или обновить» (`upsert`): строка команды уже
  -- есть — вставка уйдёт в обновление, и сверять надо с ней, а не с
  -- умолчаниями. Это сделает тот же сторож на шаге обновления.
  if tg_op = 'INSERT' and exists (
    select 1 from public.team_design d
     where d.tenant_id = new.tenant_id and d.team_id = new.team_id
  ) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    old_blocks := coalesce(old.disabled_blocks, array[]::text[]);
    old_rule := old.record_color_rule;
    old_palette := old.record_color_palette;
    old_fallback := old.record_color_fallback;
    old_list := old.client_list_off;
    old_ways := old.contact_ways;
    old_maps := old.map_services;
    old_months := old.service_every_months;
    old_record_order := old.record_order;
    old_event_order := old.event_order;
    if new.team_id is distinct from old.team_id or new.tenant_id is distinct from old.tenant_id then
      raise exception 'строку настроек нельзя перенести в другую команду'
        using errcode = '42501', hint = 'access:owner';
    end if;
  end if;

  team := new.team_id;
  new_blocks := coalesce(new.disabled_blocks, array[]::text[]);

  -- «Записи»: цвет записи, блоки формы (всё, что не `client_*`) и их порядок.
  if new.record_color_rule is distinct from old_rule
     or new.record_color_palette is distinct from old_palette
     or new.record_color_fallback is distinct from old_fallback
     or new.record_order is distinct from old_record_order
     or new.event_order is distinct from old_event_order
     or array(select b from unnest(new_blocks) b where b not like 'client\_%' order by b)
        is distinct from array(select b from unnest(old_blocks) b where b not like 'client\_%' order by b)
  then
    if not team = any(public.access_calendars('calendar.booking_form', 'write')) then
      raise exception 'нет права менять «Записи» этой команды'
        using errcode = '42501', hint = 'block:calendar.booking_form';
    end if;
  end if;

  -- «Карточка клиента»: строка списка и блоки карточки.
  if new.client_list_off is distinct from old_list
     or array(select b from unnest(new_blocks) b where b like 'client\_%' order by b)
        is distinct from array(select b from unnest(old_blocks) b where b like 'client\_%' order by b)
  then
    if not team = any(public.access_calendars('clients.settings_card', 'write')) then
      raise exception 'нет права менять «Карточку клиента» этой команды'
        using errcode = '42501', hint = 'block:clients.settings_card';
    end if;
  end if;

  if new.contact_ways is distinct from old_ways
     and not team = any(public.access_calendars('clients.settings_ways', 'write')) then
    raise exception 'нет права менять «Способы связи» этой команды'
      using errcode = '42501', hint = 'block:clients.settings_ways';
  end if;

  if new.map_services is distinct from old_maps
     and not team = any(public.access_calendars('clients.settings_maps', 'write')) then
    raise exception 'нет права менять «Карты для маршрута» этой команды'
      using errcode = '42501', hint = 'block:clients.settings_maps';
  end if;

  if new.service_every_months is distinct from old_months
     and not team = any(public.access_calendars('clients.settings_objects', 'write')) then
    raise exception 'нет права менять «Типы объектов» этой команды'
      using errcode = '42501', hint = 'block:clients.settings_objects';
  end if;

  return new;
end;
$function$;

revoke all on function public.team_design_guard_columns() from public, anon;
