-- ПРИКРЕПЛЕНИЕ К КАЛЕНДАРЮ — ОДНА ПРАВДА ДЛЯ ДВУХ ТАБЛИЦ (STORY-087, аудит
-- 23.09).
--
-- У сотрудника две таблицы календарей:
--   • `member_calendars` — прикрепление в модели прав по блокам. Её пишет
--     страница сотрудника (`set_member_calendars`) и по ней считаются уровни
--     (`access_calendars*`, окно записей мастера);
--   • `calendar_members` — прежняя. По ней приложение сотрудника строит СПИСОК
--     его календарей (`list_my_calendars`, `list_operational_teams_safe`), а
--     диспетчеру по ней открываются строки записей (`appointments_select`
--     через `current_user_calendar_ids`).
--
-- `set_member_calendars` правил только первую. Итог:
--   • владелец прикрепил мастера ко второму календарю — у мастера этого
--     календаря в приложении НЕТ (строки старой таблицы нет);
--   • владелец открепил — календарь у человека ОСТАЁТСЯ, а диспетчер
--     продолжает читать и править его записи (утечка, аудит 23.09).
--
-- Решение: старая таблица — ЗЕРКАЛО новой. Триггер на `member_calendars`:
-- прикрепили — в `calendar_members` строка с правами по роли (как при приёме
-- приглашения: диспетчер — `view, book, edit_all, clients, phones`, мастер —
-- `view`), открепили — строка уходит. Существующие строки не переписываются
-- (`on conflict do nothing`): их права могли настроить руками. Разовая сверка
-- в конце доводит расхождения до зеркала.

create or replace function public.mirror_member_calendar()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role text;
  v_master_id text;
begin
  if tg_op = 'INSERT' then
    select tm.role, tm.master_id
      into v_role, v_master_id
      from public.tenant_members tm
     where tm.tenant_id = new.tenant_id
       and tm.user_id = new.user_id;
    -- Владельцу строка не нужна: он видит всё и так.
    if v_role is null or v_role = 'owner' then
      return new;
    end if;
    insert into public.calendar_members (tenant_id, team_id, user_id, master_id, grants, created_by)
    values (
      new.tenant_id,
      new.team_id,
      new.user_id,
      v_master_id,
      case v_role
        when 'dispatcher' then array['view','book','edit_all','clients','phones']::text[]
        else array['view']::text[]
      end,
      new.attached_by
    )
    on conflict (tenant_id, team_id, user_id) do nothing;
    return new;
  end if;

  delete from public.calendar_members cm
   where cm.tenant_id = old.tenant_id
     and cm.team_id = old.team_id
     and cm.user_id = old.user_id;
  return old;
end;
$function$;

revoke all on function public.mirror_member_calendar() from public, anon, authenticated;

drop trigger if exists member_calendars_mirror on public.member_calendars;
create trigger member_calendars_mirror
  after insert or delete on public.member_calendars
  for each row execute function public.mirror_member_calendar();

-- ─── Разовая сверка ──────────────────────────────────────────────────────
-- Прикреплён в новой, нет в старой — добавить (владельцев не трогаем).
insert into public.calendar_members (tenant_id, team_id, user_id, master_id, grants, created_by)
select mc.tenant_id,
       mc.team_id,
       mc.user_id,
       tm.master_id,
       case tm.role
         when 'dispatcher' then array['view','book','edit_all','clients','phones']::text[]
         else array['view']::text[]
       end,
       mc.attached_by
  from public.member_calendars mc
  join public.tenant_members tm
    on tm.tenant_id = mc.tenant_id and tm.user_id = mc.user_id
 where tm.role <> 'owner'
on conflict (tenant_id, team_id, user_id) do nothing;

-- Есть в старой, откреплён в новой — убрать (у не-владельцев).
delete from public.calendar_members cm
 using public.tenant_members tm
 where tm.tenant_id = cm.tenant_id
   and tm.user_id = cm.user_id
   and tm.role <> 'owner'
   and not exists (
     select 1 from public.member_calendars mc
      where mc.tenant_id = cm.tenant_id
        and mc.team_id = cm.team_id
        and mc.user_id = cm.user_id
   );

-- ─── Сторож ──────────────────────────────────────────────────────────────
do $audit$
declare
  bad integer;
begin
  select count(*) into bad
    from (
      select mc.tenant_id, mc.team_id, mc.user_id
        from public.member_calendars mc
        join public.tenant_members tm on tm.tenant_id = mc.tenant_id and tm.user_id = mc.user_id
       where tm.role <> 'owner'
      except
      select cm.tenant_id, cm.team_id, cm.user_id
        from public.calendar_members cm
    ) missing;
  if bad > 0 then
    raise exception 'member_calendars rows without a calendar_members mirror: %', bad;
  end if;

  select count(*) into bad
    from public.calendar_members cm
    join public.tenant_members tm on tm.tenant_id = cm.tenant_id and tm.user_id = cm.user_id
   where tm.role <> 'owner'
     and not exists (
       select 1 from public.member_calendars mc
        where mc.tenant_id = cm.tenant_id and mc.team_id = cm.team_id and mc.user_id = cm.user_id
     );
  if bad > 0 then
    raise exception 'calendar_members rows of detached calendars: %', bad;
  end if;

  if has_function_privilege('anon', 'public.mirror_member_calendar()', 'execute')
     or has_function_privilege('authenticated', 'public.mirror_member_calendar()', 'execute') then
    raise exception 'mirror_member_calendar is callable directly';
  end if;
end
$audit$;
