-- «ИСТОРИЯ ИЗМЕНЕНИЙ»: ЧТО ИМЕННО ПОМЕНЯЛОСЬ В СПИСКАХ (владелец 03.10: «кто-то
-- поменял клиента, какой-то записи — падает в заметку… фиксируется всё,
-- можно посмотреть, что произошло»).
--
-- До этой миграции список (заметки клиента, услуги записи, оплаты, телефоны,
-- объекты) писался в журнал одним «изменено». Теперь — что добавили и что
-- убрали, именами: {"+": ["текст новой заметки"], "-": ["Заправка"]}. Имя
-- элемента — его текст, имя услуги, название, адрес, номер или сумма; до
-- пяти с каждой стороны, по 80 знаков. Элемент без имени не попадает, а
-- если именованных нет вовсе — остаётся «изменено» (`"*"`).
--
-- Тело `log_change()` — из `20261003191700_change_log.sql` с одной правкой
-- (ветка списка); остальное не тронуто.

set local lock_timeout = '5s';

create or replace function public.change_log_item_label(p_item jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select case jsonb_typeof(p_item)
    when 'string' then nullif(btrim(p_item #>> '{}'), '')
    when 'number' then p_item #>> '{}'
    when 'object' then coalesce(
      nullif(btrim(p_item ->> 'text'), ''),
      nullif(btrim(p_item ->> 'serviceName'), ''),
      nullif(btrim(p_item ->> 'name'), ''),
      nullif(btrim(p_item ->> 'label'), ''),
      nullif(btrim(p_item ->> 'title'), ''),
      nullif(btrim(p_item ->> 'address'), ''),
      nullif(btrim(p_item ->> 'number'), ''),
      nullif(btrim(p_item ->> 'phone'), ''),
      p_item ->> 'amount'
    )
    else null
  end;
$$;

create or replace function public.change_log_array_diff(p_old jsonb, p_new jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  with o as (
    select e from jsonb_array_elements(case when jsonb_typeof(p_old) = 'array' then p_old else '[]'::jsonb end) e
  ),
  n as (
    select e from jsonb_array_elements(case when jsonb_typeof(p_new) = 'array' then p_new else '[]'::jsonb end) e
  ),
  added as (
    select public.change_log_item_label(n.e) as l from n where not exists (select 1 from o where o.e = n.e)
  ),
  removed as (
    select public.change_log_item_label(o.e) as l from o where not exists (select 1 from n where n.e = o.e)
  ),
  a as (select jsonb_agg(left(l, 80)) as v from (select l from added where l is not null limit 5) x),
  r as (select jsonb_agg(left(l, 80)) as v from (select l from removed where l is not null limit 5) y)
  select case
    when (select v from a) is null and (select v from r) is null then null
    else jsonb_strip_nulls(jsonb_build_object('+', (select v from a), '-', (select v from r)))
  end;
$$;

revoke all on function public.change_log_item_label(jsonb) from public, anon, authenticated;
revoke all on function public.change_log_array_diff(jsonb, jsonb) from public, anon, authenticated;

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
  if pg_trigger_depth() > 1 then
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
        (select c.full_name from public.clients c where c.id = (v_row ->> 'client_id')::uuid),
        nullif(btrim(v_row ->> 'comment'), '')
      );
      v_meta := jsonb_build_object(
        'kind', v_row ->> 'kind',
        'date', v_row ->> 'date',
        'time', v_row ->> 'time_start'
      );
    when 'finance_transactions' then
      v_label := coalesce(
        (select fc.name from public.finance_categories fc where fc.id = (v_row ->> 'category_id')::uuid),
        nullif(btrim(v_row ->> 'notes'), '')
      );
      v_meta := jsonb_build_object('type', v_row ->> 'type', 'amount', v_row -> 'amount', 'date', v_row ->> 'occurred_on');
    when 'debts' then
      v_label := coalesce(
        (select c.full_name from public.clients c where c.id = (v_row ->> 'client_id')::uuid),
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
        'level', v_row ->> 'level',
        'role', v_row ->> 'role'
      ));
    when 'invitations' then
      v_label := coalesce(nullif(btrim(v_row ->> 'full_name'), ''), v_row ->> 'email', v_row ->> 'phone');
    when 'team_design', 'team_schedules' then
      v_label := (select t.name from public.teams t where t.tenant_id = v_tenant and t.id = v_team);
    when 'personal_event_types' then
      v_label := v_row ->> 'label';
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
