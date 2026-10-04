-- «ИСТОРИЯ ИЗМЕНЕНИЙ»: ЗАЩИТА И ПОЛНОТА (проверка системы 03.10).
--
-- • Журнал читает ТОЛЬКО владелец. Ветка «партнёр видит свои строки» давала
--   прочитать в `changes` поля, которые ему скрыты правами (сумма, клиент,
--   адрес у скопированной записи), — экраны партнёру журнал и так не
--   показывают.
-- • Имена клиентов и категорий ищутся только в своём аккаунте: чужой id
--   клиента в долге больше не подтягивает чужое имя.
-- • Личное событие без команды (его видит только автор) в журнал не идёт.
-- • «Удалить» через is_active (календарь, услуга, метка, тип объекта) — это
--   «удалён» / «возвращён», а не «Активность да → нет».
-- • Деньги, созданные триггером оплаты записи, теперь в журнале.
-- • Новое в журнале: тег у клиента, файлы клиента, фото записи, метки дня,
--   настройки календаря, реквизиты, шаблоны SMS, карточки партнёров. У прав —
--   название блока.
--
-- Тело `log_change()` — из `20261003214500_change_log_array_diff.sql` с этими
-- правками; остальное не тронуто.

set local lock_timeout = '5s';

drop policy if exists change_log_select on public.change_log;
create policy change_log_select on public.change_log
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'owner'
  );

create or replace function public.log_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_before jsonb;
  v_after jsonb;
  v_action text := lower(tg_op);
  v_tenant uuid;
  v_team text;
  v_entity_id text;
  v_label text;
  v_meta jsonb;
  v_actor uuid := auth.uid();
  v_ignore constant text[] := array[
    'updated_at', 'created_at', 'purge_at', 'access_version', 'set_at', 'set_by',
    'attached_at', 'attached_by', 'pinned_at', 'phone_e164', 'position'
  ];
begin
  -- Верхний уровень — кроме денег: доход и возврат от оплаты в записи
  -- создаёт триггер записи, и без них фильтр «Деньги» не видел бы главного
  -- пути дохода.
  if pg_trigger_depth() > 1 and tg_table_name <> 'finance_transactions' then
    return null;
  end if;
  -- Удаление календаря стирает его записи и настройки по одной — в журнале
  -- остаётся только сам «Календарь удалён».
  if tg_table_name <> 'teams' and public.calendar_delete_in_progress() then
    return null;
  end if;

  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);

  if tg_op = 'UPDATE' then
    -- Мягкое удаление и возврат — отдельные действия, а не «изменено».
    if v_new ? 'deleted_at'
       and (v_old ->> 'deleted_at') is null and (v_new ->> 'deleted_at') is not null then
      v_action := 'delete';
    elsif v_new ? 'deleted_at'
       and (v_old ->> 'deleted_at') is not null and (v_new ->> 'deleted_at') is null then
      v_action := 'restore';
    -- «Удалить» календаря, услуги, метки, типа объекта — это is_active=false
    -- (уходит в архив): в истории это «удалён», а не «Активность да → нет».
    elsif v_new ? 'is_active'
       and (v_old ->> 'is_active')::boolean is true and (v_new ->> 'is_active')::boolean is false then
      v_action := 'delete';
    elsif v_new ? 'is_active'
       and (v_old ->> 'is_active')::boolean is false and (v_new ->> 'is_active')::boolean is true then
      v_action := 'restore';
    else
      for v_key in select jsonb_object_keys(v_new) loop
        continue when v_key = any(v_ignore) or v_key = 'deleted_at';
        v_before := v_old -> v_key;
        v_after := v_new -> v_key;
        continue when v_before is not distinct from v_after;
        if coalesce(jsonb_typeof(v_before), 'null') in ('array', 'null')
           and coalesce(jsonb_typeof(v_after), 'null') in ('array', 'null')
           and (jsonb_typeof(v_before) = 'array' or jsonb_typeof(v_after) = 'array') then
          -- Список (заметки, услуги, оплаты, телефоны, объекты): что
          -- добавили и что убрали — именами; без имён — просто «изменено».
          v_changes := v_changes || jsonb_build_object(
            v_key,
            coalesce(public.change_log_array_diff(v_before, v_after), '"*"'::jsonb)
          );
        elsif jsonb_typeof(v_before) in ('object', 'array') or jsonb_typeof(v_after) in ('object', 'array') then
          v_changes := v_changes || jsonb_build_object(v_key, '"*"'::jsonb);
        else
          if jsonb_typeof(v_before) = 'string' then v_before := to_jsonb(left(v_before #>> '{}', 120)); end if;
          if jsonb_typeof(v_after) = 'string' then v_after := to_jsonb(left(v_after #>> '{}', 120)); end if;
          v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_array(v_before, v_after));
        end if;
      end loop;
      if v_changes = '{}'::jsonb then
        return null;
      end if;
    end if;
  end if;

  v_tenant := (v_row ->> 'tenant_id')::uuid;
  -- Личное событие без команды видит только автор — в журнал, который читает
  -- владелец, оно не идёт.
  if tg_table_name = 'appointments'
     and coalesce(v_row ->> 'kind', 'work') <> 'work'
     and v_row ->> 'team_id' is null then
    return null;
  end if;
  v_team := coalesce(
    v_row ->> 'team_id',
    v_row ->> 'brigade_id',
    case when tg_table_name = 'teams' then v_row ->> 'id' end
  );
  v_entity_id := coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'team_id');

  -- Имя предмета на тот момент и короткая подпись (дата, сумма).
  case tg_table_name
    when 'appointments' then
      v_label := coalesce(
        (select c.full_name from public.clients c
          where c.id = (v_row ->> 'client_id')::uuid and c.tenant_id = v_tenant),
        nullif(btrim(v_row ->> 'comment'), '')
      );
      v_meta := jsonb_build_object(
        'kind', v_row ->> 'kind',
        'date', v_row ->> 'date',
        'time', v_row ->> 'time_start'
      );
    when 'finance_transactions' then
      v_label := coalesce(
        (select fc.name from public.finance_categories fc
          where fc.id = (v_row ->> 'category_id')::uuid
            and (fc.tenant_id = v_tenant or fc.tenant_id is null)),
        nullif(btrim(v_row ->> 'notes'), '')
      );
      v_meta := jsonb_build_object('type', v_row ->> 'type', 'amount', v_row -> 'amount', 'date', v_row ->> 'occurred_on');
    when 'debts' then
      v_label := coalesce(
        (select c.full_name from public.clients c
          where c.id = (v_row ->> 'client_id')::uuid and c.tenant_id = v_tenant),
        nullif(btrim(v_row ->> 'counterparty'), '')
      );
      v_meta := jsonb_build_object('direction', v_row ->> 'direction', 'amount', v_row -> 'amount');
    when 'invoices' then
      v_label := v_row ->> 'number';
      v_meta := jsonb_build_object('kind', v_row ->> 'kind', 'amount', v_row -> 'total');
    when 'receipts' then
      v_label := v_row ->> 'number';
      v_meta := jsonb_build_object('amount', v_row -> 'amount');
    when 'member_access', 'member_calendars', 'tenant_members' then
      v_label := public.change_log_person_name(v_tenant, (v_row ->> 'user_id')::uuid);
      v_meta := jsonb_strip_nulls(jsonb_build_object(
        'block', v_row ->> 'block',
        'block_title', (select b.title_ru from public.access_blocks b where b.key = v_row ->> 'block'),
        'level', v_row ->> 'level',
        'role', v_row ->> 'role'
      ));
    when 'invitations' then
      v_label := coalesce(nullif(btrim(v_row ->> 'full_name'), ''), v_row ->> 'email', v_row ->> 'phone');
    when 'team_design', 'team_schedules' then
      v_label := (select t.name from public.teams t where t.tenant_id = v_tenant and t.id = v_team);
    when 'personal_event_types' then
      v_label := v_row ->> 'label';
    when 'client_tag_assignments' then
      -- Тег у клиента: кому поставили и какой; команда — у тега.
      v_entity_id := v_row ->> 'client_id';
      v_label := (select c.full_name from public.clients c
                   where c.id = (v_row ->> 'client_id')::uuid and c.tenant_id = v_tenant);
      select tg.team_id, jsonb_build_object('tag', tg.name)
        into v_team, v_meta
        from public.client_tags tg
       where tg.id = (v_row ->> 'tag_id')::uuid and tg.tenant_id = v_tenant;
    when 'client_attachments' then
      v_label := v_row ->> 'filename';
      select c.team_id, jsonb_build_object('client', c.full_name, 'client_id', c.id)
        into v_team, v_meta
        from public.clients c
       where c.id = (v_row ->> 'client_id')::uuid and c.tenant_id = v_tenant;
    when 'appointment_photos' then
      v_entity_id := v_row ->> 'appointment_id';
      select coalesce(c.full_name, nullif(btrim(a.comment), '')), a.team_id,
             jsonb_build_object('date', a.date, 'time', a.time_start, 'kind', a.kind)
        into v_label, v_team, v_meta
        from public.appointments a
        left join public.clients c on c.id = a.client_id and c.tenant_id = v_tenant
       where a.id = (v_row ->> 'appointment_id')::uuid and a.tenant_id = v_tenant;
    when 'day_cities' then
      v_label := v_row ->> 'city';
      v_meta := jsonb_build_object('date', v_row ->> 'date');
    when 'calendar_settings' then
      v_label := null;
    else
      v_label := coalesce(v_row ->> 'name', v_row ->> 'full_name', v_row ->> 'label', v_row ->> 'number');
  end case;

  insert into public.change_log (
    tenant_id, team_id, actor_id, actor_name, entity, entity_id, action, label, meta, changes
  ) values (
    v_tenant,
    v_team,
    v_actor,
    case when v_actor is null then null else public.change_log_person_name(v_tenant, v_actor) end,
    tg_table_name,
    v_entity_id,
    v_action,
    left(v_label, 120),
    v_meta,
    case when v_changes = '{}'::jsonb then null else v_changes end
  );
  return null;
exception when others then
  -- Журнал не имеет права уронить правку.
  return null;
end;
$$;

revoke all on function public.log_change() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'client_tag_assignments', 'client_attachments', 'appointment_photos', 'day_cities',
    'calendar_settings', 'legal_entities', 'sms_team_templates', 'masters'
  ] loop
    execute format('drop trigger if exists zz_log_change on public.%I', t);
    execute format(
      'create trigger zz_log_change after insert or update or delete on public.%I
         for each row execute function public.log_change()',
      t
    );
  end loop;
end;
$$;

-- Источники клиентов — только команд, где человеку открыты клиенты (у
-- владельца — все): свои источники бывают именами людей.
drop policy if exists client_sources_select_access on public.client_sources;
create policy client_sources_select_access on public.client_sources
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or team_id in (select unnest(public.access_calendars('clients', 'read')))
    )
  );

-- Долг — только с клиентом своего аккаунта (проверка системы 03.10: политика
-- вставки проверяла аккаунт и команду, но не клиента).
create or replace function public.debts_client_same_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.client_id is not null and not exists (
    select 1 from public.clients c where c.id = new.client_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'клиент не из этого аккаунта' using errcode = '42501', hint = 'debt:foreign_client';
  end if;
  return new;
end;
$$;

revoke all on function public.debts_client_same_tenant() from public, anon, authenticated;

drop trigger if exists debts_client_same_tenant on public.debts;
create trigger debts_client_same_tenant
  before insert or update of client_id, tenant_id on public.debts
  for each row execute function public.debts_client_same_tenant();
