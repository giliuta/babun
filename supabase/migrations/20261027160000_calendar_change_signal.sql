-- СИГНАЛ «ЗАПИСЬ КАЛЕНДАРЯ ИЗМЕНИЛАСЬ» — ДЛЯ ТЕХ, КОМУ ТАБЛИЦА ЗАКРЫТА. Накачена 27.10.2026, md5 тел = файлу.
--
-- Владелец узнаёт о чужой правке записи через `postgres_changes` на
-- `appointments`: Realtime отдаёт событие тому, кому строку показывает
-- политика `appointments_select`. Сотруднику (мастеру) таблица закрыта — он
-- читает записи только дверью `list_master_appointments_safe`, которая
-- маскирует поля по его блокам. Значит `postgres_changes` ему не отдаёт
-- ничего, и перенос от диспетчера он видел, только перезапустив приложение.
--
-- Открывать мастеру таблицу ради событий нельзя: событие `postgres_changes`
-- несёт строку ЦЕЛИКОМ, мимо масок двери. Поэтому здесь отдельный канал:
--   * триггер после любой правки записи шлёт в приватную тему
--     `calendar:<команда>` только номер записи, её `updated_at` и вид
--     правки — ни клиента, ни сумм, ни заметок;
--   * слушать тему пускает политика `realtime.messages` — тех, кто видит
--     записи или события этого календаря (`access_calendars_of`, то же
--     правило, что у двери чтения), и владельца компании календаря;
--   * телефон по сигналу перечитывает записи той же дверью — маски остаются
--     на сервере.
--
-- Компания темы берётся из самой команды, а не из `current_tenant_id()`:
-- вход в канал Realtime не несёт заголовка `x-babun-tenant`, и человек,
-- состоящий в двух компаниях, иначе проверялся бы не той компанией.

create or replace function public.calendar_change_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_id uuid := coalesce(new.id, old.id);
  row_updated timestamptz := case when tg_op = 'DELETE' then null else new.updated_at end;
  new_team text := case when tg_op = 'DELETE' then null else new.team_id end;
  old_team text := case when tg_op = 'INSERT' then null else old.team_id end;
  payload jsonb;
begin
  payload := jsonb_build_object('id', row_id, 'updated_at', row_updated, 'op', tg_op);
  -- Сигнал — удобство, запись — данные: сбой отправки не откатывает правку
  -- записи, телефон всё равно перечитает календарь при возврате в приложение.
  begin
    if new_team is not null then
      perform realtime.send(payload, 'appointment_changed', 'calendar:' || new_team, true);
    end if;
    -- Запись ушла в другую команду: прежний календарь тоже должен её потерять.
    if old_team is not null and old_team is distinct from new_team then
      perform realtime.send(payload, 'appointment_changed', 'calendar:' || old_team, true);
    end if;
  exception when others then
    raise warning 'calendar_change_signal: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

revoke all on function public.calendar_change_signal() from public, anon, authenticated;

drop trigger if exists zz_calendar_change_signal on public.appointments;
create trigger zz_calendar_change_signal
  after insert or update or delete on public.appointments
  for each row execute function public.calendar_change_signal();

-- Кто слушает `calendar:<команда>`: владелец компании команды или сотрудник,
-- которому в этом календаре открыты записи либо события. Неверная тема,
-- чужая или неизвестная команда — отказ.
create or replace function public.can_watch_calendar(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  team text;
  team_tenant uuid;
begin
  if caller is null or p_topic is null or p_topic not like 'calendar:%' then
    return false;
  end if;
  team := substr(p_topic, length('calendar:') + 1);
  select t.tenant_id into team_tenant from public.teams t where t.id = team;
  if team_tenant is null then
    return false;
  end if;
  return team = any(public.access_calendars_of(team_tenant, caller, 'calendar.records', 'read'))
      or team = any(public.access_calendars_of(team_tenant, caller, 'calendar.events', 'read'));
end;
$$;

revoke all on function public.can_watch_calendar(text) from public, anon;
grant execute on function public.can_watch_calendar(text) to authenticated;

drop policy if exists calendar_channel_by_records_right on realtime.messages;
create policy calendar_channel_by_records_right
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'broadcast'
    and (select realtime.topic()) like 'calendar:%'
    and (select public.can_watch_calendar((select realtime.topic())))
  );
